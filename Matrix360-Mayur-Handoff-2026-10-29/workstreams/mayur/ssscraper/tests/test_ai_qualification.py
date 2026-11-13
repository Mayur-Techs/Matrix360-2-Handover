from app.agents import AILeadQualificationAgent
from app.models import CompanyResult, CompanySeed, PageEvidence


def test_ai_qualification_heuristic_fallback_when_no_key() -> None:
    agent = AILeadQualificationAgent(api_key="", model="gpt-4o-mini")
    seed = CompanySeed("Acme Packaging", "acmepack.example", "https://acmepack.example", "s1", "Dallas, TX")
    result = CompanyResult(seed=seed, fit_status="PREPASS", fit_confidence="medium", reasons=["packaging equipment"])
    result.pages.append(PageEvidence(
        url="https://acmepack.example",
        final_url="https://acmepack.example",
        status=200,
        title="Acme Packaging Solutions",
        text="We employ over 120 professionals in our Dallas plant delivering automated packaging machinery.",
    ))

    agent.qualify(result, "Find packaging machinery suppliers in Texas")
    assert result.fit_status == "QUALIFIED"
    assert result.fit_score >= 80
    assert "Acme Packaging" in result.qualification_summary


def test_heuristic_company_size_estimates_from_text() -> None:
    from app.crawler import heuristic_company_size

    assert heuristic_company_size("Our team of 8 employees is dedicated to craft printing.") == "Startup (1-10)"
    assert heuristic_company_size("With 45 staff members across our office...") == "Small (11-50)"
    assert heuristic_company_size("Employing over 150 employees in our facility...") == "Medium (51-200)"
    assert heuristic_company_size("Operating a 50,000 sq ft manufacturing plant...") == "Medium (51-200)"
    assert heuristic_company_size("A global enterprise with subsidiaries worldwide...") == "Large (201-1000)"
