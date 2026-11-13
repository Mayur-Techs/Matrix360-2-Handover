**RECOVERY BUILD — NOT THE ORIGINAL DEPLOYED SOURCE**
Reconstructed from the available 20–21 October Matrix 360 backups. Do not deploy or merge without isolated staging acceptance.

Includes FastAPI + Supabase publishable-key authentication, RLS-scoped CRM access, dynamic business membership, generic stages for newly onboarded businesses, original three pilot stage labels, and an optional local-only AI plan router with human-review and no dispatch.

Run: `MATRIX_SUPABASE_URL=https://... MATRIX_SUPABASE_PUBLISHABLE_KEY=... uvicorn app_cloud:app --reload`.
Run mocked security regression tests: `pytest -q tests`.
Current development limitations: latest Render dynamic-onboarding/Director administration source was not recovered; this is NOT a drop-in replacement. Configured URL and issuer must be verified with real staging JWTs. External AI disabled by default.

Written to Matrix360consulting **only as AvinashWasHere21**, branch `recovery/avinash-p0-20261021`. No automatic deployment or customer communications.