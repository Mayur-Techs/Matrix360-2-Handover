"""
Domain Discovery Module
Finds real industrial company domains in Kolkata / West Bengal via
DuckDuckGo text search + Google fallback (no paid API needed).
"""
from __future__ import annotations

import asyncio
import logging
import random
import re
import time
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse, urljoin

import httpx
import tldextract
from bs4 import BeautifulSoup

try:
    from ddgs import DDGS
    DDGS_AVAILABLE = True
except ImportError:
    try:
        from duckduckgo_search import DDGS
        DDGS_AVAILABLE = True
    except ImportError:
        DDGS_AVAILABLE = False

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Search query templates – Kolkata / West Bengal industrial focus
# ---------------------------------------------------------------------------
INDUSTRY_QUERIES = [
    # Manufacturing
    'site:.in manufacturer Kolkata OR Howrah "West Bengal" industrial',
    '"manufacturing company" Howrah "West Bengal" B2B official website',
    '"engineering company" Kolkata Howrah industrial plant',
    '"fabrication" OR "steel fabrication" company Kolkata Howrah West Bengal',
    '"packaging company" Kolkata Howrah manufacturing',
    '"chemical company" Kolkata Howrah West Bengal industrial',
    # Warehousing / Logistics
    '"warehousing" OR "logistics" company Kolkata Howrah "West Bengal"',
    '"cold storage" OR "3PL" company Kolkata West Bengal',
    '"freight" OR "transport" company Howrah Kolkata industrial',
    # MSME / engineering
    'MSME "engineering firm" Kolkata Howrah West Bengal official site',
    '"industrial components" supplier Kolkata West Bengal',
    '"heavy engineering" company Kolkata Howrah West Bengal',
    # Sector specific
    '"jute mill" OR "jute industry" Kolkata Howrah West Bengal',
    '"foundry" OR "casting" company Kolkata Howrah West Bengal',
    '"auto parts" manufacturer Kolkata Howrah West Bengal',
    '"electrical equipment" manufacturer Kolkata West Bengal',
    '"food processing" plant Kolkata Howrah West Bengal B2B',
    '"paper mill" OR "textile" manufacturer Kolkata Hooghly West Bengal',
    '"rubber" OR "plastic" manufacturer Kolkata Howrah West Bengal',
    '"construction material" manufacturer Howrah West Bengal B2B',
    # Hooghly belt
    '"Hooghly" industrial company manufacturer site:.in',
    '"Dankuni" OR "Uluberia" OR "Domjur" industrial manufacturer',
    '"Jagaddal" OR "Rishra" OR "Serampore" factory manufacturing',
    '"Tribeni" OR "Konnagar" industrial company West Bengal',
    # Additional
    '"industrial estate" Kolkata Howrah West Bengal company',
    'SIDCO OR "Falta SEZ" company Kolkata West Bengal manufacturer',
]

# User-agent rotation pool
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
]

# ---------------------------------------------------------------------------
# Lakhotia pre-filter keyword sets
# ---------------------------------------------------------------------------
POSITIVE_KEYWORDS = {
    # primary evidence
    "manufactur", "fabricat", "engineer", "industrial", "factory", "plant",
    "foundry", "casting", "forging", "machining", "precision",
    # sectors
    "warehouse", "warehousing", "logistics", "logistic", "3pl", "freight",
    "transport", "distribution", "depot", "storage", "cold storage",
    "packaging", "packing", "processing",
    "chemical", "petrochemical", "pharmaceutical", "agro",
    "steel", "metal", "alloy", "aluminium", "copper", "brass",
    "jute", "textile", "fibre", "rubber", "plastic",
    "electrical", "electronics", "switchgear", "cable", "wire",
    "paper", "pulp", "printing",
    "auto parts", "automobile", "automotive", "spares",
    "construction material", "cement", "refractory",
    # org type
    "msme", "ssi", "udyam", "iso certified", "b2b",
}

NEGATIVE_KEYWORDS = {
    "hotel", "restaurant", "cafe", "food delivery", "zomato",
    "retail store", "shopping", "mall", "supermarket", "grocery",
    "residential", "apartment", "flat", "villa", "real estate broker",
    "realty", "salon", "spa", "beauty", "gym", "fitness",
    "school", "college", "coaching", "tuition",
    "hospital", "clinic", "pharmacy", "healthcare consumer",
    "travel agent", "tour operator", "travel agency",
    "warehouse club",  # retail not industrial
    "event management",
}

GEO_KEYWORDS = {
    "kolkata", "howrah", "hooghly", "west bengal", "w.b.",
    "dankuni", "uluberia", "domjur", "jagaddal", "rishra",
    "serampore", "tribeni", "konnagar", "bhadreswar",
    "barrackpore", "titagarh", "panihati", "naihati",
    "haldia", "durgapur", "asansol", "kalyani", "saltlake",
    "falta", "budge budge",
}


@dataclass
class DiscoveredCompany:
    name: str
    domain: str
    source_url: str
    snippet: str
    geo_evidence: list[str] = field(default_factory=list)
    positive_hits: list[str] = field(default_factory=list)
    negative_hits: list[str] = field(default_factory=list)
    verdict: str = "REVIEW"   # PREPASS | REVIEW | EXCLUDE
    confidence: float = 0.0
    query_used: str = ""

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "domain": self.domain,
            "source_url": self.source_url,
            "snippet": self.snippet,
            "geo_evidence": ", ".join(self.geo_evidence),
            "positive_hits": ", ".join(self.positive_hits),
            "negative_hits": ", ".join(self.negative_hits),
            "verdict": self.verdict,
            "confidence": round(self.confidence, 2),
            "query_used": self.query_used,
        }


def _clean_domain(url: str) -> Optional[str]:
    """Extract canonical domain; reject social/directory sites."""
    BLOCKED_DOMAINS = {
        "facebook.com", "linkedin.com", "twitter.com", "instagram.com",
        "youtube.com", "wikipedia.org", "indiamart.com", "justdial.com",
        "tradeindia.com", "exportersindia.com", "dir.indiamart.com",
        "yellowpages.in", "sulekha.com", "google.com", "bing.com",
        "amazon.in", "flipkart.com", "snapdeal.com", "glassdoor.com",
        "ambitionbox.com", "naukri.com", "indeed.com", "quora.com",
        "reddit.com", "medium.com", "blogspot.com", "wordpress.com",
        "wix.com", "weebly.com", "shopify.com",
    }
    try:
        parsed = urlparse(url if url.startswith("http") else f"https://{url}")
        ext = tldextract.extract(parsed.netloc)
        if not ext.domain or not ext.suffix:
            return None
        base = f"{ext.domain}.{ext.suffix}"
        if ext.subdomain and ext.subdomain not in ("www", ""):
            base = f"{ext.subdomain}.{ext.domain}.{ext.suffix}"
        if any(blocked in base for blocked in BLOCKED_DOMAINS):
            return None
        return base.lower()
    except Exception:
        return None


def _score_company(name: str, snippet: str, domain: str) -> tuple[str, float, list, list, list]:
    """Apply Lakhotia pre-filter logic; return (verdict, confidence, geo, pos_hits, neg_hits)."""
    text = (name + " " + snippet + " " + domain).lower()

    geo_hits = [kw for kw in GEO_KEYWORDS if kw in text]
    pos_hits = [kw for kw in POSITIVE_KEYWORDS if kw in text]
    neg_hits = [kw for kw in NEGATIVE_KEYWORDS if kw in text]

    score = 0.0
    score += min(len(geo_hits) * 0.15, 0.3)
    score += min(len(pos_hits) * 0.12, 0.5)
    score -= len(neg_hits) * 0.25

    score = max(0.0, min(1.0, score))

    if neg_hits and not pos_hits:
        verdict = "EXCLUDE"
    elif score >= 0.45 and geo_hits:
        verdict = "PREPASS"
    elif score >= 0.25:
        verdict = "REVIEW"
    else:
        verdict = "EXCLUDE"

    return verdict, score, geo_hits, pos_hits, neg_hits


class DomainDiscovery:
    """Discovers real industrial company domains using free search engines."""

    def __init__(self, max_results_per_query: int = 10, delay_range: tuple = (1.5, 3.5)):
        self.max_per_query = max_results_per_query
        self.delay_range = delay_range
        self._seen_domains: set[str] = set()

    def _delay(self):
        time.sleep(random.uniform(*self.delay_range))

    def search_duckduckgo(self, query: str) -> list[dict]:
        """Search via DuckDuckGo (free, no key needed)."""
        if not DDGS_AVAILABLE:
            return []
        results = []
        try:
            with DDGS() as ddgs:
                for r in ddgs.text(query, max_results=self.max_per_query, region="in-en"):
                    results.append({
                        "title": r.get("title", ""),
                        "url": r.get("href", ""),
                        "snippet": r.get("body", ""),
                    })
        except Exception as e:
            logger.warning(f"DDG search error for '{query}': {e}")
        return results

    def search_google_scrape(self, query: str) -> list[dict]:
        """Scrape Google search results directly (fallback)."""
        results = []
        headers = {
            "User-Agent": random.choice(USER_AGENTS),
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        params = {"q": query, "num": self.max_per_query, "hl": "en", "gl": "in"}
        try:
            with httpx.Client(timeout=15, follow_redirects=True) as client:
                resp = client.get("https://www.google.com/search", params=params, headers=headers)
            soup = BeautifulSoup(resp.text, "lxml")
            for g in soup.select("div.g"):
                link = g.find("a", href=True)
                title_el = g.find("h3")
                snippet_el = g.find("div", {"data-sncf": True}) or g.find("span", class_="aCOpRe")
                if link and title_el:
                    results.append({
                        "title": title_el.get_text(),
                        "url": link["href"],
                        "snippet": snippet_el.get_text() if snippet_el else "",
                    })
        except Exception as e:
            logger.warning(f"Google scrape error: {e}")
        return results

    def discover(
        self,
        target_count: int = 50,
        queries: Optional[list[str]] = None,
        progress_cb=None,
    ) -> list[DiscoveredCompany]:
        """
        Run discovery across query list; return de-duped company list
        with Lakhotia pre-filter applied.
        """
        queries = queries or INDUSTRY_QUERIES
        companies: list[DiscoveredCompany] = []

        for i, query in enumerate(queries):
            if len([c for c in companies if c.verdict in ("PREPASS", "REVIEW")]) >= target_count:
                break

            if progress_cb:
                progress_cb(f"[Discovery] Query {i+1}/{len(queries)}: {query[:80]}")

            # Try DuckDuckGo first, fall back to Google scrape
            raw = self.search_duckduckgo(query)
            if not raw:
                self._delay()
                raw = self.search_google_scrape(query)

            for r in raw:
                url = r.get("url", "")
                if not url:
                    continue
                domain = _clean_domain(url)
                if not domain or domain in self._seen_domains:
                    continue
                self._seen_domains.add(domain)

                name = r.get("title", domain)
                snippet = r.get("snippet", "")
                verdict, conf, geo, pos, neg = _score_company(name, snippet, domain)

                comp = DiscoveredCompany(
                    name=name,
                    domain=domain,
                    source_url=url,
                    snippet=snippet,
                    geo_evidence=geo,
                    positive_hits=pos,
                    negative_hits=neg,
                    verdict=verdict,
                    confidence=conf,
                    query_used=query,
                )
                companies.append(comp)

                if progress_cb:
                    progress_cb(
                        f"  [{verdict}] {domain} | geo={geo[:2]} pos={pos[:2]} neg={neg[:2]}"
                    )

            self._delay()

        # Sort: PREPASS first, then REVIEW, then EXCLUDE
        order = {"PREPASS": 0, "REVIEW": 1, "EXCLUDE": 2}
        companies.sort(key=lambda c: order.get(c.verdict, 3))
        return companies


async def discover_domains_async(
    target_count: int = 50,
    progress_cb=None,
) -> list[DiscoveredCompany]:
    """Async wrapper — runs blocking discovery in thread pool."""
    loop = asyncio.get_event_loop()
    disc = DomainDiscovery()
    return await loop.run_in_executor(
        None,
        lambda: disc.discover(target_count=target_count, progress_cb=progress_cb),
    )
