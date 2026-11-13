# Avinash — Matrix360 CRM and SaaS frontend recovery

**Source of truth for recovery:** `AvinashWasHere21/Matrix360WIP` at branch `work/avinash`; the recovered app code is in this `workstreams/avinash/` directory. Do not use the suspended `Matrix360repo` repositories.

## GitHub identity and workstream boundaries

- **Avinash frontend and CRM writes:** `AvinashWasHere21` account only.
- **Mayur:** use Mayur's own GitHub account on `work/mayur`, not Avinash's credentials.
- **Tanmayi:** use Tanmayi's own GitHub account on `work/tanmayi`, not Avinash's credentials.
- **Pratha:** use Pratha's authorized account on `work/pratha`.
- Do not write to colleagues' branches or directories, merge code, deploy to production or wire Mayur to Pratha without authorization. Distinct accounts do not replace GitHub's security/acceptable-use rules.

## Recovered components

- `frontend/` — Director-approved engagement site, sign-in, CRM UI, AI plan controls, same-origin Render proxy, tests.
- `crm-backend/` — reconstructed FastAPI development CRM using Supabase RLS; existing newer hosted Render backend has capabilities **not fully present** in this recovery.
- Backend unit suite: **39 tests passed locally on 21 October 2026**, using a dummy key and mocked identity/database. Frontend synthetic browser regression tests passed locally. Automated CI is configured in `.github/workflows/avinash.yml` and must be verified on GitHub separately.

## Existing infrastructure: reuse, don't recreate

- Vercel project `matrix360_frontend` (`prj_CVywrCPPNiBprpn2uS3uDmrXUhvB`).
- WIP-sourced Vercel preview: https://matrix360frontend-jiz5ebu2x-matrix360s-projects.vercel.app (provider status READY; may require preview authentication).
- `frontend/vercel.json`: `/api/crm/:path*` HTTPS rewrite to existing Render `https://matrix360-crm-backend-p9os.onrender.com/:path*`.
- Existing Render CRM: `srv-db9i835g1s2s738qhhjg`. Its current deployed version is newer than the backup, so **do not overwrite it**.
- Existing Supabase DEV database: `unabhltnmqoqysrrdbcp` (do not mutate `matrix360-saas-staging`).
- Production-ready status **not verified**: hosted authenticated login, tenant isolation, Copilot, onboarding and Render source cutover still need real tests.
- No secrets, service-role keys, customer datasets, filled `.env` files or personal login details may be committed.

## Local commands

```powershell
cd workstreams/avinash/crm-backend
python -m pip install -r requirements.txt pytest
# Supply dummy environment variables for mocked tests only:
$env:MATRIX_SUPABASE_URL="https://fixture.invalid"
$env:MATRIX_SUPABASE_PUBLISHABLE_KEY="CI_ONLY_NONSECRET_TEST_VALUE"
python -m pytest -q tests test_layout.py
```

Frontend syntax: `node --check workstreams/avinash/frontend/matrix360-api-config.js`. Browser suites under `frontend/tests/` need Chromium/Playwright and are **mocked**, not hosted acceptance.

## Render/Vercel cutover gate

1. Confirm Vercel preview routes `/api/crm/health` to Render and returns health JSON; Vercel preview protection may require login.
2. Confirm `/api/crm/me/workspaces` rejects unauthenticated requests.
3. With a permitted Supabase DEV account, verify existing workspace membership, isolated leads, stages and revocation; confirm Director onboarding and Copilot API behavior.
4. Authorize the Vercel GitHub app for this private WIP repository if automatic deployments are required. Preview source-upload deploy already works without that integration.
5. Render provider authorization and source re-link require a **separate, controlled cutover**; changing source can deploy the backup and remove newer functionality. Leave auto-deploy off until accepted.
6. Only after actual staging evidence should a reviewed PR be promoted to `main` or any production alias modified.

**Delivery deadline:** 22 October 2026, 3:30 PM IST. Do not present mocked checks or a READY preview build as live CRM acceptance.

## Hosted acceptance evidence and secure optional smoke

- GitHub Actions read-only probe (run 13) verified **Render /health 200** and anonymous **/me/workspaces 401**; the protected Vercel preview returned **401**, so the preview proxy itself is not yet proved. Do not disable Vercel Deployment Protection as a testing shortcut.
- `frontend/tests/test_same_origin_proxy.cjs` checks the HTTPS proxy, unsafe API origins, and `vercel.json` cache controls; this is an offline test.
- To test the **existing Render CRM** with an authorized synthetic **development** account, set `M360_DEV_TEST_EMAIL` and `M360_DEV_TEST_PASSWORD` privately in your local terminal or a managed secret store, then run `python workstreams/avinash/tools/authenticated_dev_readonly_smoke.py`. Do not put real passwords, auth tokens, client identifiers, or data in tickets, PRs, ChatGPT messages or repo commits.
- That opt-in script performs sign-in and **GET-only CRM reads**; it does not create, modify or send business records. A random unassigned workspace denial is NOT the same as a cross-tenant test between two actual memberships.
- With an authorized browser signed into Vercel, confirm that `/api/crm/health` returns health JSON instead of a Deployment Protection page; then complete the real authenticated login and tenant-isolation acceptance manually.

