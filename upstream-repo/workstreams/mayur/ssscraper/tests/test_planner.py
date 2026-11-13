from app.planner import PlanRequest, create_plan
from app.settings import Settings


def test_plan_preview_is_client_agnostic_without_an_api_key() -> None:
    plan = create_plan(
        PlanRequest(prompt="Find accounting firms in Pune interested in payroll software", lead_count=100),
        Settings(),
    )

    assert plan.generated_by == "rule_based_preview"
    assert plan.search_queries == ["Find accounting firms in Pune interested in payroll software"]
    assert "Lak" not in plan.client_goal
    assert len(plan.plain_filters) >= 2
