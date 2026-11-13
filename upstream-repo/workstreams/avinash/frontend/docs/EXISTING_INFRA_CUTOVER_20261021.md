# Existing Render + Supabase + Vercel Recovery Cutover (21 Oct 2026)

## Confirmed assets
- GitHub source: `Matrix360consulting/matrix360-frontend`, recovery branch `recovery/avinash-p0-20261021`; GitHub writes exclusively via **AvinashWasHere21**.
- Existing Vercel project: `matrix360_frontend`, ID `prj_CVywrCPPNiBprpn2uS3uDmrXUhvB`.
- Recovery preview: https://matrix360frontend-hqcbw1ggq-matrix360s-projects.vercel.app — Vercel reports READY, preview deployment (no production alias).
- Original Render service: https://matrix360-crm-backend-p9os.onrender.com, ID `srv-db9i835g1s2s738qhhjg`.
- Existing Supabase **development** project: `unabhltnmqoqysrrdbcp`, ACTIVE_HEALTHY. Do **not** touch other staging projects.

## Already connected in the recovered frontend
- HTTPS-hosted pages use same-origin `/api/crm` as the login and CRM base path.
- `vercel.json` rewrites `/api/crm/:path*` to the existing Render service; no cache of private CRM API responses.
- Offline URL validation and routing tests pass. **Actual authenticated remote flow is NOT yet verified.**
- The authorized Supabase publishable key is available from the existing project; neither secret keys nor real customer data are committed.

## Manual provider access required before permanent source linking
1. Render > existing CRM service > Account/Git Deployment Credentials: grant the service access to `Matrix360consulting/matrix360-crm-backend`. Do not change the current source yet.
2. Vercel > `matrix360_frontend` > Settings > Git: grant the Vercel GitHub app access to `Matrix360consulting/matrix360-frontend`. Current Git installation cannot locate this organization repository. Do not disconnect until the new repository is visible.
3. **Do not submit Render Settings > Build > Source > Edit yet**: Render automatically deploys when the repository changes. The currently deployed backend commit `2ffb5b3` includes Director onboarding and Copilot functions **not fully reconstructed** in our backup. A direct replacement would downgrade functionality.

## Exact Render environment contract once replacement is approved
- `MATRIX_SUPABASE_URL=https://unabhltnmqoqysrrdbcp.supabase.co`
- `MATRIX_SUPABASE_PUBLISHABLE_KEY`: active development **publishable** or legacy anon key from Supabase; do not use service-role key.
- `M360_AI_ENABLED=false` by default.
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app_cloud:app --host 0.0.0.0 --port $PORT`
- Render health path: `/health`
- Recovery branch: `recovery/avinash-p0-20261021`; auto-deploy off during controlled acceptance.

## Actual acceptance requirements
- Preview `/api/crm/health` returns HTTP 200 with JSON (may require Vercel preview authentication).
- `/api/crm/me/workspaces` without a token must return 401/403 JSON; a 200 is a failure.
- Log in with approved synthetic Supabase dev user, verify tenant memberships, cross-tenant denial, leads and logout.
- Director approval queue, new-business onboarding and real Copilot need separate hosted regression; they must never be implied complete by the 39 offline recovery backend tests.
- No unsolicited messages, paid AI, cross-team wiring, production alias changes or customer data mutations without approval.

**Provider state:** Supabase healthy, original Render live, Vercel recovery preview READY; full hosted end-to-end acceptance pending.
