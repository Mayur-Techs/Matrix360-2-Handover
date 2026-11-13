from integration import manifest, to_matrix360_record


def test_matrix360_export_is_review_only_and_evidence_bound() -> None:
    record = to_matrix360_record({"id": 7, "business_name": "Example Works", "email": "team@example.test", "phone_status": "format_valid"})
    assert record["external_id"] == "maps-scraper-v3:7"
    assert record["review_status"] == "requires_human_review"
    assert record["consent_status"] == "not_verified"
    assert record["contacts"][0]["email"] == "team@example.test"
    assert manifest()["write_behavior"] == "none"
