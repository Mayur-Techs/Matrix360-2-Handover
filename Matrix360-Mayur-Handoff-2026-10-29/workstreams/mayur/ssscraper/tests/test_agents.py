from app.agents import FilterPolicy, csv_terms, run_agents
from app.models import CompanyResult, CompanySeed, ContactEvidence


def result_with_contacts() -> CompanyResult:
    seed = CompanySeed("Forge Co", "forge.example", "https://forge.example", "source-1", "Howrah")
    result = CompanyResult(seed, "PREPASS", "medium", reasons=["manufacturing or production evidence"])
    result.contacts = [
        ContactEvidence("Forge Co", "forge.example", "PREPASS", "medium", company_phone="+91 98765 43210", company_email="sales@forge.example"),
        ContactEvidence("Forge Co", "forge.example", "PREPASS", "medium", company_phone="+91 98765 43210", company_email="sales@forge.example"),
    ]
    return result


def test_csv_terms_normalizes_filter_values() -> None:
    assert csv_terms(" Manufacturing, logistics , ") == ("manufacturing", "logistics")


def test_agents_filter_dedupe_and_report_quota_without_network() -> None:
    events = []
    result = result_with_contacts()
    summary = run_agents([result], FilterPolicy(require_mode="either", target_qualified_leads=1, validate_email_domains=False), lambda name, data: events.append((name, data)))
    assert len(result.contacts) == 1
    assert result.contacts[0].email_validation == "syntax_valid_not_checked"
    assert result.contacts[0].phone_validation == "format_valid"
    assert summary["target_met"] is True
    assert summary["rejections"]["duplicate contact evidence"] == 1
    assert any(name == "agent_finished" for name, _ in events)


def test_agents_keep_source_but_filter_disallowed_status() -> None:
    result = result_with_contacts()
    result.fit_status = "REVIEW"
    summary = run_agents([result], FilterPolicy(allowed_statuses=("PREPASS",), validate_email_domains=False), lambda _name, _data: None)
    assert result.filter_rejections == ["research status REVIEW not allowed"]
    assert result.contacts == []
    assert summary["qualified_contact_rows"] == 0


def test_role_preferences_do_not_remove_general_contacts_unless_named_is_required() -> None:
    result = result_with_contacts()
    summary = run_agents(
        [result],
        FilterPolicy(
            require_mode="either",
            target_roles=("founder", "director"),
            require_named_contact=False,
            validate_email_domains=False,
        ),
        lambda _name, _data: None,
    )

    assert summary["qualified_contact_rows"] == 1


def test_geography_and_suppression_filters_preserve_rejection_evidence() -> None:
    result = result_with_contacts()
    summary = run_agents(
        [result],
        FilterPolicy(location_terms=("kolkata",), suppression_terms=("source-1",), validate_email_domains=False),
        lambda _name, _data: None,
    )

    assert result.contacts == []
    assert "does not match requested geography" in result.filter_rejections
    assert "matches suppression list" in result.filter_rejections
    assert summary["rejections"]["geography mismatch"] == 1
