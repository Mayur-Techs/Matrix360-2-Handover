import pytest
from fastapi import HTTPException

from access import require_app_access, require_integration_access


def test_local_app_access_does_not_need_a_gateway_key(monkeypatch) -> None:
    monkeypatch.setenv("MATRIX360_DEPLOYMENT_STAGE", "local")
    monkeypatch.delenv("MATRIX360_APP_ACCESS_KEY", raising=False)
    require_app_access("")


def test_staging_fails_closed_without_an_app_key(monkeypatch) -> None:
    monkeypatch.setenv("MATRIX360_DEPLOYMENT_STAGE", "staging")
    monkeypatch.delenv("MATRIX360_APP_ACCESS_KEY", raising=False)
    with pytest.raises(HTTPException) as error:
        require_app_access("anything")
    assert error.value.status_code == 503


def test_staging_rejects_a_bad_gateway_key_and_accepts_the_right_one(monkeypatch) -> None:
    monkeypatch.setenv("MATRIX360_DEPLOYMENT_STAGE", "staging")
    monkeypatch.setenv("MATRIX360_APP_ACCESS_KEY", "gateway-key")
    with pytest.raises(HTTPException) as error:
        require_app_access("wrong-key")
    assert error.value.status_code == 401
    require_app_access("gateway-key")


def test_integration_key_is_always_required(monkeypatch) -> None:
    monkeypatch.delenv("MATRIX360_INTEGRATION_KEY", raising=False)
    with pytest.raises(HTTPException) as missing:
        require_integration_access("anything")
    assert missing.value.status_code == 503
    monkeypatch.setenv("MATRIX360_INTEGRATION_KEY", "integration-key")
    with pytest.raises(HTTPException) as denied:
        require_integration_access("wrong-key")
    assert denied.value.status_code == 401
    require_integration_access("integration-key")
