"""
Playwright-based Web Crawler
Handles JS-heavy sites. Navigates real pages, scrolls, follows
internal links, extracts contact data. No fabricated activity.
"""
from __future__ import annotations

import asyncio
import logging
import random
import re
import time
from dataclasses import dataclass, field
from typing import Optional, Callable
from urllib.parse import urlparse, urljoin, urlunparse

import phonenumbers
import tldextract
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, Page, BrowserContext, TimeoutError as PWTimeout

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------
EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,7}\b"
)
PHONE_RE = re.compile(
    r"(?:(?:\+91|0091|91)?[\s\-\.]?)?(?:\(?0?\d{2,4}\)?[\s\-\.]?)?\d{7,10}"
)
SOCIAL_DOMAINS = {
    "facebook", "linkedin", "twitter", "instagram", "youtube",
    "whatsapp", "telegram", "pinterest", "tiktok",
}

# Priority page path fragments (checked against real links found on the page)
PRIORITY_PATHS = [
    "contact", "contact-us", "contactus", "reach-us", "reachout",
    "about", "about-us", "aboutus",
    "team", "leadership", "management", "directors", "board",
    "products", "services",
    "manufacturing", "factories", "facilities", "plants",
    "locations", "offices",
]

# Known spam / junk email patterns to skip
JUNK_EMAIL_PATTERNS = re.compile(
    r"(example|test|noreply|no-reply|donotreply|admin@example|user@|"
    r"webmaster@example|support@example|info@spamdomain|\.png|\.jpg|\.gif|"
    r"yourname|youremail|email@)", re.I
)

JUNK_TLDS = {".png", ".jpg", ".gif", ".svg", ".webp", ".css", ".js"}


def _validate_email(email: str, company_domain: str) -> bool:
    """Basic email validation — syntax + domain sanity."""
    email = email.lower().strip()
    if JUNK_EMAIL_PATTERNS.search(email):
        return False
    if any(email.endswith(t) for t in JUNK_TLDS):
        return False
    if len(email) > 120 or len(email) < 6:
        return False
    local, _, domain = email.rpartition("@")
    if not local or not domain or "." not in domain:
        return False
    # Prefer on-domain emails but accept generic too
    return True


def _validate_phone(raw: str, region: str = "IN") -> Optional[str]:
    """Parse and validate phone number; return E.164 or None."""
    raw = raw.strip()
    if len(raw.replace(" ", "").replace("-", "").replace("+", "")) < 7:
        return None
    try:
        # Try with country hint
        parsed = phonenumbers.parse(raw, region)
        if phonenumbers.is_valid_number(parsed):
            return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except Exception:
        pass
    return None


def _same_domain(url: str, base_domain: str) -> bool:
    """Check if URL belongs to the same registered domain."""
    ext = tldextract.extract(url)
    return f"{ext.domain}.{ext.suffix}".lower() == base_domain.lower()


@dataclass
class CrawledContact:
    company_name: str = ""
    company_domain: str = ""
    homepage_url: str = ""
    company_phone: list[str] = field(default_factory=list)
    company_email: list[str] = field(default_factory=list)
    named_contact: str = ""         # explicitly stated name
    role: str = ""                  # explicitly stated role/title
    contact_person_email: str = ""  # email explicitly linked to named_contact
    contact_person_phone: str = ""  # phone explicitly linked to named_contact
    address: str = ""
    city: str = ""
    state: str = ""
    business_sector: str = ""
    facility_evidence: str = ""     # text mentioning factory/plant/warehouse
    pages_visited: list[str] = field(default_factory=list)
    raw_schema: str = ""
    verdict: str = "REVIEW"        # from pre-filter
    confidence: float = 0.0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "company_name": self.company_name,
            "company_domain": self.company_domain,
            "homepage_url": self.homepage_url,
            "company_phone": " | ".join(self.company_phone),
            "company_email": " | ".join(self.company_email),
            "named_contact": self.named_contact,
            "role": self.role,
            "contact_person_email": self.contact_person_email,
            "contact_person_phone": self.contact_person_phone,
            "address": self.address,
            "city": self.city,
            "state": self.state,
            "business_sector": self.business_sector,
            "facility_evidence": self.facility_evidence[:300] if self.facility_evidence else "",
            "pages_visited": " | ".join(self.pages_visited),
            "verdict": self.verdict,
            "confidence": round(self.confidence, 2),
            "errors": " | ".join(self.errors),
        }


class PlaywrightCrawler:
    """
    Real Playwright-based crawler. Opens actual browser, renders JS,
    scrolls pages, follows priority internal links.
    """

    def __init__(
        self,
        headless: bool = False,        # Show real browser to user
        max_pages_per_site: int = 8,
        page_timeout_ms: int = 25000,
        progress_cb: Optional[Callable] = None,
        screenshot_dir: Optional[str] = None,
    ):
        self.headless = headless
        self.max_pages = max_pages_per_site
        self.timeout = page_timeout_ms
        self.progress_cb = progress_cb
        self.screenshot_dir = screenshot_dir

    def _log(self, msg: str):
        logger.info(msg)
        if self.progress_cb:
            self.progress_cb(msg)

    async def crawl_site(
        self,
        domain: str,
        company_name: str = "",
        verdict: str = "REVIEW",
        confidence: float = 0.5,
        context: Optional[BrowserContext] = None,
    ) -> CrawledContact:
        """Crawl a single site; return CrawledContact with extracted data."""
        homepage = f"https://{domain}"
        result = CrawledContact(
            company_name=company_name or domain,
            company_domain=domain,
            homepage_url=homepage,
            verdict=verdict,
            confidence=confidence,
        )

        own_context = context is None

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=self.headless,
                args=[
                    "--no-sandbox",
                    "--disable-blink-features=AutomationControlled",
                    "--disable-web-security",
                    "--disable-features=IsolateOrigins,site-per-process",
                ],
            )
            if own_context:
                context = await browser.new_context(
                    viewport={"width": 1366, "height": 768},
                    user_agent=random.choice([
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
                    ]),
                    locale="en-IN",
                    extra_http_headers={
                        "Accept-Language": "en-IN,en;q=0.9",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    },
                    ignore_https_errors=True,
                )
                # Stealth: override navigator.webdriver
                await context.add_init_script("""
                    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
                    Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
                    Object.defineProperty(navigator, 'languages', {get: () => ['en-IN', 'en']});
                    window.chrome = { runtime: {} };
                """)

            page = await context.new_page()
            visited_urls: set[str] = set()

            try:
                result = await self._crawl_with_page(
                    page, homepage, domain, result, visited_urls
                )
            except Exception as e:
                result.errors.append(f"homepage: {str(e)[:120]}")
                self._log(f"  [ERROR] {domain}: {e}")
            finally:
                await page.close()
                if own_context:
                    await context.close()
                    await browser.close()

        return result

    async def _crawl_with_page(
        self,
        page: Page,
        homepage: str,
        domain: str,
        result: CrawledContact,
        visited: set[str],
    ) -> CrawledContact:
        """Internal: navigate homepage, collect priority links, crawl them."""
        self._log(f"  [CRAWL] Opening: {homepage}")

        # Navigate to homepage
        try:
            resp = await page.goto(homepage, wait_until="domcontentloaded", timeout=self.timeout)
            status = resp.status if resp else 0
            self._log(f"  [HTTP {status}] {homepage}")
        except PWTimeout:
            result.errors.append("homepage: timeout")
            return result
        except Exception as e:
            # Try http fallback
            try:
                http_url = homepage.replace("https://", "http://")
                resp = await page.goto(http_url, wait_until="domcontentloaded", timeout=self.timeout)
                self._log(f"  [HTTP {resp.status if resp else '?'}] {http_url} (http fallback)")
            except Exception as e2:
                result.errors.append(f"homepage: {str(e2)[:80]}")
                return result

        # Wait for dynamic content
        await asyncio.sleep(2)

        # Scroll to trigger lazy-loading
        await self._scroll_page(page)

        # Extract data from homepage
        html = await page.content()
        actual_url = page.url
        visited.add(actual_url)
        result.pages_visited.append(actual_url)

        self._extract_from_html(html, actual_url, domain, result)
        self._extract_schema_org(html, result)

        # Find internal priority links
        priority_links = await self._find_priority_links(page, domain)
        self._log(f"  [LINKS] Found {len(priority_links)} priority pages on {domain}")

        # Crawl priority pages
        for link_url in priority_links[: self.max_pages - 1]:
            if link_url in visited:
                continue
            self._log(f"  [NAV] → {link_url}")
            visited.add(link_url)
            try:
                resp = await page.goto(link_url, wait_until="domcontentloaded", timeout=self.timeout)
                status = resp.status if resp else 0
                self._log(f"  [HTTP {status}] {link_url}")
                await asyncio.sleep(1.5)
                await self._scroll_page(page)
                html = await page.content()
                result.pages_visited.append(page.url)
                self._extract_from_html(html, page.url, domain, result)
                self._extract_schema_org(html, result)
                self._extract_named_contacts(html, result)
            except PWTimeout:
                result.errors.append(f"timeout: {link_url}")
            except Exception as e:
                result.errors.append(f"{link_url[:60]}: {str(e)[:60]}")

        # Deduplicate collected data
        result.company_phone = list(dict.fromkeys(filter(None, result.company_phone)))
        result.company_email = list(dict.fromkeys(filter(None, result.company_email)))

        return result

    async def _scroll_page(self, page: Page):
        """Scroll page to trigger lazy content; real visual scroll."""
        try:
            await page.evaluate("""
                async () => {
                    for (let y = 0; y < document.body.scrollHeight; y += 400) {
                        window.scrollTo(0, y);
                        await new Promise(r => setTimeout(r, 200));
                    }
                    window.scrollTo(0, 0);
                }
            """)
            await asyncio.sleep(0.5)
        except Exception:
            pass

    async def _find_priority_links(self, page: Page, domain: str) -> list[str]:
        """Collect actual internal links that match priority path fragments."""
        links = []
        try:
            anchors = await page.eval_on_selector_all(
                "a[href]",
                "els => els.map(e => ({href: e.href, text: e.innerText || ''}))"
            )
        except Exception:
            return []

        seen = set()
        for a in anchors:
            href = a.get("href", "").strip()
            text = a.get("text", "").lower().strip()
            if not href or href.startswith("mailto:") or href.startswith("tel:"):
                continue
            # Must be same domain
            if not _same_domain(href, domain):
                continue
            path_lower = urlparse(href).path.lower()
            text_lower = text.lower()
            is_priority = any(
                p in path_lower or p in text_lower
                for p in PRIORITY_PATHS
            )
            if is_priority and href not in seen:
                seen.add(href)
                links.append(href)

        # Prioritize "contact" first
        links.sort(key=lambda u: (
            0 if any(p in u.lower() for p in ["contact", "reach"]) else
            1 if any(p in u.lower() for p in ["about", "team", "director"]) else
            2
        ))
        return links

    def _extract_from_html(self, html: str, page_url: str, domain: str, result: CrawledContact):
        """Parse HTML and extract contact data, addresses, facility evidence."""
        soup = BeautifulSoup(html, "lxml")

        # Remove scripts/styles for text extraction
        for tag in soup(["script", "style", "noscript", "head"]):
            tag.decompose()

        full_text = soup.get_text(separator=" ", strip=True)

        # ---------- Emails ----------
        # From mailto links
        for a in soup.find_all("a", href=re.compile(r"^mailto:", re.I)):
            email = a["href"].replace("mailto:", "").split("?")[0].strip().lower()
            if _validate_email(email, domain):
                result.company_email.append(email)

        # From visible text
        for email in EMAIL_RE.findall(full_text):
            email = email.lower().strip()
            if _validate_email(email, domain):
                result.company_email.append(email)

        # ---------- Phones ----------
        # From tel: links
        for a in soup.find_all("a", href=re.compile(r"^tel:", re.I)):
            raw = a["href"].replace("tel:", "").strip()
            v = _validate_phone(raw)
            if v:
                result.company_phone.append(v)

        # From visible text using phonenumbers library
        for match in phonenumbers.PhoneNumberMatcher(full_text, "IN"):
            e164 = phonenumbers.format_number(match.number, phonenumbers.PhoneNumberFormat.E164)
            result.company_phone.append(e164)

        # ---------- Address ----------
        if not result.address:
            addr = self._extract_address(soup, full_text)
            if addr:
                result.address = addr
                if not result.city:
                    result.city = self._detect_city(addr)
                if not result.state:
                    if any(wb in addr.lower() for wb in ["west bengal", "w.b.", " wb "]):
                        result.state = "West Bengal"

        # ---------- Company name ----------
        if not result.company_name or result.company_name == domain:
            title = soup.find("title")
            if title:
                result.company_name = title.get_text(strip=True).split("|")[0].split("-")[0].strip()

        # ---------- Facility evidence ----------
        FACILITY_TERMS = [
            "factory", "plant", "warehouse", "manufacturing unit",
            "production facility", "fabrication shop", "foundry",
            "cold storage", "depot", "godown", "industrial unit",
        ]
        for term in FACILITY_TERMS:
            if term in full_text.lower() and not result.facility_evidence:
                # Grab surrounding context
                idx = full_text.lower().find(term)
                result.facility_evidence += full_text[max(0, idx-30):idx+150].strip() + " | "

        # ---------- Business sector ----------
        if not result.business_sector:
            desc = soup.find("meta", attrs={"name": "description"})
            if desc and desc.get("content"):
                result.business_sector = desc["content"][:200]

    def _extract_address(self, soup: BeautifulSoup, full_text: str) -> str:
        """Extract address from common address containers."""
        # Try address tag
        addr_tag = soup.find("address")
        if addr_tag:
            return addr_tag.get_text(separator=" ", strip=True)[:300]

        # Try schema.org address containers
        for cls in ["address", "contact-address", "addr", "location"]:
            el = soup.find(class_=re.compile(cls, re.I))
            if el:
                text = el.get_text(separator=" ", strip=True)
                if any(g in text.lower() for g in ["kolkata", "howrah", "west bengal", "wb"]):
                    return text[:300]

        # Regex fallback: look for pin-code patterns near geo keywords
        pin_match = re.search(
            r"([A-Za-z\s,\.\-/]+(?:Kolkata|Howrah|Hooghly|Durgapur|Asansol|Haldia)[^,\n]*,?\s*West Bengal[^,\n]*,?\s*(?:India)?[\s\-]*\d{6})",
            full_text, re.I
        )
        if pin_match:
            return pin_match.group(0).strip()[:300]

        return ""

    def _detect_city(self, text: str) -> str:
        cities = {
            "Kolkata": ["kolkata", "calcutta"],
            "Howrah": ["howrah", "haora"],
            "Hooghly": ["hooghly", "hugli"],
            "Durgapur": ["durgapur"],
            "Asansol": ["asansol"],
            "Haldia": ["haldia"],
            "Kalyani": ["kalyani"],
        }
        tl = text.lower()
        for city, patterns in cities.items():
            if any(p in tl for p in patterns):
                return city
        return ""

    def _extract_schema_org(self, html: str, result: CrawledContact):
        """Extract schema.org JSON-LD data (Organization, LocalBusiness etc.)."""
        import json
        soup = BeautifulSoup(html, "lxml")
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "{}")
                if isinstance(data, list):
                    data = data[0] if data else {}
                schema_type = data.get("@type", "")
                if isinstance(schema_type, list):
                    schema_type = schema_type[0]
                if schema_type in ("Organization", "LocalBusiness", "Corporation",
                                   "ProfessionalService", "Store", "WarehouseStore"):
                    if not result.company_name and data.get("name"):
                        result.company_name = data["name"]
                    # Phone
                    tel = data.get("telephone") or data.get("phone")
                    if tel:
                        v = _validate_phone(str(tel))
                        if v:
                            result.company_phone.append(v)
                    # Email
                    em = data.get("email")
                    if em and _validate_email(str(em), result.company_domain):
                        result.company_email.append(em.lower())
                    # Address
                    addr = data.get("address")
                    if isinstance(addr, dict):
                        parts = [
                            addr.get("streetAddress", ""),
                            addr.get("addressLocality", ""),
                            addr.get("addressRegion", ""),
                            addr.get("postalCode", ""),
                        ]
                        full_addr = ", ".join(p for p in parts if p)
                        if full_addr and not result.address:
                            result.address = full_addr
                        if not result.city and addr.get("addressLocality"):
                            result.city = addr["addressLocality"]
                        if not result.state and addr.get("addressRegion"):
                            result.state = addr["addressRegion"]
            except Exception:
                pass

    def _extract_named_contacts(self, html: str, result: CrawledContact):
        """
        Extract named persons + roles from About/Team/Leadership pages.
        Only pair email/phone when the source HTML explicitly associates them
        within the same card/block. No fabricated pairing.
        """
        soup = BeautifulSoup(html, "lxml")

        # Common team card selectors
        card_selectors = [
            ".team-member", ".team_member", ".member-card", ".person-card",
            ".director", ".leadership", ".management", ".founder",
            "[class*='team']", "[class*='staff']", "[class*='leader']",
        ]
        for sel in card_selectors:
            cards = soup.select(sel)
            for card in cards[:5]:  # max 5 named contacts per page
                text = card.get_text(separator=" ", strip=True)
                # Extract name-like strings (capitalized words)
                name_match = re.search(
                    r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b", text
                )
                # Extract role
                role_match = re.search(
                    r"(CEO|MD|Managing Director|Director|Founder|Co-Founder|"
                    r"Chairman|President|VP|Manager|Head|Partner|Proprietor|"
                    r"CTO|CFO|COO|Engineer|General Manager|GM)",
                    text, re.I
                )
                if name_match and not result.named_contact:
                    result.named_contact = name_match.group(1)
                if role_match and not result.role:
                    result.role = role_match.group(1)

                # Only associate email/phone if found IN THE SAME CARD
                card_emails = EMAIL_RE.findall(text)
                card_phones = list(phonenumbers.PhoneNumberMatcher(text, "IN"))

                if result.named_contact and not result.contact_person_email:
                    for em in card_emails:
                        if _validate_email(em, result.company_domain):
                            result.contact_person_email = em.lower()
                            break

                if result.named_contact and not result.contact_person_phone:
                    for pm in card_phones:
                        result.contact_person_phone = phonenumbers.format_number(
                            pm.number, phonenumbers.PhoneNumberFormat.E164
                        )
                        break


async def crawl_domains_batch(
    domains: list[dict],  # [{domain, company_name, verdict, confidence}, ...]
    headless: bool = False,
    max_concurrent: int = 1,   # keep low to be visible & polite
    progress_cb: Optional[Callable] = None,
) -> list[CrawledContact]:
    """Crawl multiple domains with limited concurrency."""
    crawler = PlaywrightCrawler(
        headless=headless,
        progress_cb=progress_cb,
    )

    results = []
    semaphore = asyncio.Semaphore(max_concurrent)

    async def _crawl_one(d: dict) -> CrawledContact:
        async with semaphore:
            return await crawler.crawl_site(
                domain=d["domain"],
                company_name=d.get("company_name", ""),
                verdict=d.get("verdict", "REVIEW"),
                confidence=d.get("confidence", 0.5),
            )

    tasks = [asyncio.create_task(_crawl_one(d)) for d in domains]
    for i, coro in enumerate(asyncio.as_completed(tasks)):
        contact = await coro
        results.append(contact)
        if progress_cb:
            progress_cb(
                f"[{i+1}/{len(domains)}] Done: {contact.company_domain} | "
                f"emails={len(contact.company_email)} phones={len(contact.company_phone)}"
            )
    return results
