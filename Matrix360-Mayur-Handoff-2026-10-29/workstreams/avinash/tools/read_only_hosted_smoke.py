#!/usr/bin/env python3
"""Read-only hosted CRM smoke probe: no credentials, customer data or writes."""
import json
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

RENDER = "https://matrix360-crm-backend-p9os.onrender.com"
PREVIEW = "https://matrix360frontend-jiz5ebu2x-matrix360s-projects.vercel.app"

def probe(url, attempts=2):
    if not url.startswith("https://"):
        raise ValueError("HTTPS required")
    for i in range(attempts):
        try:
            request = Request(url, headers={"Accept": "application/json", "Cache-Control": "no-store", "User-Agent": "Matrix360-read-only-smoke/1"})
            try:
                response = urlopen(request, timeout=25)
            except HTTPError as exc:
                response = exc
            with response:
                status = response.status if hasattr(response, "status") else response.code
                content_type = response.headers.get("Content-Type", "")
                body = response.read(4096)
            try:
                decoded = json.loads(body)
            except (ValueError, UnicodeDecodeError):
                decoded = None
            return status, content_type, isinstance(decoded, (dict, list))
        except (URLError, TimeoutError, OSError) as exc:
            if i + 1 == attempts:
                print("BLOCKED: transport unavailable (" + type(exc).__name__ + ")")
                return None
            time.sleep(3)
    return None

def has_json_status(result, expected):
    return bool(result and result[0] in expected and result[2] and "html" not in result[1].lower())

def main():
    errors = 0
    health = probe(RENDER + "/health", attempts=3)
    print("Render health status:", health[0] if health else "UNREACHABLE")
    if not has_json_status(health, {200}):
        errors += 1
    anonymous = probe(RENDER + "/me/workspaces")
    print("Render unauthenticated memberships:", anonymous[0] if anonymous else "UNREACHABLE")
    if not has_json_status(anonymous, {401, 403}):
        errors += 1
    preview = probe(PREVIEW + "/api/crm/health")
    print("Vercel protected preview CRM proxy:", preview[0] if preview else "UNREACHABLE")
    if has_json_status(preview, {200}):
        print("Proxy health returned JSON; real CRM login still NOT tested.")
    elif preview and preview[0] in {401, 403, 302, 307, 308}:
        print("Preview access is protected; proxy not proven.")
    else:
        print("Preview proxy remains unverified.")
    print("This check does NOT prove login, RLS, onboarding or Copilot.")
    if errors:
        print("FAIL: live Render health/anonymous access contract unverified.")
    return 1 if errors else 0

if __name__ == "__main__":
    sys.exit(main())
