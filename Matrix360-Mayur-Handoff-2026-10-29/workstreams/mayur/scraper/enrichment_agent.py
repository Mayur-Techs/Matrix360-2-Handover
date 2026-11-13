import asyncio
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

from scraper.domain_discovery import _score_company

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
IGNORE_EMAIL_EXT = (
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".js", ".css", ".woff", ".woff2", ".ttf", ".ico", ".mp4", ".pdf"
)
IGNORE_EMAIL_DOMAINS = (
    "sentry.io", "wixpress.com", "example.com", "domain.com",
    "email.com", "yoursite.com", "yourdomain.com", "wordpress.org",
    "w3.org", "schema.org", "googleapis.com", "cloudflare.com",
    "godaddy.com", "secureserver.net", "mailinator.com", "tempmail.com"
)

SOCIAL_PATTERNS = {
    "instagram": ("instagram.com/",),
    "linkedin": ("linkedin.com/company/", "linkedin.com/school/"),
    "facebook": ("facebook.com/",),
    "twitter": ("twitter.com/", "x.com/")
}

# Junior roles strictly excluded
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
    "education": ["school", "college", "university", "coaching institute", "training center", "academy"],
    "retail": ["retail store", "shopping mall", "supermarket", "grocery store", "warehouse club"],
    "hospitality": ["hotel", "restaurant", "cafe", "resort", "guest house"],
    "residential": ["residential apartment", "housing society", "flat broker", "villa"]
}

VALID_COMPANY_SIZE_RANGES = [
    "11-50", "11–50", "51-200", "51–200",
    "201-500", "201–500", "501-1,000", "501–1,000", "501-1000",
    "1,001-5,000", "1,001–5,000", "1001-5000"
]

DOMAIN_MX_CACHE: Dict[str, bool] = {}

PERSON_NAME_PATTERN = r"(?:Dr\.?\s+|Mr\.?\s+|Ms\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z]\.?|\s+[A-Z][a-z]+){1,2}"

STOP_NAME_WORDS = {
    "about", "contact", "company", "services", "home", "read", "more", "view",
    "profile", "our", "team", "meet", "the", "welcome", "privacy", "policy",
    "terms", "copyright", "rights", "reserved", "years", "experience", "business",
    "solutions", "group", "agency", "india", "private", "limited", "inc", "llc",
    "manufacturing", "industrial", "plant", "factory", "warehouse", "logistics",
    "kolkata", "howrah", "hooghly", "odisha", "bihar", "jharkhand", "assam", "bengal", "enterprise"
}


def validate_and_format_phone(raw_phone: str) -> Tuple[str, str]:
    """
    Validates Indian & international phone numbers.
    Returns (formatted_phone, 'Valid' | 'Invalid').
    """
    if not raw_phone:
        return "", "Invalid"

    digits = "".join(ch for ch in raw_phone if ch.isdigit())
    if not digits or len(digits) < 10 or len(digits) > 13:
        return "", "Invalid"

    # Reject repeated fake digits like 9999999999 or 0000000000
    if len(set(digits[-10:])) <= 2:
        return "", "Invalid"

    # Normalize Indian 10-digit mobile or STD landline numbers
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
    """Checks if a domain has valid DNS MX records or mail host A records."""
    domain = domain.lower().strip()
    if not domain or "." not in domain:
        return False
    if any(bad in domain for bad in IGNORE_EMAIL_DOMAINS):
        return False
    if domain in DOMAIN_MX_CACHE:
        return DOMAIN_MX_CACHE[domain]

    is_valid = False
    if HAS_DNSPYTHON:
        try:
            resolver = dns.resolver.Resolver()
            resolver.lifetime = 3.5
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


async def verify_email_address(email: str) -> bool:
    """Verifies email syntax, filters junk extensions/domains, and confirms DNS MX mail server."""
    if not email or "@" not in email:
        return False
    clean = email.lower().strip()
    if clean.endswith(IGNORE_EMAIL_EXT):
        return False
    if not EMAIL_REGEX.match(clean):
        return False

    local_part, domain = clean.split("@", 1)
    if len(local_part) < 2 or len(local_part) > 64:
        return False
    if any(bad in clean for bad in IGNORE_EMAIL_DOMAINS):
        return False

    return await asyncio.to_thread(verify_domain_mx_sync, domain)


def build_title_regex(target_titles: List[str]) -> str:
    escaped = []
    for t in target_titles:
        clean_t = t.strip()
        if clean_t:
            escaped.append(re.escape(clean_t).replace(r"\ ", r"\s+"))
    if not escaped:
        escaped = [
            "Founder", "Co-?Founder", "Owner", "MD", "Managing\\s+Director",
            "CEO", "Director", "Partner", "COO", "Plant\\s+Head",
            "Expansion\\s+Head", "Logistics\\s+Head"
        ]
    return "(?:" + "|".join(escaped) + ")"


def is_valid_person_name(name: str) -> bool:
    if not name or len(name) < 4 or len(name) > 42:
        return False
    clean = re.sub(r"^(?:Dr|Mr|Ms|Mrs|Sri|Smt)\.?\s+", "", name, flags=re.I).strip()
    words = [w.strip(".") for w in clean.split() if w.strip(".")]
    if len(words) < 2 or len(words) > 4:
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

    name_near_title = re.compile(
        rf"({PERSON_NAME_PATTERN})\s*[\-–—,|:\n]\s*({titles_pat})\b",
        re.IGNORECASE
    )
    title_near_name = re.compile(
        rf"\b({titles_pat})\s*[\-–—,|:\n]\s*({PERSON_NAME_PATTERN})",
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


async def search_linkedin_xray_and_size(
    client: httpx.AsyncClient,
    business_name: str,
    location: str,
    target_titles: List[str]
) -> dict:
    """
    Finds the Decision Maker on LinkedIn matching the target titles (excluding junior roles)
    and checks for company employee size.
    """
    info = {"dm_name": "", "dm_role": "", "dm_linkedin": "", "company_size": ""}
    if not business_name:
        return info

    clean_biz = re.sub(r"\b(Pvt\.?|Ltd\.?|LLC|Inc\.?|Limited|Private|India)\b", "", business_name, flags=re.I).strip()
    city = location.split(",")[0].strip()

    titles_or = " OR ".join(f'"{t.strip()}"' for t in target_titles[:8] if t.strip())
    if not titles_or:
        titles_or = 'Founder OR Owner OR MD OR CEO OR Director OR Partner OR COO OR "Plant Head" OR "Logistics Head"'

    dork_query = f'site:linkedin.com/in/ "{clean_biz}" {city} ({titles_or})'

    search_urls = [
        f"https://search.yahoo.com/search?p={quote_plus(dork_query)}&n=6",
        f"https://html.duckduckgo.com/html/?q={quote_plus(dork_query)}"
    ]

    for search_url in search_urls:
        try:
            resp = await client.get(search_url, timeout=8.0, follow_redirects=True)
            if resp.status_code != 200:
                continue

            soup = BeautifulSoup(resp.text, "html.parser")
            page_text = soup.get_text(" ", strip=True)
            for size_range in VALID_COMPANY_SIZE_RANGES:
                if size_range in page_text:
                    info["company_size"] = f"{size_range} employees"
                    break

            for a in soup.find_all("a", href=True):
                raw_href = a["href"]
                if "RU=" in raw_href:
                    try:
                        raw_href = unquote(raw_href.split("RU=")[1].split("/RK=")[0])
                    except Exception:
                        pass
                elif "uddg=" in raw_href:
                    try:
                        raw_href = unquote(raw_href.split("uddg=")[1].split("&")[0])
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
        except Exception:
            continue

    return info


async def discover_offsite_emails(client: httpx.AsyncClient, business_name: str, domain: str, location: str) -> List[str]:
    """
    If a company's website does not list an email directly, searches public web indexes
    for published emails belonging to the company domain or business name.
    """
    discovered = []
    city = location.split(",")[0].strip()
    if domain and not any(g in domain for g in ["facebook.com", "instagram.com", "justdial.com", "indiamart.com"]):
        query = f'"@{domain}" OR ("{business_name}" {city} email)'
    else:
        query = f'"{business_name}" {city} ("@" OR "email" OR "contact")'

    search_url = f"https://search.yahoo.com/search?p={quote_plus(query)}&n=8"
    try:
        resp = await client.get(search_url, timeout=8.0, follow_redirects=True)
        if resp.status_code == 200:
            for raw_mail in EMAIL_REGEX.findall(resp.text):
                clean = raw_mail.lower().strip()
                if await verify_email_address(clean):
                    if clean not in discovered:
                        discovered.append(clean)
    except Exception:
        pass
    return discovered


def check_page_exclusions(html_text: str, exclusions: List[str]) -> bool:
    """Checks if website content strongly indicates an excluded industry."""
    low_text = html_text[:6000].lower()
    for ex in exclusions:
        ex_key = ex.strip().lower()
        if ex_key in INDUSTRY_EXCLUSION_MAP:
            for phrase in INDUSTRY_EXCLUSION_MAP[ex_key]:
                if phrase in low_text:
                    return True
        elif ex_key and ex_key != "junior roles":
            if phrase := ex_key:
                if phrase in low_text:
                    return True
    return False


async def enrich_and_verify_lead(
    client: httpx.AsyncClient,
    lead: dict,
    target_titles: List[str],
    exclusions: List[str],
    target_company_size: str
) -> Tuple[dict, bool]:
    """
    Enriches a candidate lead, verifies phone & email via DNS MX, checks industry/role exclusions,
    computes Lakhotia pre-filter fit, and returns (enriched_lead, is_excluded).
    """
    # 1. Validate Phone Number
    formatted_phone, phone_status = validate_and_format_phone(lead.get("phone", ""))
    lead["phone"] = formatted_phone
    lead["phone_status"] = phone_status

    url = (lead.get("website") or "").strip()
    verified_emails: List[str] = []
    seen_emails = set()

    socials = {"instagram": "", "linkedin": "", "facebook": "", "twitter": ""}
    dm_info = {"dm_name": "", "dm_role": "", "dm_linkedin": "", "dm_email": ""}
    domain = ""
    full_crawled_text = ""
    facility_evidence = ""

    # 2. Crawl Company Website
    if url:
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        parsed_u = urlparse(url)
        domain = parsed_u.netloc.lower().replace("www.", "")

        pages_to_crawl = [url]
        try:
            resp = await client.get(url, timeout=9.0, follow_redirects=True)
            if resp.status_code == 200:
                if check_page_exclusions(resp.text, exclusions):
                    return lead, True

                full_crawled_text += " " + resp.text[:4000]
                soup = BeautifulSoup(resp.text, "html.parser")
                priority_keywords = [
                    "contact", "about", "team", "leader", "founder",
                    "director", "management", "plant", "factory", "facility",
                    "warehouse", "logistics", "who-we-are", "reach"
                ]

                for a in soup.find_all("a", href=True):
                    href = a["href"].strip()
                    lower_h = href.lower()
                    if lower_h.startswith("mailto:"):
                        mail = lower_h.replace("mailto:", "").split("?")[0].strip()
                        if mail not in seen_emails and await verify_email_address(mail):
                            seen_emails.add(mail)
                            verified_emails.append(mail)
                    elif any(k in lower_h for k in priority_keywords):
                        full_url = urljoin(url, href)
                        if urlparse(full_url).netloc == parsed_u.netloc and full_url not in pages_to_crawl:
                            pages_to_crawl.append(full_url)
                            if len(pages_to_crawl) >= 5:
                                break

                for idx, page_url in enumerate(pages_to_crawl):
                    html_text = resp.text if idx == 0 else ""
                    if idx > 0:
                        try:
                            sub_resp = await client.get(page_url, timeout=7.0, follow_redirects=True)
                            if sub_resp.status_code == 200:
                                html_text = sub_resp.text
                                full_crawled_text += " " + html_text[:3000]
                        except Exception:
                            continue

                    if not html_text:
                        continue

                    for raw_email in EMAIL_REGEX.findall(html_text):
                        clean_mail = raw_email.lower().strip()
                        if clean_mail not in seen_emails and await verify_email_address(clean_mail):
                            seen_emails.add(clean_mail)
                            verified_emails.append(clean_mail)

                    # Also check if website has a valid phone if candidate had none
                    if lead["phone_status"] != "Valid":
                        tel_matches = re.findall(r"(?:\+91[\-\s]?)?[6-9]\d{4}[\-\s]?\d{5}", html_text)
                        for tm in tel_matches:
                            f_p, p_stat = validate_and_format_phone(tm)
                            if p_stat == "Valid":
                                lead["phone"] = f_p
                                lead["phone_status"] = "Valid"
                                break

                    page_soup = BeautifulSoup(html_text, "html.parser")
                    if not dm_info["dm_name"]:
                        extracted_dm = extract_dm_from_html(page_soup, target_titles)
                        if extracted_dm["dm_name"] or extracted_dm["dm_linkedin"]:
                            dm_info.update({k: v for k, v in extracted_dm.items() if v})

                    for a in page_soup.find_all("a", href=True):
                        href = a["href"].strip()
                        l_href = href.lower()
                        if l_href.startswith("mailto:"):
                            mail = l_href.replace("mailto:", "").split("?")[0].strip()
                            if mail not in seen_emails and await verify_email_address(mail):
                                seen_emails.add(mail)
                                verified_emails.append(mail)

                        if "linkedin.com/in/" in l_href and not dm_info["dm_linkedin"]:
                            dm_info["dm_linkedin"] = href.split("?")[0]

                        for platform, domains in SOCIAL_PATTERNS.items():
                            if not socials[platform]:
                                if any(d in l_href for d in domains):
                                    if not any(b in l_href for b in ["sharer", "intent/", "/p/", "share.php"]):
                                        socials[platform] = href
        except Exception:
            pass

    # Extract industrial facility evidence
    for term in ["factory", "plant", "warehouse", "manufacturing unit", "production facility", "fabrication", "foundry", "cold storage"]:
        if term in full_crawled_text.lower():
            idx = full_crawled_text.lower().find(term)
            facility_evidence = full_crawled_text[max(0, idx - 20):idx + 140].strip()
            break
    lead["facility_evidence"] = facility_evidence

    # 3. Off-Site Verified Email Discovery Fallback
    if not verified_emails:
        offsite = await discover_offsite_emails(
            client,
            lead.get("business_name", ""),
            domain,
            lead.get("location", "")
        )
        for em in offsite:
            if em not in seen_emails:
                seen_emails.add(em)
                verified_emails.append(em)

    # 4. LinkedIn X-Ray Search for Decision Makers & Company Size
    xray_info = await search_linkedin_xray_and_size(
        client,
        lead.get("business_name", ""),
        lead.get("location", ""),
        target_titles
    )
    if not dm_info["dm_name"] and xray_info["dm_name"]:
        dm_info["dm_name"] = xray_info["dm_name"]
    if not dm_info["dm_role"] and xray_info["dm_role"]:
        dm_info["dm_role"] = xray_info["dm_role"]
    if not dm_info["dm_linkedin"] and xray_info["dm_linkedin"]:
        dm_info["dm_linkedin"] = xray_info["dm_linkedin"]

    lead["company_size"] = xray_info.get("company_size") or target_company_size

    # 5. Match Verified Email to Decision Maker
    if verified_emails:
        dm_matched = verified_emails[0]
        if dm_info["dm_name"]:
            first_n = dm_info["dm_name"].split()[0].lower()
            for v_mail in verified_emails:
                if first_n in v_mail.split("@")[0].lower():
                    dm_matched = v_mail
                    break
        dm_info["dm_email"] = dm_matched
        lead["email"] = ", ".join(verified_emails[:3])
        lead["email_status"] = "Verified (MX)"
    else:
        dm_info["dm_email"] = ""
        lead["email"] = ""
        lead["email_status"] = "Missing"

    # 6. Compute Lakhotia Pre-Filter fit
    verdict, conf, geo_hits, pos_hits, neg_hits = _score_company(
        lead.get("business_name", ""),
        full_crawled_text[:2000] or lead.get("niche", ""),
        domain or lead.get("business_name", "")
    )
    lead["verdict"] = verdict
    lead["confidence"] = conf

    lead["instagram"] = socials["instagram"]
    lead["linkedin"] = socials["linkedin"]
    lead["facebook"] = socials["facebook"]
    lead["twitter"] = socials["twitter"]
    lead["dm_name"] = dm_info["dm_name"]
    lead["dm_role"] = dm_info["dm_role"]
    lead["dm_linkedin"] = dm_info["dm_linkedin"]
    lead["dm_email"] = dm_info["dm_email"]

    return lead, False
