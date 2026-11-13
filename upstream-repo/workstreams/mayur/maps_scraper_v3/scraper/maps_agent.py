"""Retired direct Google Maps browser adapter.

The shared Matrix360 build uses ``authorized_places_agent`` and the official
Google Places API (New). Keeping this explicit stub prevents an accidental
return to browser automation from another module.
"""
from __future__ import annotations


async def stream_maps_candidates(*args, **kwargs) -> None:
    raise RuntimeError(
        "Direct Google Maps browser automation is not available in this shared "
        "build. Use scraper.authorized_places_agent instead."
    )
