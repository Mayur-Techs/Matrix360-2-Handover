import asyncio
import json
import os
import random
import re
import socket
from urllib.parse import urljoin, urlparse, quote_plus, unquote
from typing import List, Tuple, Dict
import httpx
from bs4 import BeautifulSoup

try:
    import dns.resolver
    HAS_DNSPYTHON = True
except ImportError:
    HAS_DNSPYTHON = False

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}")

IGNORE_EMAIL_EXT = (
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".js", ".css", ".woff", ".woff2", ".ttf", ".ico", ".mp4", ".pdf"
)

IGNORE_EMAIL_DOMAINS = (
    "sentry.io", "wixpress.com", "example.com", "example.co", "domain.com", "domain.co",
    "email.com", "yoursite.com", "yourdomain.com", "wordpress.org",
    "w3.org", "schema.org", "googleapis.com", "cloudflare.com",
    "godaddy.com", "secureserver.net", "mailinator.com", "tempmail.com",
    "gmail.co", "yahoo.co", "rediffmail.co", "hotmail.co", "outlook.co",
    "google.com", "youtube.com", "youtu.be", "facebook.com", "instagram.com",
    "linkedin.com", "twitter.com", "x.com", "justdial.com", "indiamart.com", "tradeindia.com"
)

# Blocks template placeholders on the left side of the @ symbol
IGNORE_EMAIL_PREFIXES = {
    "name", "yourname", "your.name", "user", "username", "email", "youremail",
    "your.email", "test", "testing", "sample", "demo", "placeholder",
    "firstname", "lastname", "someone", "anyone", "abc", "xyz"
}

BLOCKED_INBOX_PREFIXES = (
    "hr@", "careers@", "career@", "jobs@", "job@", "recruitment@",
    "recruiting@", "resume@", "cv@", "noreply@", "no-reply@",
    "donotreply@", "webmaster@", "postmaster@", "abuse@", "privacy@", "legal@"
)

TRAILING_JUNK_WORDS = (
    "call", "phone", "tel", "mobile", "mob", "whatsapp", "address",
    "contact", "email", "mail", "visit", "website", "india", "kolkata",
    "mon", "tue", "wed", "thu", "fri", "sat", "sun", "copyright"
)

SOCIAL_PATTERNS = {
    "instagram": ("instagram.com/",),
    "linkedin": ("linkedin.com/company/", "linkedin.com/school/"),
    "facebook": ("facebook.com/",),
    "twitter": ("twitter.com/", "x.com/")
}

JUNIOR_ROLE_EXCLUSIONS = (
    "intern", "trainee", "junior", "assistant", "clerk",
    "receptionist", "student", "fresher", "coordinator", "support executive"
)

INDUSTRY_EXCLUSION_MAP = {
    "it": ["software development", "it services", "web design", "app development", "saas"],
    "consulting": ["management consulting", "business consultancy", "advisory firm"],
    "marketing": ["digital marketing", "advertising agency", "seo agency", "pr agency", "social media agency"],
    "recruitment": ["recruitment agency", "staffing", "hr consultancy", "manpower consultancy", "headhunting"],
    "bfsi": ["bank", "insurance", "mutual fund", "stock broker", "wealth management", "nbfc", "microfinance"],
    "education": ["school", "college", "university", "coaching institute", "training center", "academy"]
}

VALID_COMPANY_SIZE_RANGES = [
    "11-50", "11–50", "51-200", "51–200",
    "201-500", "201–500", "501-1,000", "501–1,000", "501-1000",
    "1,001-5,000", "1,001–5,000", "1001-5000"
]

INVALID_COMPANY_SIZE_SIGNALS = (
    "1-10 employees", "1–10 employees", "2-10 employees", "2–10 employees",
    "10,001+ employees", "10,000+ employees", "self-employed", "sole freelancer"
)

MCA_CIN_REGEX = re.compile(r"\b([UL]\d{5}[A-Z]{2}\d{4}(PTC|PLC|OPC|LLP|GOI|SGC)\d{6})\b", re.I)
GSTIN_REGEX = re.compile(r"\b(\d{2}[A-Z]{3}([CPHFATBLJG])[A-Z]\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b", re.I)

TURNOVER_PATTERNS = [
    re.compile(
        r"(?:Annual\s+Turnover|Turnover|Total\s+Revenue|Annual\s+Revenue)\s*[:\-–isof]*\s*"
        r"((?:Rs\.?|INR|₹|\$|USD)?\s*\d+(?:[\.,]\d+)?\s*(?:[\-–to]+\s*(?:Rs\.?|INR|₹|\$|USD)?\s*\d+(?:[\.,]\d+)?)?\s*"
        r"(?:Crores?|Cr\.?|Lakhs?|Lacs?|Million|Billion|Mn|Bn)\b(?:\s*\+?)*)",
        re.IGNORECASE
    ),
    re.compile(
        r"\b((?:Rs\.?|INR|₹)\s*\d+(?:[\.,]\d+)?\s*(?:[\-–to]+\s*\d+(?:[\.,]\d+)?)?\s*(?:Crores?|Cr\.?|Lakhs?|Lacs?))\s+"
        r"(?:Annual\s+)?(?:Turnover|Revenue)\b",
        re.IGNORECASE
    ),
    re.compile(
        r"\b((?:Up\s*to|Upto|More\s+than|Above)\s+(?:Rs\.?|INR|₹)\s*\d+(?:[\.,]\d+)?\s*(?:Crores?|Cr\.?|Lakhs?|Lacs?))\b",
        re.IGNORECASE
    )
]

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/130.0.0.0"
]

SERP_SEMAPHORE = asyncio.Semaphore(8)
DOMAIN_MX_CACHE: Dict[str, bool] = {}

PERSON_NAME_PATTERN = r"(?:Dr\.?[ \t]+|Mr\.?[ \t]+|Ms\.?[ \t]+|Mrs\.?[ \t]+|Sri[ \t]+|Smt\.?[ \t]+)?[A-Z][a-z]{1,18}(?:[ \t]+[A-Z]\.?|[ \t]+[A-Z][a-z]{1,18}){1,2}"

B2B_CONTACT_PERSON_REGEX = re.compile(
    rf"(?:Contact\s+Person|Key\s+Person|Company\s+CEO|Owner\s+Name|Director\s+Name|Proprietor\s+Name)\s*[:\-–]\s*"
    rf"({PERSON_NAME_PATTERN})(?:\s*\(([^)]{{2,40}})\))?",
    re.IGNORECASE
)

STOP_NAME_WORDS = {
    "about", "contact", "company", "services", "home", "read", "more", "view",
    "profile", "our", "team", "meet", "the", "welcome", "privacy", "policy",
    "terms", "copyright", "rights", "reserved", "years", "experience", "business",
    "solutions", "group", "agency", "india", "private", "limited", "inc", "llc",
    "manufacturing", "industrial", "plant", "factory", "warehouse", "logistics",
    "kolkata", "odisha", "bihar", "jharkhand", "assam", "bengal", "enterprise",
    "ground", "floor", "opposite", "near", "behind", "beside", "road", "street",
    "lane", "sector", "phase", "building", "tower", "plaza", "complex", "market",
    "import", "export", "service", "services", "logistics", "transport", "shipping",
    "warehouse", "supply", "chain", "customer", "support", "care", "custom",
    "ahmedabad", "mumbai", "delhi", "chennai", "pune", "bangalore", "bengaluru",
    "hyderabad", "surat", "vadodara", "jaipur", "lucknow", "kanpur", "nagpur"
}


def classify_factual_entity_type(business_name: str, site_text: str, b2b_text: str) -> Tuple[str, str]:
    combined = f"{business_name} \n {site_text[:10000]} \n {b2b_text[:6000]}"
    name_and_b2b = f"{business_name} {b2b_text[:4000]}"

    reg_id = ""
    cin_match = MCA_CIN_REGEX.search(combined)
    if cin_match:
        reg_id = f"CIN: {cin_match.group(1).upper()}"
        cin_type = cin_match.group(2).upper()
        if cin_type in ("PTC", "OPC"):
            return "Pvt Ltd", reg_id
        elif cin_type == "PLC":
            return "Public Ltd", reg_id
        elif cin_type == "LLP":
            return "LLP", reg_id

    gst_match = GSTIN_REGEX.search(combined)
    pan_entity_char = ""
    if gst_match:
        reg_id = reg_id or f"GST: {gst_match.group(1).upper()}"
        pan_entity_char = gst_match.group(2).upper()

    if re.search(r"\b(Pvt\.?\s*Ltd\.?|Private\s+Limited|\(P\)\s*Ltd\.?|OPC\s+Pvt)\b", name_and_b2b, re.I):
        return "Pvt Ltd", reg_id

    if re.search(r"(?:©|Copyright|\bM/s\b).*?\b(Pvt\.?\s*Ltd\.?|Private\s+Limited)\b", site_text[:8000], re.I):
        return "Pvt Ltd", reg_id

    if re.search(r"Legal\s+Status\s+of\s+Firm\s*[:\-]?\s*Private\s+Limited", combined, re.I):
        return "Pvt Ltd", reg_id

    if re.search(r"\b(LLP|Limited\s+Liability\s+Partnership)\b", name_and_b2b, re.I):
        return "LLP", reg_id

    if re.search(r"\b(Public\s+Limited|Ltd\.?|Limited)\b", business_name, re.I):
        return "Public Ltd", reg_id
    if re.search(r"Legal\s+Status\s+of\s+Firm\s*[:\-]?\s*(?:Public\s+)?Limited\s+Company", combined, re.I):
        return "Public Ltd", reg_id

    if pan_entity_char == "C":
        return "Pvt Ltd", reg_id
    elif pan_entity_char == "F":
        return "Partnership / LLP", reg_id
    elif pan_entity_char == "P":
        return "Proprietorship", reg_id
    elif pan_entity_char == "H":
        return "HUF (Other)", reg_id

    if re.search(r"Legal\s+Status\s+of\s+Firm\s*[:\-]?\s*(?:Individual\s*[\-–]?\s*)?Proprietor", combined, re.I):
        return "Proprietorship", reg_id
    if re.search(r"Legal\s+Status\s+of\s+Firm\s*[:\-]?\s*Partnership", combined, re.I):
        return "Partnership Firm", reg_id

    return "Other (MSME / Unspecified)", reg_id


def extract_factual_turnover(site_text: str, b2b_text: str) -> str:
    for pat in TURNOVER_PATTERNS:
        m_site = pat.search(site_text)
        if m_site:
            val = re.sub(r"\s+", " ", m_site.group(1)).strip()
            if any(ch.isdigit() for ch in val):
                return f"{val} (Website)"

    for pat in TURNOVER_PATTERNS:
        m_b2b = pat.search(b2b_text)
        if m_b2b:
            val = re.sub(r"\s+", " ", m_b2b.group(1)).strip()
            if any(ch.isdigit() for ch in val):
                return f"{val} (Registry)"

    return "Not Disclosed"


def sanitize_extracted_email(raw_email: str) -> str:
    """Safely strips trailing DOM text artifacts WITHOUT backtracking into '.com' and truncating it."""
    clean = raw_email.strip().lower()
    clean = re.sub(r"^mailto:", "", clean).split("?")[0].strip()

    for bad_tail in TRAILING_JUNK_WORDS:
        if clean.endswith(bad_tail) and not clean.endswith(f".{bad_tail}"):
            candidate = clean[:-len(bad_tail)]
            if re.search(r"\.(?:com|in|org|net|co\.in|net\.in|org\.in|io|biz|info|co)$", candidate):
                clean = candidate
                break

    return clean.strip(".")


def score_email_priority(email: str, dm_name: str = "") -> int:
    local = email.split("@")[0].lower()
    if dm_name:
        first_n = re.sub(r"^(?:dr|mr|ms|mrs)\.?\s+", "", dm_name.lower()).split()[0]
        if len(first_n) >= 3 and first_n in local:
            return 100
    if any(k in local for k in ["founder", "ceo", "md", "director", "owner", "partner", "president", "coo", "plant"]):
        return 90
    if any(k in local for k in ["sales", "business", "export", "commercial", "marketing", "projects", "logistics"]):
        return 75
    if any(k in local for k in ["info", "contact", "office", "enquiry", "inquiry", "admin", "corp"]):
        return 60
    return 70


def validate_and_format_phone(raw_phone: str) -> Tuple[str, str]:
    if not raw_phone:
        return "", "Invalid"

    digits = "".join(ch for ch in raw_phone if ch.isdigit())
    if not digits or len(digits) < 10 or len(digits) > 13:
        return "", "Invalid"

    if len(set(digits[-10:])) <= 2:
        return "", "Invalid"

    if len(digits) == 10:
        if digits[0] in "6789":
            return f"+91 {digits[:5]} {digits[5:]}", "Valid"
        elif digits[0] in "2345":
            return f"+91 {digits}", "Valid"
    elif len(digits) == 11 and digits.startswith("0"):
        core = digits[1:]
        if core[0] in "6789":
            return f"+91 {core[:5]} {core[5:]}", "Valid"
        return f"+91 {core[:2]}-{core[2:]}", "Valid"
    elif len(digits) == 12 and digits.startswith("91"):
        core = digits[2:]
        if core[0] in "6789":
            return f"+91 {core[:5]} {core[5:]}", "Valid"
        return f"+91 {core}", "Valid"
    elif 10 <= len(digits) <= 13:
        return f"+{digits}", "Valid"

    return "", "Invalid"


def verify_domain_mx_sync(domain: str) -> bool:
    domain = domain.lower().strip()
    if not domain or "." not in domain:
        return False
    if domain in IGNORE_EMAIL_DOMAINS or any(
        domain == bad or domain.endswith(f".{bad}") for bad in IGNORE_EMAIL_DOMAINS
    ):
        return False
    if domain in DOMAIN_MX_CACHE:
        return DOMAIN_MX_CACHE[domain]

    is_valid = False
    if HAS_DNSPYTHON:
        try:
            resolver = dns.resolver.Resolver()
            resolver.lifetime = 2.5
            answers = resolver.resolve(domain, "MX")
            if len(answers) > 0:
                is_valid = True
        except Exception:
            pass

    if not is_valid:
        try:
            socket.getaddrinfo(domain, None)
            is_valid = True
        except Exception:
            is_valid = False

    DOMAIN_MX_CACHE[domain] = is_valid
    return is_valid


async def verify_email_address(raw_email: str) -> Tuple[str, bool]:
    clean = sanitize_extracted_email(raw_email)
    if not clean or "@" not in clean:
        return "", False
    if clean.endswith(IGNORE_EMAIL_EXT):
        return "", False
    if any(clean.startswith(prefix) for prefix in BLOCKED_INBOX_PREFIXES):
        return "", False
    if not EMAIL_REGEX.match(clean):
        return "", False

    local_part, domain = clean.split("@", 1)
    if len(local_part) < 2 or len(local_part) > 64:
        return "", False

    # 1. Reject local-parts that are known placeholders (e.g. name@, yourname@)
    if local_part in IGNORE_EMAIL_PREFIXES or "example" in local_part:
        return "", False

    # 2. Reject domain typos and dummy domains completely
    if domain in IGNORE_EMAIL_DOMAINS or any(
        domain == bad or domain.endswith(f".{bad}") for bad in IGNORE_EMAIL_DOMAINS
    ):
        return "", False
    if "example." in domain or "yourdomain." in domain or "yoursite." in domain:
        return "", False

    mx_ok = await asyncio.to_thread(verify_domain_mx_sync, domain)
    return (clean if mx_ok else ""), mx_ok


def build_title_regex(target_titles: List[str]) -> str:
    escaped = []
    for t in target_titles:
        clean_t = t.strip()
        if clean_t:
            escaped.append(re.escape(clean_t).replace(r"\ ", r"\s+"))
    escaped.extend(["Whole-time\\s+Director", "Joint\\s+Managing\\s+Director", "Proprietor", "Chairman"])
    return "(?:" + "|".join(escaped) + ")"


def is_valid_person_name(name: str) -> bool:
    if not name or len(name) < 4 or len(name) > 42:
        return False
    name = name.splitlines()[-1].strip()
    clean = re.sub(r"^(?:Dr|Mr|Ms|Mrs|Sri|Smt)\.?\s+", "", name, flags=re.I).strip()
    words = [w.strip(".") for w in clean.split() if w.strip(".")]
    if len(words) < 2 or len(words) > 4:
        return False
    if len([w for w in words if len(w) >= 2]) < 2:
        return False
    for w in words:
        if w.lower() in STOP_NAME_WORDS:
            return False
        if not w[0].isupper() or any(ch.isdigit() for ch in w):
            return False
    return True


def is_junior_role(role_text: str) -> bool:
    low = (role_text or "").lower()
    return any(jr in low for jr in JUNIOR_ROLE_EXCLUSIONS)


def extract_dm_from_html(soup: BeautifulSoup, target_titles: List[str]) -> dict:
    dm = {"dm_name": "", "dm_role": "", "dm_linkedin": ""}
    titles_pat = build_title_regex(target_titles)

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "{}")
            items = data if isinstance(data, list) else [data]
            for obj in items:
                if not isinstance(obj, dict):
                    continue
                for field, default_role in [("founder", "Founder"), ("founders", "Founder"), ("employee", "Director")]:
                    val = obj.get(field)
                    person_list = val if isinstance(val, list) else ([val] if val else [])
                    for p in person_list:
                        if isinstance(p, dict):
                            p_name = (p.get("name") or "").strip()
                            p_role = (p.get("jobTitle") or default_role).strip()
                            if is_valid_person_name(p_name) and not is_junior_role(p_role):
                                dm["dm_name"] = p_name
                                dm["dm_role"] = p_role
                                same_as = p.get("sameAs") or []
                                if isinstance(same_as, str):
                                    same_as = [same_as]
                                for link in same_as:
                                    if "linkedin.com/in/" in link.lower():
                                        dm["dm_linkedin"] = link.split("?")[0]
                                return dm
        except Exception:
            continue

    name_near_title = re.compile(
        rf"({PERSON_NAME_PATTERN})\s*[\-–—,|:\n\(]\s*({titles_pat})\b",
        re.IGNORECASE
    )
    title_near_name = re.compile(
        rf"\b({titles_pat})\s*[\-–—,|:\n]\s*({PERSON_NAME_PATTERN})",
        re.IGNORECASE
    )
    din_regex = re.compile(
        rf"({PERSON_NAME_PATTERN})\s*\(?DIN\s*[:\-]?\s*\d{{8}}\)?",
        re.IGNORECASE
    )

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if "linkedin.com/in/" in href.lower() and not dm["dm_linkedin"]:
            parent_text = a.parent.get_text(" ", strip=True) if a.parent else a.get_text(" ", strip=True)
            if not is_junior_role(parent_text):
                dm["dm_linkedin"] = href.split("?")[0]
                m1 = name_near_title.search(parent_text)
                if m1 and is_valid_person_name(m1.group(1)):
                    dm["dm_name"] = m1.group(1).strip()
                    dm["dm_role"] = m1.group(2).strip()
                    return dm

    text_content = soup.get_text("\n", strip=True)
    for match in din_regex.finditer(text_content):
        cand_name = match.group(1).strip()
        if is_valid_person_name(cand_name):
            dm["dm_name"] = cand_name
            dm["dm_role"] = "Director (MCA Registered)"
            return dm

    for match in B2B_CONTACT_PERSON_REGEX.finditer(text_content):
        cand_name = match.group(1).strip()
        cand_role = (match.group(2) or "Proprietor / Key Executive").strip()
        if is_valid_person_name(cand_name) and not is_junior_role(cand_role):
            dm["dm_name"] = cand_name
            dm["dm_role"] = cand_role
            return dm

    for match in name_near_title.finditer(text_content):
        cand_name, cand_role = match.group(1).strip(), match.group(2).strip()
        if is_valid_person_name(cand_name) and not is_junior_role(cand_role):
            dm["dm_name"] = cand_name
            dm["dm_role"] = cand_role
            return dm

    for match in title_near_name.finditer(text_content):
        cand_role, cand_name = match.group(1).strip(), match.group(2).strip()
        if is_valid_person_name(cand_name) and not is_junior_role(cand_role):
            dm["dm_name"] = cand_name
            dm["dm_role"] = cand_role
            return dm

    return dm


def detect_real_company_size(text_corpus: str) -> Tuple[str, bool]:
    low_corpus = text_corpus.lower()
    for bad_sig in INVALID_COMPANY_SIZE_SIGNALS:
        if bad_sig in low_corpus:
            return bad_sig, True

    for size_range in VALID_COMPANY_SIZE_RANGES:
        if size_range in text_corpus:
            normalized = size_range.replace("-", "–")
            return f"{normalized} employees", False

    emp_match = re.search(
        r"\b(\d{2,4})\s*(?:\+|\s*to\s*\d{2,4})?\s*(?:employees|workforce|staff|workers|team\s+members|people)\b",
        low_corpus
    )
    if emp_match:
        count = int(emp_match.group(1))
        if count < 11 or count > 5000:
            return f"{count} employees", True
        if count <= 50:
            return "11–50 employees", False
        if count <= 200:
            return "51–200 employees", False
        if count <= 500:
            return "201–500 employees", False
        if count <= 1000:
            return "501–1,000 employees", False
        return "1,001–5,000 employees", False

    return "Not Disclosed", False


async def bounded_html_get(client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
    """Limit HTML retained per request in the low-RAM profile.

    Streamed responses prevent full multi-megabyte vendor websites, registry
    pages, and SERP markup from being buffered in Python memory. Preserve
    existing behavior when the explicit bounded-HTML setting is off.
    """
    if os.getenv("M360_BOUNDED_HTTP", "0") != "1":
        return await client.get(url, **kwargs)

    max_size = 750_000  # decoded response bytes, not remote Content-Length
    data = bytearray()
    async with client.stream("GET", url, **kwargs) as remote:
        async for chunk in remote.aiter_bytes(chunk_size=16_384):
            remaining = max_size - len(data)
            if remaining <= 0:
                break
            data.extend(chunk[:remaining])
            if len(data) >= max_size:
                break
        headers = dict(remote.headers)
        # httpx has already decompressed any gzip/br response chunks.
        headers.pop("content-encoding", None)
        headers.pop("content-length", None)
        return httpx.Response(
            status_code=remote.status_code,
            headers=headers,
            request=remote.request,
            content=bytes(data),
        )


async def fast_serp_get(client: httpx.AsyncClient, url: str) -> str:
    async with SERP_SEMAPHORE:
        await asyncio.sleep(random.uniform(0.10, 0.25))
        headers = {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept-Language": "en-US,en;q=0.9"
        }
        try:
            resp = await bounded_html_get(client, url, headers=headers, timeout=5.5, follow_redirects=True)
            if resp.status_code == 200:
                return resp.text
        except Exception:
            pass
        return ""


async def search_linkedin_xray(
    client: httpx.AsyncClient,
    business_name: str,
    location: str,
    target_titles: List[str]
) -> dict:
    info = {"dm_name": "", "dm_role": "", "dm_linkedin": "", "serp_text": ""}
    if not business_name:
        return info

    clean_biz = re.sub(r"\b(Pvt\.?|Ltd\.?|LLC|Inc\.?|Limited|Private|India)\b", "", business_name, flags=re.I).strip()
    city = location.split(",")[0].strip()

    titles_or = " OR ".join(f'"{t.strip()}"' for t in target_titles[:7] if t.strip())
    if not titles_or:
        titles_or = 'Founder OR Owner OR MD OR CEO OR Director OR Partner OR COO'

    dork_query = f'site:linkedin.com/in/ "{clean_biz}" {city} ({titles_or})'

    search_urls = [
        f"https://search.yahoo.com/search?p={quote_plus(dork_query)}&n=5",
        f"https://www.bing.com/search?q={quote_plus(dork_query)}"
    ]

    for search_url in search_urls:
        html_text = await fast_serp_get(client, search_url)
        if not html_text:
            continue

        soup = BeautifulSoup(html_text, "html.parser")
        info["serp_text"] += " " + soup.get_text(" ", strip=True)[:2500]

        for a in soup.find_all("a", href=True):
            raw_href = a["href"]
            if "RU=" in raw_href:
                try:
                    raw_href = unquote(raw_href.split("RU=")[1].split("/RK=")[0])
                except Exception:
                    pass

            if "linkedin.com/in/" not in raw_href.lower():
                continue

            title_text = a.get_text(" ", strip=True)
            if is_junior_role(title_text):
                continue

            if " - " in title_text or "|" in title_text:
                parts = [p.strip() for p in re.split(r"\s+[-–—|]\s+", title_text) if p.strip()]
                if len(parts) >= 2:
                    cand_name = parts[0]
                    cand_role = parts[1]
                    if is_valid_person_name(cand_name) and not is_junior_role(cand_role):
                        info["dm_name"] = cand_name
                        info["dm_role"] = cand_role[:65]
                        info["dm_linkedin"] = raw_href.split("?")[0]
                        return info

    return info


async def fetch_b2b_registry_turnover_and_emails(
    client: httpx.AsyncClient,
    business_name: str,
    domain: str,
    location: str,
    need_emails: bool
) -> Tuple[str, List[str], dict]:
    city = location.split(",")[0].strip()
    if domain and not any(g in domain for g in ["facebook.com", "instagram.com", "justdial.com", "indiamart.com"]):
        query = f'"{business_name}" {city} ("Annual Turnover" OR "Contact Person" OR "Legal Status" OR "CIN" OR "@{domain}")'
    else:
        query = f'"{business_name}" {city} ("Annual Turnover" OR "Contact Person" OR "Crore" OR "Legal Status" OR "GST")'

    search_url = f"https://search.yahoo.com/search?p={quote_plus(query)}&n=6"
    html_text = await fast_serp_get(client, search_url)
    b2b_dm = {"dm_name": "", "dm_role": ""}
    if not html_text:
        return "", [], b2b_dm

    soup = BeautifulSoup(html_text, "html.parser")
    b2b_text = soup.get_text(" ", strip=True)[:5000]

    cp_match = B2B_CONTACT_PERSON_REGEX.search(b2b_text)
    if cp_match:
        c_name = cp_match.group(1).strip()
        c_role = (cp_match.group(2) or "Director / Owner").strip()
        if is_valid_person_name(c_name) and not is_junior_role(c_role):
            b2b_dm["dm_name"] = c_name
            b2b_dm["dm_role"] = c_role

    discovered_emails = []
    if need_emails:
        for raw_mail in EMAIL_REGEX.findall(b2b_text):
            clean_addr, is_ok = await verify_email_address(raw_mail)
            if is_ok and clean_addr not in discovered_emails:
                discovered_emails.append(clean_addr)

    return b2b_text, discovered_emails, b2b_dm


def check_page_exclusions(html_text: str, exclusions: List[str]) -> bool:
    low_text = html_text[:5000].lower()
    for ex in exclusions:
        ex_key = ex.strip().lower()
        if ex_key in INDUSTRY_EXCLUSION_MAP:
            for phrase in INDUSTRY_EXCLUSION_MAP[ex_key]:
                if phrase in low_text:
                    return True
    return False


async def enrich_and_verify_lead(
    client: httpx.AsyncClient,
    lead: dict,
    target_titles: List[str],
    exclusions: List[str],
    target_company_size: str,
    entity_filter: str = "all"
) -> Tuple[dict, bool]:
    formatted_phone, phone_status = validate_and_format_phone(lead.get("phone", ""))
    lead["phone"] = formatted_phone
    lead["phone_status"] = phone_status

    url = (lead.get("website") or "").strip()
    verified_emails: List[str] = []
    seen_emails = set()

    socials = {"instagram": "", "linkedin": "", "facebook": "", "twitter": ""}
    dm_info = {"dm_name": "", "dm_role": "", "dm_linkedin": "", "dm_email": ""}
    domain = ""
    combined_site_text = ""

    if url:
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        parsed_u = urlparse(url)
        domain = parsed_u.netloc.lower().replace("www.", "")

        if any(domain == bd or domain.endswith("." + bd) for bd in ("youtube.com", "youtu.be", "google.com", "facebook.com", "instagram.com", "justdial.com", "indiamart.com", "tradeindia.com")):
            url = ""
            lead["website"] = ""
            domain = ""
        else:
            try:
                resp = await bounded_html_get(client, url, timeout=6.0, follow_redirects=True)
                if resp.status_code == 200:
                    if check_page_exclusions(resp.text, exclusions):
                        return lead, True

                    soup = BeautifulSoup(resp.text, "html.parser")
                    priority_keywords = [
                        "contact", "about", "team", "leader", "founder",
                        "director", "management", "profile", "investor", "who-we-are"
                    ]

                    subpages = []
                    for a in soup.find_all("a", href=True):
                        href = a["href"].strip()
                        lower_h = href.lower()
                        if lower_h.startswith("mailto:"):
                            clean_addr, is_ok = await verify_email_address(lower_h)
                            if is_ok and clean_addr not in seen_emails:
                                seen_emails.add(clean_addr)
                                verified_emails.append(clean_addr)
                        elif any(k in lower_h for k in priority_keywords):
                            full_url = urljoin(url, href)
                            if urlparse(full_url).netloc == parsed_u.netloc and full_url != url and full_url not in subpages:
                                subpages.append(full_url)
                                if len(subpages) >= 3:
                                    break

                    async def fetch_subpage(s_url: str) -> str:
                        try:
                            r = await bounded_html_get(client, s_url, timeout=4.5, follow_redirects=True)
                            return r.text if r.status_code == 200 else ""
                        except Exception:
                            return ""

                    sub_htmls = await asyncio.gather(*(fetch_subpage(u) for u in subpages)) if subpages else []
                    all_html_pages = [resp.text] + [h for h in sub_htmls if h]

                    for html_text in all_html_pages:
                        page_soup = BeautifulSoup(html_text, "html.parser")

                        if not dm_info["dm_name"]:
                            extracted_dm = extract_dm_from_html(page_soup, target_titles)
                            if extracted_dm["dm_name"] or extracted_dm["dm_linkedin"]:
                                dm_info.update({k: v for k, v in extracted_dm.items() if v})

                        for junk_tag in page_soup(["script", "style", "noscript", "svg"]):
                            junk_tag.decompose()
                        spaced_dom_text = page_soup.get_text(" ", strip=True)
                        combined_site_text += " " + spaced_dom_text[:5000]

                        for raw_email in EMAIL_REGEX.findall(spaced_dom_text):
                            clean_addr, is_ok = await verify_email_address(raw_email)
                            if is_ok and clean_addr not in seen_emails:
                                seen_emails.add(clean_addr)
                                verified_emails.append(clean_addr)

                        if lead["phone_status"] != "Valid":
                            tel_matches = re.findall(r"(?:\+91[\-\s]?)?[6-9]\d{4}[\-\s]?\d{5}", spaced_dom_text)
                            for tm in tel_matches:
                                f_p, p_stat = validate_and_format_phone(tm)
                                if p_stat == "Valid":
                                    lead["phone"] = f_p
                                    lead["phone_status"] = "Valid"
                                    break

                        for a in page_soup.find_all("a", href=True):
                            href = a["href"].strip()
                            l_href = href.lower()
                            if l_href.startswith("mailto:"):
                                clean_addr, is_ok = await verify_email_address(l_href)
                                if is_ok and clean_addr not in seen_emails:
                                    seen_emails.add(clean_addr)
                                    verified_emails.append(clean_addr)

                            if "linkedin.com/in/" in l_href and not dm_info["dm_linkedin"]:
                                dm_info["dm_linkedin"] = href.split("?")[0]

                            for platform, domains in SOCIAL_PATTERNS.items():
                                if not socials[platform]:
                                    if any(d in l_href for d in domains):
                                        if not any(b in l_href for b in ["sharer", "intent/", "/p/", "share.php"]):
                                            socials[platform] = href
            except Exception:
                pass

    need_xray = not dm_info["dm_name"] or not dm_info["dm_linkedin"]
    xray_task = (
        search_linkedin_xray(client, lead.get("business_name", ""), lead.get("location", ""), target_titles)
        if need_xray else asyncio.sleep(0, result={"dm_name": "", "dm_role": "", "dm_linkedin": "", "serp_text": ""})
    )
    b2b_task = fetch_b2b_registry_turnover_and_emails(
        client,
        lead.get("business_name", ""),
        domain,
        lead.get("location", ""),
        need_emails=(len(verified_emails) == 0)
    )

    xray_info, (b2b_text, offsite_emails, b2b_dm) = await asyncio.gather(xray_task, b2b_task)

    for em in offsite_emails:
        if em not in seen_emails:
            seen_emails.add(em)
            verified_emails.append(em)

    if not dm_info["dm_name"] and xray_info["dm_name"]:
        dm_info["dm_name"] = xray_info["dm_name"]
    if not dm_info["dm_role"] and xray_info["dm_role"]:
        dm_info["dm_role"] = xray_info["dm_role"]
    if not dm_info["dm_linkedin"] and xray_info["dm_linkedin"]:
        dm_info["dm_linkedin"] = xray_info["dm_linkedin"]

    if not dm_info["dm_name"] and b2b_dm["dm_name"]:
        dm_info["dm_name"] = b2b_dm["dm_name"]
        dm_info["dm_role"] = b2b_dm["dm_role"]

    full_corpus = f"{combined_site_text} {b2b_text} {xray_info.get('serp_text', '')}"

    entity_type, reg_id = classify_factual_entity_type(
        lead.get("business_name", ""),
        combined_site_text,
        b2b_text
    )
    lead["entity_type"] = entity_type
    lead["cin_or_gst"] = reg_id

    if entity_filter == "pvt_ltd" and entity_type != "Pvt Ltd":
        return lead, True
    if entity_filter == "other" and entity_type == "Pvt Ltd":
        return lead, True

    lead["turnover"] = extract_factual_turnover(combined_site_text, b2b_text)

    size_label, is_size_excluded = detect_real_company_size(full_corpus)
    if is_size_excluded:
        return lead, True
    lead["company_size"] = size_label

    if verified_emails:
        verified_emails.sort(key=lambda em: score_email_priority(em, dm_info["dm_name"]), reverse=True)
        dm_info["dm_email"] = verified_emails[0]
        lead["email"] = ", ".join(verified_emails[:3])
        lead["email_status"] = "Verified (MX)"
    else:
        dm_info["dm_email"] = ""
        lead["email"] = ""
        lead["email_status"] = "Missing"

    lead["instagram"] = socials["instagram"]
    lead["linkedin"] = socials["linkedin"]
    lead["facebook"] = socials["facebook"]
    lead["twitter"] = socials["twitter"]
    lead["dm_name"] = dm_info["dm_name"]
    lead["dm_role"] = dm_info["dm_role"]
    lead["dm_linkedin"] = dm_info["dm_linkedin"]
    lead["dm_email"] = dm_info["dm_email"]

    return lead, False
