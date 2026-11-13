#!/usr/bin/env python3
"""Opt-in dev-identity smoke test for existing Render CRM. No writes to business data.
Set M360_DEV_TEST_EMAIL/PASSWORD in your own shell; never commit or print these values.
Run only for an explicitly authorized synthetic Supabase development account.
"""
import json
import os
import secrets
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

BASE = "https://matrix360-crm-backend-p9os.onrender.com"

def request(path, method="GET", payload=None, token=None):
    headers = {"Accept": "application/json", "Cache-Control": "no-store"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if payload is not None:
        headers["Content-Type"] = "application/json"
    req = Request(BASE + path, data=None if payload is None else json.dumps(payload).encode(),
                  headers=headers, method=method)
    try:
        resp = urlopen(req, timeout=30)
    except HTTPError as exc:
        resp = exc
    with resp:
        raw = resp.read(64000)
        status = resp.status if hasattr(resp, "status") else resp.code
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        body = None
    return status, body

def main():
    email = os.environ.get("M360_DEV_TEST_EMAIL", "")
    password = os.environ.get("M360_DEV_TEST_PASSWORD", "")
    if not email or not password:
        print("BLOCKED: authorized synthetic development account credentials required in environment")
        return 2
    try:
        status, auth = request("/auth/login", method="POST", payload={"username": email, "password": password})
        if status != 200 or not isinstance(auth, dict) or not auth.get("access_token"):
            print("FAIL: development login did not return a valid access token (HTTP %s)" % status)
            return 1
        token = auth["access_token"]
        status, workspaces = request("/me/workspaces", token=token)
        if status != 200 or not isinstance(workspaces, list) or not workspaces:
            print("FAIL: authenticated development user has no authorized workspaces (HTTP %s)" % status)
            return 1
        workspace = workspaces[0].get("id")
        if not isinstance(workspace, str) or not workspace:
            print("FAIL: membership has no valid workspace identifier")
            return 1
        ws = quote(workspace, safe="")
        stages_status, stages = request("/workspaces/" + ws + "/stages", token=token)
        leads_status, leads = request("/workspaces/" + ws + "/leads", token=token)
        if stages_status != 200 or not isinstance(stages, list) or not stages:
            print("FAIL: authorized workspace stages not available (HTTP %s)" % stages_status)
            return 1
        if leads_status != 200 or not isinstance(leads, list):
            print("FAIL: authorized workspace leads not available (HTTP %s)" % leads_status)
            return 1
        unknown = "m360_auth_negative_" + secrets.token_hex(8)
        denied_status, _ = request("/workspaces/" + unknown + "/leads", token=token)
        if denied_status not in {403, 404}:
            print("FAIL: unassigned random workspace not denied (HTTP %s)" % denied_status)
            return 1
        print("PASS: synthetic development login, membership, stages, leads and unknown-workspace denial")
        print("NOTE: no lead values, workspace identities or tokens printed; no business writes made")
        print("NOT PROVEN: real known-other-tenant isolation, Director admin, onboarding, Copilot, Vercel proxy")
        return 0
    except (OSError, URLError, ValueError, KeyError, TypeError) as exc:
        print("BLOCKED: hosted authentication check unavailable (%s)" % type(exc).__name__)
        return 2

if __name__ == "__main__":
    sys.exit(main())
