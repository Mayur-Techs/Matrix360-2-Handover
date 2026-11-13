"""Review-only Matrix360 CRM export contract for this independent sidecar."""
from __future__ import annotations

from typing import Any


def to_matrix360_record(lead: dict[str, Any]) -> dict[str, Any]:
    """Map a local lead row without asserting consent, ownership, or deliverability."""
    lead_id = str(lead.get("id", "")).strip()
    return {
        "external_id": f"maps-scraper-v4:{lead_id}" if lead_id else "",
        "source": "maps_scraper_v4",
        "review_status": "requires_human_review",
        "consent_status": "not_verified",
        "company": {
            "name": lead.get("business_name", ""),
            "website": lead.get("website", ""),
            "location": lead.get("location", ""),
            "address": lead.get("address", ""),
            "entity_type": lead.get("entity_type", ""),
        },
        "contacts": [{
            "email": lead.get("email", ""),
            "email_validation": lead.get("email_status", ""),
            "phone": lead.get("phone", ""),
            "phone_validation": lead.get("phone_status", ""),
            "name": lead.get("dm_name", ""),
            "role": lead.get("dm_role", ""),
        }],
        "evidence": {
            "official_website": lead.get("website", ""),
            "provider_place_id": lead.get("maps_url", ""),
            "created_at": lead.get("created_at", ""),
        },
    }


def manifest() -> dict[str, Any]:
    return {
        "contract_version": "matrix360-lead-export.v1",
        "mode": "review_only",
        "authentication": "X-Matrix360-Integration-Key",
        "lead_endpoint": "/api/integration/matrix360/leads",
        "write_behavior": "none",
        "required_crm_behavior": "proxy server-side, verify workspace membership, and require human review before CRM import",
    }
