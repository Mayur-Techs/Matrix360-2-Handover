"""Safe, local V5 capability contract for the Mayur Audience Engine.

This module is deliberately side-effect free: it does not transmit rows, call an
LLM, or access Google Drive.  It makes the useful V5 capabilities available to
the Audience Engine while preserving the V4 evidence-first lead policy.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Iterable


V5_UPSTREAM_REVISION = "014a2d9"
V5_CONTRACT_VERSION = "5.0.0-safe-bridge"


_ALIASES = {
    "person_name": {"name", "full name", "contact name", "decision maker", "owner name"},
    "email": {"email", "email address", "business email", "work email"},
    "phone_source": {"phone", "phone number", "mobile", "mobile number", "telephone", "contact number"},
    "company": {"company", "company name", "business", "business name", "organisation", "organization", "firm name"},
    "industry": {"industry", "sector", "vertical", "business category", "category", "niche"},
    "address": {"address", "full address", "location", "site address"},
    "city": {"city", "town"},
    "district": {"district", "county"},
    "state": {"state", "province", "region"},
    "country": {"country", "nation"},
    "job_title": {"job title", "title", "designation", "role", "position"},
    "employee_count": {"employees", "employee count", "company size", "headcount"},
    "revenue": {"revenue", "annual revenue", "turnover", "sales"},
    "website": {"website", "domain", "company website", "url"},
}


def _normalise_header(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value).lower())).strip()


def _sample_kind(values: Iterable[Any]) -> str | None:
    samples = [str(value).strip() for value in values if str(value).strip()][:12]
    if not samples:
        return None
    if sum("@" in value for value in samples) / len(samples) >= 0.6:
        return "email"
    if sum(len(re.sub(r"\D", "", value)) >= 8 for value in samples) / len(samples) >= 0.6:
        return "phone_source"
    if sum(value.startswith(("http://", "https://", "www.")) for value in samples) / len(samples) >= 0.6:
        return "website"
    return None


def resolve_schema(headers: list[str], sample_rows: list[list[Any]] | None = None) -> dict[str, Any]:
    """Return transparent header-to-canonical mappings without changing source values."""
    columns: list[dict[str, Any]] = []
    for index, header in enumerate(headers):
        normalised = _normalise_header(header)
        matches = [canonical for canonical, aliases in _ALIASES.items() if normalised in aliases]
        values = [row[index] for row in (sample_rows or []) if len(row) > index]
        inferred = _sample_kind(values)
        canonical = matches[0] if matches else inferred
        confidence = 1.0 if matches else (0.72 if inferred else 0.0)
        columns.append({
            "source_header": str(header),
            "canonical_field": canonical,
            "confidence": confidence,
            "reason": "semantic_alias" if matches else ("value_fingerprint" if inferred else "unresolved"),
        })
    return {
        "contract_version": V5_CONTRACT_VERSION,
        "source_value_policy": "preserve_as_received",
        "columns": columns,
        "unresolved_headers": [item["source_header"] for item in columns if not item["canonical_field"]],
    }


def generate_company_filters(headers: list[str], client_profile: str = "lakhotia") -> dict[str, Any]:
    """Draft user-reviewable, data-driven filters from the uploaded column names."""
    resolved = resolve_schema(headers)
    recognised = {item["canonical_field"] for item in resolved["columns"] if item["canonical_field"]}
    filters: list[dict[str, Any]] = []
    for item in resolved["columns"]:
        field = item["canonical_field"]
        if not field:
            continue
        if field in {"state", "district", "city", "industry", "job_title", "employee_count", "revenue"}:
            filters.append({
                "field": field,
                "source_header": item["source_header"],
                "operator": "multi_select",
                "required": field in {"state", "industry"},
            })
    return {
        "contract_version": V5_CONTRACT_VERSION,
        "client_profile": client_profile.lower().strip() or "lakhotia",
        "recognised_fields": sorted(recognised),
        "filters": filters,
        "review_note": "Filters are suggestions. They do not infer consent, purchase intent, or contact eligibility.",
    }


def _value(record: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def qualify_strict(record: dict[str, Any], client_profile: str = "lakhotia") -> dict[str, Any]:
    """Evidence-only qualification.  It is intentionally not an interest prediction."""
    profile = client_profile.lower().strip() or "lakhotia"
    industry = _value(record, "industry", "sector", "niche").lower()
    state = _value(record, "state", "region").lower()
    district = _value(record, "district").lower()
    role = _value(record, "job_title", "role", "designation").lower()
    reasons: list[str] = []
    score = 0

    if state in {"west bengal", "wb"} or district in {"howrah", "hooghly", "kolkata", "purba medinipur", "paschim bardhaman"}:
        score += 35
        reasons.append("West Bengal geography supplied")
    elif state or district:
        reasons.append("Geography supplied outside the primary West Bengal focus")
    if any(token in industry for token in ("manufactur", "industrial", "factory", "logistic", "warehouse", "engineering", "fabrication", "plant")):
        score += 40
        reasons.append("Industrial sector supplied")
    if any(token in role for token in ("owner", "founder", "director", "partner", "md", "chief", "plant head")):
        score += 15
        reasons.append("Decision-maker title supplied")
    if _value(record, "company", "business_name"):
        score += 10
        reasons.append("Company identity supplied")

    verdict = "REVIEW"
    if score >= 70:
        verdict = "PREPASS"
    elif score < 35:
        verdict = "EXCLUDE"
    return {
        "contract_version": V5_CONTRACT_VERSION,
        "client_profile": profile,
        "reasoning_mode": "strict_evidence",
        "verdict": verdict,
        "score": score,
        "reasons": reasons or ["Insufficient explicit evidence in supplied record"],
        "limitations": ["This is a campaign-priority signal, not a statement of interest, consent, identity, or deliverability."],
    }


def build_dual_drive_manifest(input_folder_id: str, output_folder_id: str, dataset_name: str) -> dict[str, Any]:
    """Create a reviewable Drive hand-off plan; this function performs no cloud I/O."""
    folder_pattern = re.compile(r"^[A-Za-z0-9_-]{10,200}$")
    if not folder_pattern.fullmatch(input_folder_id) or not folder_pattern.fullmatch(output_folder_id):
        raise ValueError("Google Drive folder IDs must be 10-200 letters, numbers, underscores, or hyphens.")
    if input_folder_id == output_folder_id:
        raise ValueError("Input and output Drive folders must be different.")
    safe_name = re.sub(r"[^A-Za-z0-9._ -]+", "_", dataset_name).strip()[:120] or "dataset"
    return {
        "contract_version": V5_CONTRACT_VERSION,
        "mode": "manifest_only",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset_name": safe_name,
        "input_folder_id": input_folder_id,
        "output_folder_id": output_folder_id,
        "actions": ["read approved input dataset", "write classified exports", "write reconciliation report"],
        "security_note": "No OAuth token, file content, or Drive request is stored or transmitted by this endpoint.",
    }


def engine_info() -> dict[str, Any]:
    return {
        "engine": "Matrix360 V5 safe bridge",
        "contract_version": V5_CONTRACT_VERSION,
        "upstream_revision": V5_UPSTREAM_REVISION,
        "capabilities": ["schema_resolution", "filter_drafting", "strict_evidence_qualification", "dual_drive_manifest"],
        "disabled_capabilities": ["agentic_affluence_scoring", "automatic_interest_inference", "automatic_cloud_transfer"],
    }
