"""Fail-closed staging access checks for the independent research sidecar."""
from __future__ import annotations

import hmac
import os

from fastapi import HTTPException


PRIVATE_STAGES = {"staging", "production"}


def deployment_stage() -> str:
    return os.getenv("MATRIX360_DEPLOYMENT_STAGE", "local").strip().lower()


def requires_app_access() -> bool:
    return deployment_stage() in PRIVATE_STAGES


def require_app_access(provided_key: str) -> None:
    """Require a server-injected gateway key outside local development."""
    if not requires_app_access():
        return
    expected = os.getenv("MATRIX360_APP_ACCESS_KEY", "").strip()
    if not expected:
        raise HTTPException(503, "Staging access is not configured.")
    if not hmac.compare_digest(provided_key, expected):
        raise HTTPException(401, "Invalid Matrix360 application access key.")


def require_integration_access(provided_key: str) -> None:
    expected = os.getenv("MATRIX360_INTEGRATION_KEY", "").strip()
    if not expected:
        raise HTTPException(503, "Matrix360 integration is not configured.")
    if not hmac.compare_digest(provided_key, expected):
        raise HTTPException(401, "Invalid Matrix360 integration key.")
