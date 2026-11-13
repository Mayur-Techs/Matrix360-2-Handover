"""Local-only configuration. Secrets are read from environment variables or `.env`.

Never put keys in source code, reports, browser output, or commits.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_local_env() -> None:
    """Load simple KEY=VALUE pairs without overwriting real environment variables."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True, slots=True)
class Settings:
    lead_ai_api_key: str = ""
    lead_ai_model: str = "gpt-4o-mini"
    google_maps_api_key: str = ""

    @property
    def has_ai_key(self) -> bool:
        return bool(self.lead_ai_api_key)

    @property
    def has_maps_key(self) -> bool:
        return bool(self.google_maps_api_key)


def get_settings() -> Settings:
    load_local_env()
    ai_key = os.getenv("LEAD_AI_API_KEY", "").strip() or os.getenv("OPENAI_API_KEY", "").strip()
    ai_model = os.getenv("LEAD_AI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"
    maps_key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    return Settings(
        lead_ai_api_key=ai_key,
        lead_ai_model=ai_model,
        google_maps_api_key=maps_key,
    )
