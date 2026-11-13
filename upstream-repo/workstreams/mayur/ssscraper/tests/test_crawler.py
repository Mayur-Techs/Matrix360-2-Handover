from app.crawler import discovered_links, extract_contacts, observed_address, valid_phone
from app.models import CompanyResult, CompanySeed, PageEvidence


def test_discovered_links_prefers_actual_contact_link() -> None:
    links = discovered_links('<a href="/about">About</a><a href="https://other.test/contact">Other</a><a href="/contact-us">Contact</a>', "https://example.com", "example.com", 2)
    assert links == ["https://example.com/contact-us", "https://example.com/about"]


def test_discovered_links_deduplicates_www_and_apex_paths() -> None:
    links = discovered_links('<a href="https://example.com/contact">Contact</a><a href="https://www.example.com/contact/">Again</a>', "https://www.example.com", "example.com", 3)
    assert links == ["https://example.com/contact"]


def test_generic_page_details_are_not_paired_to_named_contact() -> None:
    seed = CompanySeed("Mfg", "example.com", "https://example.com", "1", "Howrah")
    result = CompanyResult(seed, "PREPASS", "medium", reasons=["manufacturing or production evidence"])
    result.pages.append(PageEvidence("https://example.com", "https://example.com", 200, "Contact", "Jane Doe - Director email@example.com +91 9876543210"))
    contacts = extract_contacts(seed, result)
    assert contacts[0].contact_person_email == ""
    assert contacts[0].contact_person_phone == ""


def test_phone_filter_rejects_dates_and_digit_sequences() -> None:
    assert valid_phone("30.06.2026") is None
    assert valid_phone("2000-2026") is None
    assert valid_phone("1 2 3 4 5 6 7 8 9") is None
    assert valid_phone("+91 33 2302 3400") == "+91 33 2302 3400"


def test_observed_address_is_extracted_from_rendered_text() -> None:
    assert "Kolkata - 700020" in observed_address("Exide House 59E Chowringhee Road, Kolkata - 700020 Phone +91 33 2302 3400")
