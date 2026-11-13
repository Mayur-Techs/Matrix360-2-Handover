"""Authorized Google Places candidate discovery. No Google Maps browser automation."""
from __future__ import annotations

import asyncio
import os
from typing import Awaitable, Callable

import httpx


PLACES_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ",".join((
    "places.id", "places.displayName", "places.websiteUri", "places.formattedAddress",
    "places.primaryTypeDisplayName", "places.rating", "places.userRatingCount", "nextPageToken",
))


def _terms(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _is_excluded(name: str, category: str, exclusions: list[str]) -> bool:
    text = f"{name} {category}".lower()
    return any(item.lower() in text for item in exclusions if item.strip() and item.lower() != "junior roles")


async def stream_authorized_places_candidates(
    keywords_str: str,
    locations_str: str,
    exclusions: list[str],
    suppressed_set: set[str],
    on_candidate_found: Callable[[dict], Awaitable[None]],
    log_callback: Callable[[str], Awaitable[None]],
    should_stop: Callable[[], bool],
) -> None:
    api_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GOOGLE_MAPS_API_KEY is required for authorized Places discovery.")
    keywords = _terms(keywords_str) or [keywords_str.strip()]
    locations = _terms(locations_str) or [locations_str.strip()]
    queries = [f"{keyword} in {location}".strip() for keyword in keywords for location in locations if keyword and location][:15]
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=30.0) as client:
        for query in queries:
            if should_stop():
                return
            await log_callback(f"Authorized Places search: {query}")
            page_token = ""
            for _ in range(3):
                body: dict[str, str | int] = {"textQuery": query, "pageSize": 20}
                if page_token:
                    body["pageToken"] = page_token
                response = await client.post(PLACES_URL, json=body, headers={
                    "X-Goog-Api-Key": api_key,
                    "X-Goog-FieldMask": FIELD_MASK,
                })
                response.raise_for_status()
                payload = response.json()
                for place in payload.get("places", []):
                    if should_stop():
                        return
                    name = str(place.get("displayName", {}).get("text", "")).strip()
                    website = str(place.get("websiteUri", "")).strip()
                    category = str(place.get("primaryTypeDisplayName", {}).get("text", "")).strip()
                    place_id = str(place.get("id", "")).strip()
                    key = (place_id or website or name).lower()
                    if not name or not website or key in seen or name.lower() in suppressed_set or _is_excluded(name, category, exclusions):
                        continue
                    seen.add(key)
                    await on_candidate_found({
                        "business_name": name,
                        "niche": category or keywords_str,
                        "location": str(place.get("formattedAddress", "")).strip(),
                        "phone": "",
                        "website": website,
                        "rating": str(place.get("rating", "")),
                        "reviews": str(place.get("userRatingCount", "")),
                        "address": str(place.get("formattedAddress", "")).strip(),
                        "maps_url": f"google-place:{place_id}" if place_id else "",
                    })
                page_token = str(payload.get("nextPageToken", "")).strip()
                if not page_token:
                    break
                await asyncio.sleep(1.0)
