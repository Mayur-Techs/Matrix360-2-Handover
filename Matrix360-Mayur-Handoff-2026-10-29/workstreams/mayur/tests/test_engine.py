import pytest
import sqlite3
import os
import sys
from pathlib import Path

# Ensure root is in path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import database as database_module
from database import (
    add_suppression_items,
    clear_leads,
    clear_suppression_list,
    get_leads,
    get_suppression_set,
    init_db,
    is_lead_suppressed,
    upsert_lead,
)
from scraper.enrichment_agent import validate_and_format_phone, is_valid_person_name, verify_domain_mx_sync
from scraper import enrichment_agent
from scraper.domain_discovery import _score_company


@pytest.fixture(autouse=True)
def isolated_database(monkeypatch):
    """Keep functional tests independent of an operator's local lead database."""
    test_db = Path(__file__).parent / "ci_leads.db"
    monkeypatch.setattr(database_module, "DB_PATH", str(test_db))
    init_db()
    clear_leads()
    clear_suppression_list()


def test_database_initialization():
    init_db()
    leads = get_leads()
    assert isinstance(leads, list)


def test_phone_validation():
    # Valid Indian mobile number
    formatted, status = validate_and_format_phone("9831234567")
    assert status == "Valid"
    assert "+91" in formatted

    # Valid Kolkata STD landline
    formatted_land, status_land = validate_and_format_phone("033 2244 5566")
    assert status_land == "Valid"
    assert "+91" in formatted_land

    # Invalid fake repeated digits
    _, status_fake = validate_and_format_phone("9999999999")
    assert status_fake == "Invalid"

    # Invalid short length
    _, status_short = validate_and_format_phone("12345")
    assert status_short == "Invalid"


def test_person_name_validation():
    assert is_valid_person_name("Rajesh Agarwal") is True
    assert is_valid_person_name("Ananya Banerjee") is True
    assert is_valid_person_name("Dr. Sandeep Ghosh") is True
    # Stop words / invalid names
    assert is_valid_person_name("About Us") is False
    assert is_valid_person_name("Kolkata Plant") is False
    assert is_valid_person_name("Contact") is False


def test_domain_mx_verification_is_deterministic(monkeypatch):
    """CI must not depend on public DNS availability or a third-party domain."""
    enrichment_agent.DOMAIN_MX_CACHE.clear()
    monkeypatch.setattr(enrichment_agent, "HAS_DNSPYTHON", False)

    def fake_getaddrinfo(domain, *_args, **_kwargs):
        if domain == "mailhost.test":
            return [(None, None, None, None, ("127.0.0.1", 0))]
        raise OSError("not found")

    monkeypatch.setattr(enrichment_agent.socket, "getaddrinfo", fake_getaddrinfo)
    assert verify_domain_mx_sync("mailhost.test") is True
    assert verify_domain_mx_sync("no-mail.test") is False


def test_lakhotia_pre_filter_scoring():
    # Positive industrial candidate
    verdict, conf, geo, pos, neg = _score_company(
        "Howrah Heavy Engineering Works Pvt Ltd",
        "Fabrication factory, machinery, plant and warehouse in Howrah, West Bengal",
        "howrahheavyeng.com"
    )
    assert verdict == "PREPASS"
    assert conf > 0.4
    assert len(geo) > 0
    assert len(pos) > 0

    # Negative retail candidate
    verdict_neg, conf_neg, geo_neg, pos_neg, neg_neg = _score_company(
        "Grand Luxury Hotel & Restaurant",
        "Luxury hotel rooms and restaurant dining in Kolkata",
        "grandhotelkolkata.com"
    )
    assert verdict_neg == "EXCLUDE"
    assert "hotel" in neg_neg


def test_suppression_and_deduplication():
    init_db()
    added = add_suppression_items(["bounced@example.com", "9876543210", "blockeddomain.com"], "test_exclusion")
    assert added >= 1

    supp_set = get_suppression_set()
    assert "bounced@example.com" in supp_set
    assert "9876543210" in supp_set

    # Test lead matching suppression
    suppressed_lead = {
        "business_name": "Some Corp",
        "email": "bounced@example.com",
        "phone": "+91 99999 11111",
        "maps_url": ""
    }
    assert is_lead_suppressed(suppressed_lead, supp_set) is True

    clean_lead = {
        "business_name": "Fresh Clean Industrialist",
        "email": "fresh@cleanindustrialist.com",
        "phone": "+91 88888 22222",
        "maps_url": "https://maps.google.com/test-clean-123"
    }
    assert is_lead_suppressed(clean_lead, supp_set) is False
