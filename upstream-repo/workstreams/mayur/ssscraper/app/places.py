"""Multi-source business discovery: Google Places API (New) + Multi-Engine Web & LinkedIn Search."""
from __future__ import annotations

import asyncio
import base64
import json
import re
from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen

from .models import CompanySeed

PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ",".join((
    "places.id", "places.displayName", "places.websiteUri", "places.formattedAddress",
    "places.primaryTypeDisplayName", "nextPageToken",
))

EXCLUDED_DOMAINS = {
    "indiamart.com", "justdial.com", "tradeindia.com", "yelp.com", "yellowpages.com",
    "wikipedia.org", "youtube.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
    "pinterest.com", "amazon.com", "amazon.in", "flipkart.com", "glassdoor.com",
    "indeed.com", "naukri.com", "linkedin.com", "google.com", "bing.com", "yahoo.com",
    "mapquest.com", "tripadvisor.com", "quora.com", "reddit.com", "bloomberg.com",
}


class PlacesError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class DiscoverySummary:
    provider: str
    queries_attempted: int
    provider_places_returned: int
    official_website_candidates: int
    skipped_without_official_website: int

    def report(self) -> dict[str, int | str]:
        return asdict(self)


def _domain(website: str) -> str:
    host = (urlparse(website if "://" in website else f"https://{website}").hostname or "").lower()
    return host.removeprefix("www.")


def decode_bing_u(href: str) -> str:
    try:
        parsed = urlparse(href)
        qs = parse_qs(parsed.query)
        u_val = qs.get("u", [""])[0]
        if u_val.startswith("a1"):
            b64 = u_val[2:] + "=" * ((4 - len(u_val[2:]) % 4) % 4)
            return base64.b64decode(b64).decode("utf-8", errors="ignore")
    except Exception:
        pass
    return href


async def _search_web_engine(query: str, max_items: int = 15) -> list[dict[str, str]]:
    """Query search engine using Playwright to discover real official company websites and LinkedIn profiles."""
    from playwright.async_api import async_playwright

    results: list[dict[str, str]] = []
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            )
            search_url = f"https://www.bing.com/search?q={quote(query)}"
            await page.goto(search_url, wait_until="domcontentloaded", timeout=12_000)
            items = await page.eval_on_selector_all(
                "li.b_algo",
                """nodes => nodes.map(n => {
                    const a = n.querySelector('h2 a');
                    const snippet = n.querySelector('p')?.innerText || '';
                    return { title: a ? a.innerText : '', href: a ? a.href : '', snippet: snippet };
                })""",
            )
            for item in items:
                raw_href = item.get("href", "")
                decoded_url = decode_bing_u(raw_href)
                domain = _domain(decoded_url)
                if not domain:
                    continue
                # Capture LinkedIn company URLs
                is_linkedin_company = "linkedin.com/company" in decoded_url
                if not is_linkedin_company and any(domain.endswith(excl) or domain == excl for excl in EXCLUDED_DOMAINS):
                    continue
                title = re.sub(r"\s*[-–|].*$", "", item.get("title", "")).strip() or domain
                results.append({
                    "title": title,
                    "url": decoded_url,
                    "domain": domain,
                    "snippet": item.get("snippet", ""),
                    "is_linkedin": "true" if is_linkedin_company else "false",
                })
                if len(results) >= max_items:
                    break
            await browser.close()
    except Exception:
        pass
    return results


class GooglePlacesDiscovery:
    def __init__(self, api_key: str = "", fetch: Callable[[Request], dict] | None = None) -> None:
        self.api_key = api_key
        self.fetch = fetch or self._fetch

    @staticmethod
    def _fetch(request: Request) -> dict:
        try:
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise PlacesError(f"Google Places discovery failed: {type(exc).__name__}") from exc

    def _search(self, query: str, page_token: str = "") -> dict:
        body: dict[str, str | int] = {"textQuery": query, "pageSize": 20}
        if page_token:
            body["pageToken"] = page_token
        request = Request(
            PLACES_URL,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-Goog-Api-Key": self.api_key,
                "X-Goog-FieldMask": FIELD_MASK,
            },
            method="POST",
        )
        return self.fetch(request)

    def discover(self, queries: list[str], candidate_budget: int, event: Callable[[str, dict], None]) -> tuple[list[CompanySeed], DiscoverySummary]:
        seeds: list[CompanySeed] = []
        seen: set[str] = set()
        provider_rows = 0
        skipped = 0
        attempted = 0
        provider_name = "Multi-Engine Search & LinkedIn Discovery"

        # 1. If Google Places API key is provided, query Google Places
        if self.api_key:
            provider_name = "Google Places API (New)"
            for query in queries:
                if len(seeds) >= candidate_budget:
                    break
                attempted += 1
                event("agent_started", {"agent": "Authorized Maps discovery agent", "query": query})
                token = ""
                for _page in range(3):
                    try:
                        payload = self._search(query, token)
                    except Exception as exc:
                        event("agent_error", {"agent": "Authorized Maps discovery agent", "error": str(exc)})
                        break
                    places = payload.get("places", [])
                    provider_rows += len(places)
                    for place in places:
                        website = str(place.get("websiteUri", "")).strip()
                        place_id = str(place.get("id", "")).strip()
                        domain = _domain(website)
                        if not website or not domain:
                            skipped += 1
                            continue
                        key = f"{place_id}:{domain}"
                        if key in seen:
                            continue
                        seen.add(key)
                        display = place.get("displayName", {})
                        name = str(display.get("text", "")).strip() if isinstance(display, dict) else ""
                        seeds.append(CompanySeed(
                            company_name=name or domain,
                            domain=domain,
                            source_url=website,
                            source_id=f"google-place:{place_id or domain}",
                            location_hint=str(place.get("formattedAddress", "")).strip(),
                        ))
                        if len(seeds) >= candidate_budget:
                            break
                    token = str(payload.get("nextPageToken", "")).strip()
                    if not token or len(seeds) >= candidate_budget:
                        break
                event("agent_finished", {"agent": "Authorized Maps discovery agent", "query": query, "candidates": len(seeds)})

        # 2. If no Google Places key or we need more candidate businesses, use multi-engine web & LinkedIn discovery
        if len(seeds) < candidate_budget and (not self.api_key or self.fetch == self._fetch):
            event("agent_started", {"agent": "Web & LinkedIn discovery agent", "goal": "Find official business websites"})
            if self.api_key:
                provider_name = "Google Places API + Multi-Engine Web & LinkedIn Search"

            # Formulate targeted web and LinkedIn queries
            search_queries: list[str] = []
            for q in queries[:6]:
                search_queries.append(f"{q} official website")
                search_queries.append(f"site:linkedin.com/company {q}")

            for sq in search_queries:
                if len(seeds) >= candidate_budget:
                    break
                attempted += 1
                event("discovery_query", {"query": sq})
                try:
                    found_items = asyncio.run(_search_web_engine(sq, max_items=10))
                except Exception:
                    found_items = []
                provider_rows += len(found_items)
                for item in found_items:
                    domain = item["domain"]
                    url = item["url"]
                    title = item["title"]
                    is_li = item.get("is_linkedin") == "true"
                    li_url = url if is_li else ""
                    if is_li:
                        # For LinkedIn company pages, derive domain key from slug
                        slug = url.split("/company/")[-1].strip("/").split("/")[0]
                        domain = f"{slug}.linkedin"
                        site_url = url
                    else:
                        site_url = url

                    if domain in seen:
                        continue
                    seen.add(domain)
                    seeds.append(CompanySeed(
                        company_name=title or domain,
                        domain=domain,
                        source_url=site_url,
                        source_id=f"web-search:{domain}",
                        location_hint=item.get("snippet", "")[:120],
                        linkedin_url=li_url,
                    ))
                    if len(seeds) >= candidate_budget:
                        break

            event("agent_finished", {"agent": "Web & LinkedIn discovery agent", "candidates_discovered": len(seeds)})

        return seeds, DiscoverySummary(
            provider=provider_name,
            queries_attempted=attempted,
            provider_places_returned=provider_rows,
            official_website_candidates=len(seeds),
            skipped_without_official_website=skipped,
        )
