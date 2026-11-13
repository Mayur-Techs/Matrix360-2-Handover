from fastapi.testclient import TestClient
from app.main import app


client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_system_status_endpoint() -> None:
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()
    assert "has_ai_key" in data
    assert "has_maps_key" in data
    assert "ai_model" in data


def test_create_plan_endpoint_client_agnostic() -> None:
    response = client.post("/api/plans", json={
        "prompt": "Find boutique graphic design studios in Chicago",
        "lead_count": 30,
    })
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert data["ready_to_start"] is True
    assert "plan" in data
    assert len(data["plan"]["plain_filters"]) >= 2
