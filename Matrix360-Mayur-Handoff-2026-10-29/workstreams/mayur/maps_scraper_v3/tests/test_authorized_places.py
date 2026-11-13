from scraper.authorized_places_agent import _is_excluded, _terms


def test_terms_discards_empty_values() -> None:
    assert _terms(" manufacturers, , exporters ") == ["manufacturers", "exporters"]


def test_exclusions_apply_to_company_and_category_but_not_junior_roles() -> None:
    assert _is_excluded("Acme Staffing", "Recruiting agency", ["staffing"])
    assert not _is_excluded("Acme Works", "Manufacturer", ["junior roles"])
