from __future__ import annotations

import ipaddress
import re
from urllib.parse import urlparse

from .models import CompanySeed



def canonical_domain(value: str) -> str | None:
    parsed = urlparse(value if "://" in value else f"https://{value}")
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host or host == "localhost" or host.endswith(".local"):
        return None
    try:
        if ipaddress.ip_address(host).is_private:
            return None
    except ValueError:
        pass
    return host[4:] if host.startswith("www.") else host


def is_same_domain(url: str, canonical: str) -> bool:
    host = canonical_domain(url)
    return bool(host and (host == canonical or host.endswith(f".{canonical}")))


def classify(
    seed: CompanySeed,
    page_text: str,
    include_terms: tuple[str, ...] = (),
    exclude_terms: tuple[str, ...] = (),
    geo_terms: tuple[str, ...] = (),
) -> tuple[str, str, list[str], list[str], list[str]]:
    text = f"{seed.company_name} {seed.location_hint} {page_text}".lower()
    positive_map = {term.lower(): f"matches requested focus: {term}" for term in include_terms}
    negative_map = {term.lower(): f"matches requested exclusion: {term}" for term in exclude_terms}
    positives = sorted({reason for term, reason in positive_map.items() if term in text})
    negatives = sorted({reason for term, reason in negative_map.items() if term in text})
    geos = [term.title() for term in geo_terms if term in text]
    if negatives and not positives:
        return "EXCLUDE", "high", positives, negatives, geos
    if positives:
        return "PREPASS", "medium", positives, negatives, geos
    return "REVIEW", "low", positives, negatives, geos


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()
