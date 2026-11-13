from app.models import CompanySeed
from app.rules import canonical_domain, classify, is_same_domain


def seed() -> CompanySeed:
    return CompanySeed("Example Engineering", "example.com", "https://example.com", "x1", "Howrah")


def test_canonical_domain_rejects_private_targets() -> None:
    assert canonical_domain("https://127.0.0.1") is None
    assert canonical_domain("https://www.Example.com/path") == "example.com"


def test_same_domain_allows_subdomain_only() -> None:
    assert is_same_domain("https://careers.example.com/team", "example.com")
    assert not is_same_domain("https://example.com.evil.test", "example.com")


def test_classification_uses_client_generated_focus_and_geography_terms() -> None:
    status, confidence, reasons, _, geos = classify(
        seed(), "Our Kolkata factory manufactures industrial machinery.", ("manufactur", "factory"), (), ("kolkata",),
    )
    assert (status, confidence) == ("PREPASS", "medium")
    assert reasons and geos
