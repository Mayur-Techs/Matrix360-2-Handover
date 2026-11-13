# Matrix 360 Document Upload & Qualification handover

Date: 2026-10-28 (Asia/Kolkata)

## Delivery identity

- Repository: `https://github.com/AvinashWasHere21/Matrix360WIP`
- Fallback baseline: `main` at `58fd5efc92be0dad491046b429758e7977aeca72`
- Reason for fallback: `codex/romit/local-website-login-recovery-20261027` was not present in the fetched remote branch list. The supplied recovery ZIP contains only selected changed files, not its required `m360-control-contract` dependency or the full recovered Vercel source manifest.
- Working branch: `feature/mayur/document-upload-marketing-20261028`
- Implementation commit: `74b0f8c0bcedbc695896fc55ddb7ae1c470af18a` (`feat(mayur): add secure document qualification workflow`).

## Completed implementation

The dashboard now loads a separate **Document Upload & Qualification** module from the existing Audience/Lead Intelligence surface. It contains:

1. Multi-file picker and drag-and-drop for the engine-supported `.csv`, `.tsv`, `.xlsx`, `.xls`, `.xlsb`, `.parquet`, `.jsonl`, and `.ndjson` formats.
2. Truthful selected/uploaded-file rows: engine-returned filename, byte size, local receipt time, and schema-inspection status.
3. Dataset ID display and engine-provided schema catalogue. The interface renders only engine-reported field labels/groups; it does not invent mappings for company, name, role, phone, email, location, GSTIN, or CIN.
4. A lead-qualification objective plus four review areas: industry/sector, business scale, designation, and documented asset/operational characteristics.
5. The engine's deterministic, schema-only filter suggestion flow, with visible provider status and no automatic model call.
6. Explicit validation and approval of a filter plan before a job can be started.
7. Secure job start, engine progress polling, actual reconciliation/export counts, results count, and authenticated download buttons for available exports.

The current engine exposes existing qualification profiles (`Lakhotia Industrial`, `Shree Heights`, and `Vrindavan Greens`) for the v1 job endpoint. The UI labels them as such rather than presenting them as a generic universal profile.

## Authentication, isolation, and data handling

Browser JavaScript never receives the engine credential and never calls the engine directly. `api/document-qualification.js`:

1. Requires the existing CRM bearer session.
2. Calls CRM `/me/workspaces` server-side and accepts only the selected membership workspace.
3. Signs the exact engine request using the engine's supported service-auth contract: method, path, workspace, timestamp, and one-time nonce.
4. Sends `X-Matrix-Workspace`, timestamp, nonce, and HMAC signature to the engine. It does not forward the CRM token to the engine.
5. Allowlists each engine operation; it does not proxy arbitrary paths or user-provided URLs.
6. Fails closed with `503 integration_not_configured` when either server-only engine setting is absent. No upload, processing, success state, or fake record is created in that case.

Required server-only environment variables are documented in `.env.example`:

- `MATRIX360_ENGINE_BASE_URL` — HTTPS origin of the authorized engine deployment.
- `MATRIX360_ENGINE_SERVICE_AUTH_SECRET` — value shared with the engine's `MATRIX360_SERVICE_AUTH_SECRET`.
- Optional `MATRIX360_CRM_API_URL` and `MATRIX360_DOCUMENT_MAX_UPLOAD_BYTES`.

Do not expose these in browser JavaScript, `.env.example` values, Git history, screenshots, or handover archives. The unauthenticated engine bootstrap route was deliberately not used.

## Files created or changed

- `workstreams/avinash/frontend/api/document-qualification.js` — same-origin, CRM-verified, HMAC-signed engine gateway.
- `workstreams/avinash/frontend/matrix360-document-qualification.js` — dashboard upload, inspection, approval, job, and export UI.
- `workstreams/avinash/frontend/matrix360-lead-engine.js` — loads the isolated dashboard module without restructuring Avinash's page.
- `workstreams/avinash/frontend/.env.example` — names only, no values or secrets.
- `workstreams/avinash/frontend/tests/document-qualification-gateway.test.cjs` — offline unit/static contract coverage.
- `workstreams/romit/vercel-recovery/dpl_AiuAnMhU3n4YxdKLfMJ8odoYDtEn/start-exact-local.ps1` — recovered port-8000 launcher from the supplied ZIP.
- This handover document.

## API contract used

The gateway exposes only these verified engine paths:

- `POST` and `GET` `/api/v1/datasets`
- `GET` `/api/v1/datasets/{dataset_id}/schema-catalog`
- `POST` `/api/v1/datasets/{dataset_id}/filter-plans/suggest`
- `POST` `/api/v1/datasets/{dataset_id}/filter-plans/validate`
- `POST` `/api/v1/datasets/{dataset_id}/filter-plans/apply`
- `POST` `/api/v1/jobs`, `/api/v1/jobs/{job_id}/execute`
- `GET` `/api/v1/jobs/{job_id}`, `/results`, `/exports`
- `GET` `/api/v1/exports/{export_id}/download`

`/api/v5/workbench/generate-filters` and `/stream-qualify` were inspected but are not wired here: the v1 workflow already provides durable dataset/job/export records, while the current v5 stream contract is a separate one-file SSE workflow with its own client-profile behavior. No paid provider call is made by default.

## Local launch and verification

Use the exact recovered launcher from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "workstreams/romit/vercel-recovery/dpl_AiuAnMhU3n4YxdKLfMJ8odoYDtEn/start-exact-local.ps1"
```

The intended URL is `http://127.0.0.1:8000/login.html`. The older ZIP document saying `8010` is stale; the launcher itself verifies and starts port `8000`.

Do not use `run_synthetic_demo.py`, a Python static server, port `8010`, deployments, the bootstrap endpoint, or fabricated API results.

## Tests executed

| Command | Result |
| --- | --- |
| `node --check workstreams/avinash/frontend/api/document-qualification.js` | PASS |
| `node --check workstreams/avinash/frontend/matrix360-document-qualification.js` | PASS |
| `node --check workstreams/avinash/frontend/matrix360-lead-engine.js` | PASS |
| `node --test workstreams/avinash/frontend/tests/document-qualification-gateway.test.cjs` | PASS — 4 tests |
| `node --test workstreams/avinash/frontend/tests/*.cjs` | PASS — 10 test files, 0 failures |
| `git diff --check` | PASS |
| `python -m pytest ...test_api_origin_contract.py ...test_browser_handoff.py ...test_session_fail_closed.py -q` | NOT RUN AS PYTEST — no discoverable pytest tests; exited 5 without executing browser checks |

No authenticated browser upload, job, export, live scraper, paid API call, production database migration, campaign, or deployment was run.

## Known blockers and external dependencies

1. The current local Vercel launcher invoked `npx vercel@44.7.3` but did not bind port 8000 during the bounded checks. The launcher process remained alive; the login page is therefore **not verified as running** and no screenshot was captured.
2. The deployed engine's `/openapi.json` did not respond within 25 seconds, so deployment-versus-local source compatibility is **not verified**.
3. An authorized deployer must configure the two server-only engine variables above in the local/staging environment and ensure the same HMAC secret is configured in the engine. Until then, the gateway correctly returns an unavailable error and uploads do not start.
4. CRM-to-engine workspace identifiers must use the engine service-auth contract exactly. This branch does not change CRM roles, engine secrets, Render, Vercel, or any production data.
5. The recovery ZIP is incomplete for restoring Romit's Control Center/Overview changes: it lacks the imported `m360-control-contract` and the full recovery source. Those changes were not copied into this branch.

## Final integration actions

### Avinash

1. Review the gateway contract and approve/provision the server-only secret in the authorized staging environment.
2. Verify the CRM workspace ID convention matches the engine tenant convention for every real workspace.
3. Start the exact local launcher, sign in with an authorized CRM user, and verify upload, rejection, schema, approval, job progress, result reconciliation, and export download with an isolated authorized fixture.
4. Review the branch into the appropriate Avinash integration branch; do not merge automatically.

### Romit

1. Supply the remote branch, commit, Git bundle, or complete Vercel source manifest for `codex/romit/local-website-login-recovery-20261027` if the Overview recovery must be restored.
2. Resolve the local `npx vercel@44.7.3` startup/bind issue before acceptance testing.
3. Keep lead-generator execution separate from this upload workflow; no live discovery/scraping was triggered.

## Marketing & Research next-workstream plan

Current reusable surfaces are the workspace-scoped CRM session/workspace selector, read-only growth brief, Creative Studio availability/approval gates, and the new data-qualification gateway. There is no live Marketing Centre, channel dispatcher, contact-sourcing service, or campaign analytics store yet.

1. **Foundation:** create one workspace-scoped marketing-plan record, approval ledger, feature-readiness endpoint, and history drawer. Every downstream tool reads the same workspace and approval state.
2. **Research and audience:** surface the qualified dataset/export metadata, evidence boundaries, consent state, and source provenance. Keep discovery, validation, and enrichment separate.
3. **Planning and creative:** connect the existing Creative Studio to approved audience segments and saved briefs; retain draft/review/publish boundaries.
4. **Channel adapters:** add WhatsApp, email, LinkedIn, Facebook/Instagram, and advertising only as isolated, per-workspace adapters with explicit approval, provider readiness, rate controls, audit events, and no-send dry runs.
5. **Analytics:** reconcile provider delivery events and CRM outcomes by campaign/workspace; show unavailable/partial states rather than inferred reach or conversions.
6. **AI assistant and targeting:** keep recommendations schema/evidence-bound, display provider status and cost approval, and never infer consent, identity, deliverability, or buying intent.

## Rollback

Before merge, remove the feature branch or revert its delivery commit. After merge, revert only the feature commit(s); no shared history rewrite, force push, production data deletion, or environment-secret change is required.
