from __future__ import annotations

import asyncio
import csv
import json
import re
import time
import urllib.robotparser
from collections.abc import Callable
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

from playwright.async_api import Browser, Page, async_playwright

from .models import CompanyResult, CompanySeed, ContactEvidence, PageEvidence
from .rules import canonical_domain, classify, clean_text, is_same_domain

MAX_TEXT_CHARS = 40_000
PRIORITY_PATHS = (
    "contact", "reach", "about", "leadership", "management", "director", "team",
    "product", "service", "manufactur", "factor", "facilit", "location", "company",
)
EMAIL_RE = re.compile(r"(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?![\w.-])", re.I)
PHONE_RE = re.compile(r"(?<![A-Za-z0-9])(?:\+?\d{1,3}[\s.-]?)?(?:\(?0?\d{2,5}\)?[\s.-]?)?\d[\d\s().-]{6,}\d(?![A-Za-z0-9])")
ROLE_RE = re.compile(r"([A-Z][A-Za-z .'-]{2,70})\s*[,|–-]\s*(Founder|Co[- ]?founder|Director|Managing Director|CEO|Partner|Proprietor|Head of [A-Za-z ]+|General Manager|President|Vice President|Owner|Operations Manager)", re.I)
ADDRESS_RE = re.compile(r"(?:[A-Z][A-Za-z0-9&().'/-]*[ ,:-]+){1,20}\b\d{5,6}\b", re.I)
LINKEDIN_RE = re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/(?:company|in)/[A-Za-z0-9_-]+", re.I)
EMPLOYEE_SIGNAL_RE = re.compile(r"\b(\d+[\d,]*|\d+[-–]\d+)\s*(?:\+\s*)?(?:employees|staff|team members|workforce|professionals)\b", re.I)
FACILITY_SIGNAL_RE = re.compile(r"\b(\d+[\d,]*)\s*(?:sq(?:uare)?\.?\s*(?:ft|feet|meters|mtrs|yards))\b", re.I)


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)


def discovered_links(html: str, page_url: str, domain: str, max_pages: int) -> list[str]:
    parser = LinkParser()
    parser.feed(html)

    def link_key(value: str) -> str:
        parsed = urlparse(value)
        return f"{canonical_domain(value)}{parsed.path.rstrip('/') or '/'}?{parsed.query}"

    seen: set[str] = {link_key(page_url)}
    candidates: list[str] = []
    for raw in parser.links:
        url = urljoin(page_url, unquote(raw)).split("#", 1)[0]
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not is_same_domain(url, domain):
            continue
        key = link_key(url)
        if key not in seen:
            seen.add(key)
            candidates.append(url)

    def priority(item: str) -> tuple[int, str]:
        path = urlparse(item).path.lower()
        for rank, term in enumerate(PRIORITY_PATHS):
            if term in path:
                return rank, item
        return len(PRIORITY_PATHS), item

    return sorted(candidates, key=priority)[:max_pages]


async def robots_allowed(page: Page, url: str, user_agent: str) -> tuple[bool, str | None]:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    parser = urllib.robotparser.RobotFileParser()
    try:
        response = await page.goto(robots_url, wait_until="domcontentloaded", timeout=15_000)
        if response is None:
            return True, None
        if response.status in {404, 403}:
            return True, None
        if response.status != 200:
            return True, None
        text = await page.locator("body").inner_text(timeout=4_000)
        parser.parse(text.splitlines())
        return parser.can_fetch(user_agent, url), None
    except Exception:
        # Non-blocking: assume allowed on timeout or non-standard robots response
        return True, None


def extract_contacts(seed: CompanySeed, result: CompanyResult) -> list[ContactEvidence]:
    seen: set[tuple[str, str, str, str]] = set()
    output: list[ContactEvidence] = []
    linkedin_url = result.linkedin_url or seed.linkedin_url
    for page in result.pages:
        # Also discover any LinkedIn links in page HTML/text
        if not linkedin_url:
            li_match = LINKEDIN_RE.search(page.text)
            if li_match:
                linkedin_url = li_match.group(0)
                result.linkedin_url = linkedin_url

        emails = sorted(set(EMAIL_RE.findall(page.text)))
        # Filter out common false-positive image extensions in emails
        emails = [e for e in emails if not re.search(r"\.(png|jpg|jpeg|gif|webp|svg)$", e, re.I)]
        phones = sorted({phone for match in PHONE_RE.findall(page.text) if (phone := valid_phone(match))})
        people = ROLE_RE.findall(page.text)
        address = observed_address(page.text)
        rows = max(len(emails), len(phones), len(people), 1 if (result.reasons or address) else 0)

        for index in range(rows):
            person, role = people[index] if index < len(people) else ("", "")
            email = emails[index] if index < len(emails) else ""
            phone = phones[index] if index < len(phones) else ""
            key = (email, phone, person, page.final_url)
            if key in seen and (email or phone or person):
                continue
            seen.add(key)
            output.append(ContactEvidence(
                company_name=seed.company_name,
                domain=seed.domain,
                fit_status=result.fit_status,
                fit_confidence=result.fit_confidence,
                company_phone=phone if not person else "",
                company_email=email if not person else "",
                named_contact=clean_text(person),
                role=clean_text(role),
                contact_person_email="",
                contact_person_phone="",
                address=address,
                location_type=location_type(page.text, address),
                source_location_hint=seed.location_hint,
                sector_description="; ".join(result.reasons),
                facility_evidence="; ".join(reason for reason in result.reasons if "facility" in reason or "manufacturing" in reason),
                research_fit_reasons="; ".join(result.reasons or result.exclusion_reasons),
                source_url=page.final_url,
                source_page_title=page.title,
                fit_score=result.fit_score,
                company_size=result.company_size,
                qualification_summary=result.qualification_summary,
                linkedin_url=linkedin_url,
            ))
    return output


def valid_phone(value: str) -> str | None:
    value = clean_text(value)
    digits = re.sub(r"\D", "", value)
    if len(digits) < 7 or len(digits) > 15:
        return None
    if re.fullmatch(r"\d{1,2}[.]\d{1,2}[.]\d{4}", value) or re.fullmatch(r"(?:19|20)\d{2}-\d{4}", value):
        return None
    if len(digits) > 3 and all(int(digits[index + 1]) - int(digits[index]) == 1 for index in range(len(digits) - 1)):
        return None
    return value


def observed_address(value: str) -> str:
    matches = [clean_text(match) for match in ADDRESS_RE.findall(value)]
    return max(matches, key=len) if matches else ""


def location_type(page_text: str, address: str) -> str:
    if not address:
        return "unknown"
    lowered = page_text.lower()
    if "head office" in lowered or "registered office" in lowered or " - hq" in lowered or "corporate office" in lowered:
        return "head_office"
    if "factory" in lowered or "plant" in lowered or "manufacturing facility" in lowered or "works" in lowered:
        return "facility_or_plant"
    if "warehouse" in lowered or "depot" in lowered or "distribution center" in lowered:
        return "warehouse_or_depot"
    return "unclassified_public_address"


def heuristic_company_size(text: str) -> str:
    """Extract heuristic size tier based on text evidence when AI is offline."""
    emp_match = EMPLOYEE_SIGNAL_RE.search(text)
    if emp_match:
        digits = re.sub(r"\D", "", emp_match.group(1))
        if digits:
            count = int(digits)
            if count <= 10:
                return "Startup (1-10)"
            if count <= 50:
                return "Small (11-50)"
            if count <= 200:
                return "Medium (51-200)"
            if count <= 1000:
                return "Large (201-1000)"
            return "Enterprise (1000+)"
    if FACILITY_SIGNAL_RE.search(text):
        return "Medium (51-200)"
    if "global" in text.lower() or "multinational" in text.lower() or "subsidiaries" in text.lower():
        return "Large (201-1000)"
    return "Small (11-50)"


class PublicWebsiteCrawler:
    def __init__(
        self,
        output_dir: Path,
        max_pages_per_domain: int = 4,
        delay_seconds: float = 1.0,
        show_browser: bool = False,
        event: Callable[[str, dict], None] | None = None,
        include_terms: tuple[str, ...] = (),
        exclude_terms: tuple[str, ...] = (),
        geo_terms: tuple[str, ...] = (),
    ) -> None:
        self.output_dir = output_dir
        self.max_pages_per_domain = max_pages_per_domain
        self.delay_seconds = delay_seconds
        self.show_browser = show_browser
        self.event = event or (lambda _name, _data: None)
        self.user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        self.include_terms = include_terms
        self.exclude_terms = exclude_terms
        self.geo_terms = geo_terms

    async def run(self, seeds: list[CompanySeed]) -> list[CompanyResult]:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=not self.show_browser,
                args=["--disable-blink-features=AutomationControlled"],
            )
            try:
                results: list[CompanyResult] = []
                for index, seed in enumerate(seeds, 1):
                    self.event("company_started", {"index": index, "total": len(seeds), "company": seed.company_name, "url": seed.source_url})
                    results.append(await self._crawl_one(browser, seed, index))
                    if index < len(seeds):
                        await asyncio.sleep(self.delay_seconds)
                return results
            finally:
                await browser.close()

    async def _crawl_one(self, browser: Browser, seed: CompanySeed, index: int) -> CompanyResult:
        domain = canonical_domain(seed.domain)
        result = CompanyResult(seed=seed, fit_status="REVIEW", fit_confidence="low", linkedin_url=seed.linkedin_url)
        if not domain:
            result.fit_status, result.fit_confidence = "EXCLUDE", "high"
            result.exclusion_reasons.append("unsafe or invalid domain")
            return result

        context = await browser.new_context(
            user_agent=self.user_agent,
            viewport={"width": 1440, "height": 900},
            locale="en-US",
        )
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
        """)

        page = await context.new_page()
        try:
            allowed, robots_error = await robots_allowed(page, seed.source_url, self.user_agent)
            if not allowed:
                result.error = robots_error or "robots.txt disallows this homepage"
                self.event("company_blocked", {"company": seed.company_name, "reason": result.error})
                return result

            await self._visit(page, seed.source_url, result, index, 1)
            if result.pages:
                for page_number, url in enumerate(discovered_links(await page.content(), result.pages[0].final_url, domain, self.max_pages_per_domain - 1), 2):
                    allowed, robots_error = await robots_allowed(page, url, self.user_agent)
                    if not allowed:
                        self.event("page_skipped", {"company": seed.company_name, "url": url, "reason": robots_error or "robots disallow"})
                        continue
                    await self._visit(page, url, result, index, page_number)
                    await asyncio.sleep(self.delay_seconds)

            joined_text = "\n".join(item.text for item in result.pages)
            result.fit_status, result.fit_confidence, result.reasons, result.exclusion_reasons, result.geographic_evidence = classify(
                seed, joined_text, self.include_terms, self.exclude_terms, self.geo_terms,
            )
            result.company_size = heuristic_company_size(joined_text)
            result.contacts = extract_contacts(seed, result)
        except Exception as exc:
            result.error = f"{type(exc).__name__}: {exc}"
            self.event("company_error", {"company": seed.company_name, "error": result.error})
        finally:
            await context.close()

        self.event("company_finished", {"company": seed.company_name, "status": result.fit_status, "pages": len(result.pages), "contacts": len(result.contacts), "error": result.error})
        return result

    async def _visit(self, page: Page, url: str, result: CompanyResult, company_index: int, page_index: int) -> None:
        self.event("page_navigating", {"company": result.seed.company_name, "url": url})
        try:
            response = await page.goto(url, wait_until="domcontentloaded", timeout=25_000)
            await page.wait_for_timeout(800)

            # Auto-handle common cookie consent dialogs
            try:
                consent_selector = "button:has-text('Accept'), button:has-text('Agree'), button:has-text('Allow all'), button:has-text('Accept All'), button:has-text('I Agree'), button:has-text('Got it')"
                btn = page.locator(consent_selector).first
                if await btn.is_visible(timeout=500):
                    await btn.click()
            except Exception:
                pass

            await page.evaluate("window.scrollTo(0, Math.min(document.body.scrollHeight, 800))")
            await page.wait_for_timeout(300)
            title = await page.title()
            text = clean_text(await page.locator("body").inner_text(timeout=8_000))[:MAX_TEXT_CHARS]

            # Check for security challenge / verification
            if any(term in text.lower() for term in ("verify you are human", "checking your browser", "cloudflare turnstile", "attention required! | cloudflare")):
                await page.wait_for_timeout(2_000)
                text = clean_text(await page.locator("body").inner_text(timeout=4_000))[:MAX_TEXT_CHARS]

            shot_dir = self.output_dir / "screenshots"
            shot_dir.mkdir(parents=True, exist_ok=True)
            screenshot = shot_dir / f"{company_index:03d}-{page_index:02d}.png"
            await page.screenshot(path=str(screenshot), full_page=False)
            evidence = PageEvidence(url=url, final_url=page.url, status=response.status if response else None, title=title, text=text, screenshot=str(screenshot))
            result.pages.append(evidence)
            self.event("page_rendered", {"company": result.seed.company_name, "url": page.url, "status": evidence.status, "title": title, "screenshot": str(screenshot)})
        except Exception as exc:
            self.event("page_warning", {"company": result.seed.company_name, "url": url, "warning": f"{type(exc).__name__}: {exc}"})


def write_artifacts(output_dir: Path, results: list[CompanyResult], started_at: float, finished_at: float) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    contacts = [contact.row() for result in results for contact in result.contacts]
    fieldnames = list(ContactEvidence.__dataclass_fields__)
    with (output_dir / "contacts.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(contacts)

    prepass_count = sum(item.fit_status in {"QUALIFIED", "PREPASS"} for item in results)
    review_count = sum(item.fit_status == "REVIEW" for item in results)
    exclude_count = sum(item.fit_status == "EXCLUDE" for item in results)

    report = {
        "started_at_epoch": started_at,
        "finished_at_epoch": finished_at,
        "duration_seconds": round(finished_at - started_at, 2),
        "source_rows": len(results),
        "pages_fetched": sum(len(item.pages) for item in results),
        "contacts_extracted": len(contacts),
        "prepass": prepass_count,
        "review": review_count,
        "exclude": exclude_count,
        "blocked_or_failed": sum(bool(item.error) for item in results),
        "companies": [item.report() for item in results],
    }
    (output_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report
