# LinkedIn Campaigns & Publishing — implementation report

November 14, 2026. Active source: `Matrix360-Mayur-Handoff-2026-10-29` in the Matrix360 2 Handover workspace. This is a filesystem handoff without Git metadata; no commit, push or deployment is claimed.

## Result

Implemented the LinkedIn service in the existing Marketing experience with real provider request paths, durable local/hosted storage adapters, and no synthetic production-success fallback. WhatsApp/email campaign behavior and provider rules were left unchanged. Shared edits are confined to LinkedIn routing, loading and replacement of the legacy LinkedIn token vault.

The user selected **`LINKEDIN_SAFETY_GUARDRAILS=false`**, and that value is present in the local environment. An authorized user can schedule a saved post directly. Optional exact-post approval and media-rights acknowledgement remain available when the flag is enabled.

**Locally implemented and verified does not mean live-certified or deployed.** The actual LinkedIn client credentials are still blank, no account holder has completed live OAuth in this work, and no real public post or paid generation was performed.

## Implemented workflow

- Existing Matrix360 login/workspace membership and publishing roles; independently encrypted LinkedIn grants; one-time session/workspace-bound OAuth; reconnect/disconnect and conditional refresh where LinkedIn returns refresh credentials.
- Separate connected member and publishing destinations, eligible Page discovery, actual scopes, operation-specific authority checks and explicit unavailable capabilities.
- Overview/Marketing LinkedIn brief handover into the composer. HandoverEnvelope and correlation context persist; saved campaigns expose their progress and independent destination jobs.
- AI preparation/revisions from saved Brand Profile and client input, English/Hindi/Bengali selection, up to three actual alternative drafts, missing-information notes and explicit date/time proposals. Applying a proposal fills the draft; scheduling remains an explicit operation.
- Saved campaign revisions and history, exact selected author/text/media/link/time preview, optional approval, finite batch actions, and direct scheduling with the user's selected flag.
- Real uploaded JPEG/PNG, MP4 and PDF; immutable chunks and content hashes; saved Content Studio poster attachment; durable requests to the existing Creative Studio renderer; actual completed media imported into this workspace without manual file transfer.
- Provider initialize/upload/finalize/status flows; one media or link attachment per post. Media processing state persists across worker passes. A status-read permission failure is labelled unverified; it is not fabricated readiness.
- One durable job per destination; atomic claims, leases, restart recovery, bounded retries, provider Retry-After, cancellation before dispatch, failed-only retries, and explicit reconciliation of unknown outcomes. Successful destinations are preserved.
- Genuine provider acknowledgement IDs, separately verified read-back, entitled metrics with timestamps and honest unavailability. Never claim that an organic post was delivered to a named CRM contact list.
- Enquiry attribution verifies an existing workspace CRM lead and records the team's campaign association without copying contact fields or converting LinkedIn engagement into prospects. Stage is a timestamped CRM snapshot, not automatic proof of causation or an automatically refreshed CRM pipeline.
- Retention cleanup for expired OAuth state/incomplete uploads, stale cached Page names and old reports. Customer-authored posts and saved media remain customer data.

## Changed implementation files

| Area | Files relative to handoff |
| --- | --- |
| Request/auth/workflow | `workstreams/avinash/frontend/lib/m360-linkedin-api.js`, `m360-linkedin-service.js` |
| LinkedIn HTTP provider | `workstreams/avinash/frontend/lib/m360-linkedin-provider.js` |
| Persistence and migrations | `workstreams/avinash/frontend/lib/m360-linkedin-store.js`, `workstreams/avinash/frontend/migrations/20261114_linkedin.sql` |
| Content Studio bridge | `workstreams/avinash/frontend/lib/m360-linkedin-content.js` |
| Marketing UI | `workstreams/avinash/frontend/lib/m360-linkedin-client.browser.js` |
| Existing entry points | `workstreams/avinash/frontend/api/marketing.js`, `lib/m360-marketing-client.js`, LinkedIn sections of `lib/m360-marketing-client.browser.js`, LinkedIn condition in `lib/m360-overview-intent.js`, `vercel.json` |
| Worker | `tools/linkedin-worker.cjs`, `package.json` script `linkedin:worker` |
| Local setup | LinkedIn entries only in `workstreams/avinash/frontend/.env.local`; generated encryption/worker secrets are not printed in documentation |
| Regression tests | `workstreams/avinash/frontend/tests/linkedin-{api,content,http,provider,service,store,ui,workflow}.test.js`; LinkedIn expectations in `control-center.test.js`, `m360-autonomous-directives.test.js` and the LinkedIn portion of the shared `m360-whatsapp-campaign-vault.test.js` (WhatsApp/email assertions unchanged) |
| Reproducible QA | `qa/linkedin-local-smoke.cjs`, `qa/linkedin-postgres-check.cjs`, `qa/linkedin-postgres-evidence.json`, `qa/LINKEDIN_UI_QA_2026-11-14.md` |

The LinkedIn URL remains `/api/linkedin`; it is routed through the existing Marketing function to retain the deployment's twelve-function limit. Legacy LinkedIn token-configure/verify endpoints now direct clients to OAuth. Email and WhatsApp endpoints retain their existing behavior.

## Verification ledger

- Full application suite: **269/269 passed**, 39 test files, zero failures/skips, Node 24.22.1; final run completed in 13.7 seconds. Tests use declared mocked external providers; they do not publish or prove hosted integration.
- Real SQLite tests cover cross-tenant records, encrypted grants, state replay/expiry, optimistic revisions, independent worker-process claims, expiry/recovery, cancellation, exact approval, immutable assets, media processing, partial destinations, failed-only retry, unknown outcomes, reconciliation and refresh/disconnect races.
- Actual local HTTP fixture exercises the real API/service/store with mocked CRM/LinkedIn through OAuth → save → schedule → worker → result/read-back.
- Actual local preview smoke: **2/2 passed**, checking unauthenticated API rejection and served LinkedIn JavaScript. Auto-login was disabled for the isolated smoke server; it was stopped afterward.
- Native Chrome fixture exercises actual browser code with explicitly mocked API state: handover, drafts, media preview, save/reopen, optional review disabled, approval, scheduling, cancellation, attribution and workspace reset. No runtime exceptions or horizontal overflow at 375/768/1440 widths. See the QA record for exact fixture boundaries.
- Actual SQL migration applied twice to **PostgreSQL 18.6 using PGlite 0.5.16**: **13/13 grouped checks passed**, including RLS/privileges, state consumption, claims, retries, leases, cancellation, compare-and-swap and retention. PGlite was installed in an isolated temporary directory with install scripts disabled; it is not an application dependency.
- Independent final review found no new critical issue in the LinkedIn service/API/provider/content and handover routes after correction of read-back verification and partial-success recovery.
- No real account token, fake provider ID, test lead or demo content was added to the production workflow. Test transports/fixtures are labelled and isolated; the temporary handover written by an early regression test was removed, and that test now uses its own in-memory database.

## Database, worker and deployment state

Local SQLite schema is created and tested; it contains no seeded client campaigns or grants. SQL migration is locally tested and ready to apply to the selected hosted database. No shared/hosted migration was executed. The worker entry point and heartbeat are implemented; no persistent worker was left dispatching real jobs. No hosted API or worker deployment was performed.

A Supabase-backed API and worker must use the same database and encryption key. Serverless SQLite is rejected. Large media should be dispatched by the persistent worker, not a short-lived function. Embedded SQL checks do not prove hosted PostgREST configuration or multi-process PostgreSQL contention in the final deployment.

## Gap register

| Item | State and precise next proof |
| --- | --- |
| Local customer workflow | Implemented; logic/HTTP/browser fixtures verified |
| Actual Matrix360 account login + LinkedIn OAuth | Implemented, live unverified; app credentials, exact callback registration and account-holder authorization needed |
| Commercial Community Management and Page access | External approval required; configured scopes do not manufacture entitlement |
| Real image/video/PDF publishing | Implemented, live unverified; execute an explicitly selected public acceptance post and retain real provider evidence |
| Hosted migration/API/worker | Deployment pending; local SQL test is not hosted integration |
| Content Studio generation | Existing renderer reused; live provider readiness/paid job not invoked in this task |
| Analytics/read-back | Implemented for supported scope; actual app entitlements and values unverified |
| Existing-CRM enquiry attribution | Implemented and tested with mocked CRM; live CRM record association unverified |
| Automatic public website-form ingestion | Not added; use existing first-party CRM intake, then record verified attribution |
| Multi-image/polls/sponsored carousel, post deletion/editing | Not exposed by this first publishing workflow; adapter currently supports text/link/single-image/video/PDF |
| Community responses, invitations, DMs/InMail, native newsletters | Not implemented; do not substitute private APIs or browser bots |
| Lead Sync and paid advertising | Separate product access and implementation; no spending or harvesting added |
| Autonomous recurring generation | Not enabled; finite actual saved content can be scheduled, without treating a concept as unlimited future publication permission |

## Setup and acceptance

Follow [LINKEDIN_ADMIN_SETUP.md](LINKEDIN_ADMIN_SETUP.md) for exact environment names, callback URL, scopes, worker/migration steps, every optional/required control, and the next live acceptance sequence. Provider documentation and repository/license findings are in [LINKEDIN_PROVIDER_RESEARCH.md](../workstreams/avinash/frontend/docs/LINKEDIN_PROVIDER_RESEARCH.md). Storage details are in [LINKEDIN_STORAGE_SETUP.md](../workstreams/avinash/frontend/docs/LINKEDIN_STORAGE_SETUP.md).

No runtime Postiz installation was added: no existing accepted package was found in this bounded inspection, and adding another platform would introduce a second deployment/scheduler without supplying LinkedIn app approval. The native adapter uses existing Node primitives; the only added external package was the isolated development-only PostgreSQL validation runtime.
