import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from v5_contract import (
    build_dual_drive_manifest,
    engine_info,
    generate_company_filters,
    qualify_strict,
    resolve_schema,
)


def test_schema_resolution_preserves_source_phone_header():
    result = resolve_schema(
        ["Business Name", "Mobile Number", "State", "Unknown Detail"],
        [["Apex Fabrication", "09831234567", "West Bengal", "x"]],
    )
    fields = {item["source_header"]: item["canonical_field"] for item in result["columns"]}
    assert fields["Business Name"] == "company"
    assert fields["Mobile Number"] == "phone_source"
    assert result["source_value_policy"] == "preserve_as_received"
    assert "Unknown Detail" in result["unresolved_headers"]


def test_company_filters_are_driven_by_available_columns():
    result = generate_company_filters(["Company Name", "State", "Industry", "Employee Count", "Vehicle Model"])
    filter_fields = {item["field"] for item in result["filters"]}
    assert {"state", "industry", "employee_count"}.issubset(filter_fields)
    assert "Vehicle Model" not in filter_fields
    assert "do not infer consent" in result["review_note"]


def test_strict_qualification_requires_explicit_evidence_not_affluence_proxy():
    qualified = qualify_strict({
        "company": "Howrah Steel Works",
        "industry": "Industrial fabrication",
        "state": "West Bengal",
        "job_title": "Managing Director",
    })
    vehicle_only = qualify_strict({"company": "Unknown", "vehicle": "Luxury SUV"})
    assert qualified["verdict"] == "PREPASS"
    assert qualified["reasoning_mode"] == "strict_evidence"
    assert vehicle_only["verdict"] == "EXCLUDE"
    assert "interest" in vehicle_only["limitations"][0]


def test_drive_manifest_is_plan_only_and_validates_distinct_folders():
    manifest = build_dual_drive_manifest("inputFolder_12345", "outputFolder_67890", "October WB.xlsx")
    assert manifest["mode"] == "manifest_only"
    assert manifest["dataset_name"] == "October WB.xlsx"
    assert "No OAuth token" in manifest["security_note"]

    try:
        build_dual_drive_manifest("sameFolder_12345", "sameFolder_12345", "dataset")
    except ValueError as error:
        assert "different" in str(error)
    else:
        raise AssertionError("Expected matching folders to be rejected")


def test_engine_info_exposes_the_intentional_safety_boundary():
    info = engine_info()
    assert "schema_resolution" in info["capabilities"]
    assert "agentic_affluence_scoring" in info["disabled_capabilities"]
