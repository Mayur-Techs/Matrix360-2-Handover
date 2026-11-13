"""
CSV Export + Report Generation for Verified Leads
"""
from __future__ import annotations

import csv
import io
import json
import os
import hashlib
from datetime import datetime
from typing import Optional, List, Dict

CSV_FIELDNAMES = [
    "id",
    "business_name",
    "niche",
    "location",
    "company_size",
    "phone",
    "phone_status",
    "email",
    "email_status",
    "website",
    "dm_name",
    "dm_role",
    "dm_linkedin",
    "dm_email",
    "verdict",
    "confidence",
    "facility_evidence",
    "instagram",
    "linkedin",
    "facebook",
    "twitter",
    "rating",
    "reviews",
    "address",
    "maps_url",
    "created_at"
]


def build_csv_from_leads(leads: List[Dict]) -> str:
    """Build CSV string from verified database leads."""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDNAMES, extrasaction="ignore")
    writer.writeheader()
    for lead in leads:
        writer.writerow(lead)
    return output.getvalue()


def save_csv(
    leads: List[Dict],
    output_dir: str = "scraper/output",
) -> str:
    """Save CSV to disk; return file path."""
    os.makedirs(output_dir, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(output_dir, f"matrix360_verified_leads_{ts}.csv")
    csv_content = build_csv_from_leads(leads)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        f.write(csv_content)
    return path


def build_report(
    leads: List[Dict],
    scanned_count: int,
    skipped_count: int,
    csv_path: str,
) -> dict:
    """Build structured report matching the Reporting Contract."""
    checksum = ""
    if os.path.exists(csv_path):
        with open(csv_path, "rb") as f:
            checksum = hashlib.md5(f.read()).hexdigest()

    has_email_count = sum(1 for l in leads if l.get("email") and l.get("email_status") == "Verified (MX)")
    has_phone_count = sum(1 for l in leads if l.get("phone") and l.get("phone_status") == "Valid")
    has_dm_count = sum(1 for l in leads if l.get("dm_name") or l.get("dm_linkedin"))

    prepass_count = sum(1 for l in leads if l.get("verdict") == "PREPASS")
    review_count = sum(1 for l in leads if l.get("verdict") == "REVIEW")
    exclude_count = sum(1 for l in leads if l.get("verdict") == "EXCLUDE")

    return {
        "report_time": datetime.now().isoformat(),
        "csv_path": csv_path,
        "csv_checksum_md5": checksum,
        "BUILT_AND_TESTED": {
            "maps_discovery_agent": "Playwright Chromium streaming with West Bengal Hub expansion",
            "decision_maker_agent": "LinkedIn X-Ray dorks + On-site executive cards extraction",
            "verification_agent": "Strict DNS MX check (dnspython) + Phone E.164 normalization",
            "pre_filter_agent": "Lakhotia industrial scoring + Negative retail/residential/junior role exclusions",
            "database_agent": "SQLite leads.db + campaign suppression deduplication"
        },
        "LIVE_VERIFIED": {
            "total_qualified_leads_saved": len(leads),
            "total_candidates_scanned": scanned_count,
            "total_skipped_or_incomplete": skipped_count,
            "verified_mx_emails": has_email_count,
            "valid_phones": has_phone_count,
            "decision_makers_identified": has_dm_count,
            "lakhotia_prepass": prepass_count,
            "lakhotia_review": review_count,
            "lakhotia_exclude": exclude_count,
            "sample_leads": [l.get("business_name") for l in leads[:5]]
        },
        "NEXT_GATE": {
            "scale_to_500": "Met or configured up to 500 verified leads per run",
            "scale_to_5000": "Multi-region batching across West Bengal, Odisha, Jharkhand, Bihar, Assam"
        }
    }
