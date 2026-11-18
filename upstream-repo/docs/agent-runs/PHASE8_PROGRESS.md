# Matrix360 Phase 8: LinkedIn UI, Audit Harness Extension, and Guarded Live Smoke Progress

**Branch**: `mayur/phase8-linkedin-ui`  
**Node Version**: `v24.22.1`  
**Base Commit**: Branched from `mayur/phase7-production-hardening`  
**Date**: 2026-11-14  

---

## Stage 0 — Baseline & Environment Inventory

### 1. Baseline Verification Outputs

#### Node Version
```
v24.22.1
```

#### LinkedIn Test Suite (`node --test tests/linkedin-*.test.js`)
```
✔ API rejects anonymous, wrong-tenant and expired CRM sessions before exposing records (20.9376ms)
✔ API preserves role boundaries with optional LinkedIn reviews disabled (51.4944ms)
✔ API enforces HTTP methods and rejects cross-site mutations (2.3897ms)
✔ API cannot read, edit, schedule or disconnect a foreign workspace record through guessed IDs (7.7338ms)
✔ authenticated worker executes each tenant job using only that tenant encrypted grant (23.1855ms)
✔ concurrent and repeated starts reserve one durable request before generation and never save bearer (18.1352ms)
✔ uncertain provider start is durable and repeating the request never triggers generation again (3.6239ms)
✔ pending content waits; completion imports actual bytes as immutable tenant asset exactly once (67.0766ms)
✔ requests and resulting assets remain separate across two client workspaces (13.0622ms)
✔ arbitrary hosts, foreign tenant paths and mismatched job responses never trigger downloads (11.3028ms)
✔ failed download retries import of the same provider job without repeating generation (8.5875ms)
✔ oversized output remains unimported and no ready asset is invented (4.7192ms)
✔ poll recovers a completed asset after interruption before content request acknowledgement (5.9477ms)
✔ HTTP fixture completes authorized connect, compose, approve, schedule, worker, and read-back (355.7866ms)
✔ OAuth exchanges on the server and introspects actual scopes when token response omits them (85.5645ms)
✔ OAuth never substitutes requested scopes for absent grant evidence (3.2788ms)
✔ refresh exchanges only a provider-issued credential and uses confirmed new expiry/scopes (4.5752ms)
✔ author recheck rejects another member and revoked tokens (5.0543ms)
✔ Page discovery checks organic operation authority and excludes denied Pages (3.5641ms)
✔ native video uploads exact byte ranges, ordered ETags, finalizes, then reads actual processing status (4.0329ms)
✔ upload rejects untrusted redirect destination and incomplete video ranges before finalization (6.9896ms)
✔ image upload without media read access reports unavailable status rather than fabricated readiness (1.4561ms)
✔ publication uses real provider acknowledgement and refuses pending media (1.7769ms)
✔ missing post IDs, network timeouts, and server errors are unknown outcomes with no blind retry (1.7259ms)
✔ explicit rate limiting carries provider retry time and is distinguishable from unknown outcome (1.22ms)
✔ missing analytics access and missing metric values remain unavailable, never invented zeros (2.5061ms)
✔ OAuth binds state to workspace and actor, rejects replay, and keeps tokens private (29.0723ms)
✔ OAuth state and expired grants cannot execute (51.637ms)
✔ material edits invalidate approvals and stale versions cannot overwrite (15.4414ms)
✔ optional review disabled still enforces CRM membership, roles, and tenant ownership (16.1085ms)
✔ multiple destinations retain successful publication when another destination fails (14.6693ms)
✔ unavailable destination capability does not lock a campaign or enqueue partial work (9.4167ms)
✔ missing post IDs and ambiguous timeouts become unknown and are never blindly retried (22.7046ms)
✔ explicit provider rate-limit rejection is retried after its delay (16.2989ms)
✔ cancellation and removed Page authority prevent publication (11.8302ms)
✔ media chunks become immutable and foreign/corrupt assets never publish (10.4249ms)
✔ an uploaded chunk may be resent unchanged but cannot be replaced before approval (8.8126ms)
✔ upload acknowledgement without media-read permission can publish, without claiming processing proof (18.8149ms)
✔ real uploaded video waits for provider media readiness before post creation (15.8001ms)
✔ manual retry queues only definite failed destinations and preserves the successful post (17.6671ms)
✔ read-back verification requires the exact post ID, author, and published lifecycle (9.3239ms)
✔ unknown reconciliation rejects foreign author, tenant, and content before saving evidence (9.8955ms)
✔ an entitled refresh grant renews expired access without exposing tokens (7.647ms)
✔ disconnect while refresh is in flight prevents returning the old grant (4.7087ms)
✔ two concurrent reconciliations cannot overwrite the first provider evidence (8.1446ms)
✔ LinkedIn SQLite preserves tenant isolation and revisions across restart (65.5944ms)
✔ OAuth state is consumed once across independent store handles (51.4219ms)
✔ two worker processes atomically claim a job once (210.9139ms)
✔ expired preparation leases recover; expired dispatches become unknown without reposting (26.6624ms)
✔ cancellation wins before dispatch; dispatching blocks cancellation and stale completion (22.5184ms)
✔ queued retry timing persists across restarts without changing completed destinations (29.1898ms)
✔ Vercel defaults to Supabase and rejects ephemeral SQLite (0.5307ms)
✔ only explicit provider rejection permits a dispatch retry with the active lease (17.3941ms)
✔ Supabase adapter scopes reads and passes CAS/lease arguments (mock network) (1.7556ms)
✔ retention cleanup removes expired temporary records only in the selected tenant (24.5019ms)
✔ retention clears old Page names and analytics but preserves publication evidence (19.507ms)
✔ Supabase list methods fetch every page even when the server uses a smaller page cap (mock network) (0.9585ms)
✔ operator recovery updates require the state originally reviewed (16.3538ms)
✔ Overview routes LinkedIn media and publishing briefs into its campaign workspace (10.6155ms)
✔ LinkedIn previews escape user, provider and AI text and reject executable links (1.0041ms)
✔ LinkedIn schedule preserves explicit local time, rejects invalid dates and DST gaps (309.982ms)
✔ AI schedule proposals require an explicit valid instant and remain draft values (18.7805ms)
✔ finite campaign batch preserves successful schedules and continues after an independent failure (0.7665ms)
✔ served Marketing bundle includes valid LinkedIn code and OAuth endpoint route (7.7423ms)
✔ cancelling remaining destinations excludes already published destinations from reschedule (90.0237ms)
✔ an unknown peer prevents cancellation from reopening or changing its campaign evidence (11.9822ms)
✔ persistent handover and progress remain in the correct workspace (53.5841ms)
✔ AI revisions use visible unsaved text and only client material, return honest alternatives and date proposal (5.4126ms)
✔ existing Marketing route delegates LinkedIn without invoking legacy campaign handling (178.2816ms)
✔ enquiry attribution verifies the workspace CRM record and deduplicates without copying contacts (3.0126ms)
✔ legacy LinkedIn token-vault endpoints direct clients to OAuth (0.906ms)
ℹ tests 71
ℹ suites 0
ℹ pass 71
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 749.8405
```

#### Exploits Audit Harness (`node tools/audit/exploits.js`)
```
====================================================
Matrix360 Phase 2 Trust Rails Exploit Audit Baseline
====================================================
[E1] NOT REPRODUCED
[E2] NOT REPRODUCED
[W1] NOT REPRODUCED
[W2] NOT REPRODUCED
[C1] NOT REPRODUCED
[C2] NOT REPRODUCED
[V1] NOT REPRODUCED
[P1] NOT REPRODUCED
[P2] NOT REPRODUCED
[X1] NOT REPRODUCED
[S1] NOT REPRODUCED
[R1] NOT REPRODUCED
[M1] NOT REPRODUCED
[WG1] NOT REPRODUCED
[WG2] NOT REPRODUCED
[WG3] NOT REPRODUCED
[WG4] NOT REPRODUCED
[WG5] NOT REPRODUCED
[EM1] NOT REPRODUCED
[EM2] NOT REPRODUCED
[EM3] NOT REPRODUCED
[AI1] NOT REPRODUCED
[AI2] NOT REPRODUCED
[AI3] NOT REPRODUCED
[DASH1] NOT REPRODUCED
[DASH2] NOT REPRODUCED
[DASH3] NOT REPRODUCED
[PIL1] NOT REPRODUCED
[NAV1] NOT REPRODUCED
[FE1] NOT REPRODUCED
[PIPE1] NOT REPRODUCED
[HALL1] NOT REPRODUCED
====================================================
```
Checks: 32 / 32 `NOT REPRODUCED` (100% green).

#### Full Test Suite (`npm test`)
```
ℹ tests 479
ℹ suites 14
ℹ pass 479
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15717.9463
```
Suites: 14/14, Tests: 479/479 pass (100% green).

---

### 2. Environment Variables Inventory

Names only (never values printed):

| Variable Name | Status |
| :--- | :--- |
| `LINKEDIN_CLIENT_ID` | **MISSING** |
| `LINKEDIN_CLIENT_SECRET` | **MISSING** |
| `LINKEDIN_REDIRECT_URI` | **MISSING** |
| `LINKEDIN_TOKEN_ENCRYPTION_KEY` | **MISSING** |
| `LINKEDIN_API_VERSION` | **MISSING** |
| `LINKEDIN_STORE_BACKEND` | **MISSING** |
| `LINKEDIN_SAFETY_GUARDRAILS` | **MISSING** |
| `OPENAI_API_KEY` | **MISSING** |
| `M360_OPENAI_SPEND_APPROVED` | **MISSING** |

---

### 3. Baseline Summary & Guard Gates
- **Zero regressions**: All 479 automated tests in `npm test` are green.
- **LinkedIn Module Realness**: 71 / 71 dedicated unit & integration tests pass cleanly.
- **Exploits Audit Baseline**: 32 / 32 security exploits verified NOT REPRODUCED.
- **Environment Status**: All LinkedIn production keys are currently MISSING. UI must honestly reflect unconfigured status in Stage 2 without dead clicks or fake success.

---

## Stage 1 — Wire LinkedIn into the Dashboard Nav (Phase-7 pattern)

### 1. Changes Implemented
- **Header Action Group (`#m360-header-marketing-actions`)**:
  - Added `#m360-header-linkedin-btn` (`💼 LinkedIn`) alongside WhatsApp, Email, Analytics, and Pilot.
  - Wired click event to navigate to Marketing page and trigger `window.Matrix360LinkedIn.open()`.
  - Updated both `workstreams/avinash/frontend/frontend-source/client-dashboard.html` and `workstreams/avinash/frontend-source/client-dashboard.html`.
- **Left Sidebar Navigation**:
  - Added `id="nav-linkedin"` (`LinkedIn`) to `<nav class="workspace-nav">` in both `client-dashboard.html` files.
  - Added `#m360-sidebar-linkedin` under `Marketing Engines` in `m360-nav-fix.js` (`enhanceLeftSidebar`).
  - Wired 1-click navigation to `navigateToPage('marketing')` and `window.Matrix360LinkedIn.open()`.
- **Feature Card in Marketing Tools (`#services`)**:
  - Added `LinkedIn Publishing` card to `function marketing()` in `m360-nav-fix.js` and `#services` in `client-dashboard.html`.
  - Wired card CTA link (`#services-linkedin-link`) to open LinkedIn workspace.
- **Back Navigation**:
  - Added `← Back to dashboard` (`#m360-li-back-btn`) to the top of `#m360-li-panel` in `m360-linkedin-client.browser.js`.
  - Wired to return to the Overview dashboard (`navigateToPage('dashboard')` or `#home`).
- **Orphan Status**: Zero orphaned LinkedIn surfaces.
- **Test Suite Updates**:
  - Updated `tests/m360-browser-e2e.test.js` to assert `#m360-header-linkedin-btn`, `#nav-linkedin`, and `#services-linkedin-link`.
  - All 6/6 tests in `m360-browser-e2e.test.js` passing.
  - All 71/71 LinkedIn tests passing.
  - All 32/32 audit harness checks passing.

---

## Stage 2 — Honest Keys-Missing States in the LinkedIn UI

### 1. Behavior Implementation
- **Missing Keys Banner (`#m360-li-banner`)**:
  - Derived dynamically from real service configuration (`oauth_ready`, `token_encryption_ready`, `missing_keys`).
  - When keys are missing (`!oauth_ready || !token_encryption_ready`):
    - Banner renders clearly: `Setup incomplete on server: Missing LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI, LINKEDIN_TOKEN_ENCRYPTION_KEY in environment. LinkedIn OAuth and secure token storage cannot launch until these variables are configured.`
    - Styled with accessible warning contrast (`background:#fff3cd; color:#856404; border:1px solid #ffeeba`).
- **Connect Button State**:
  - When setup is incomplete, the Connect button is rendered disabled with explicit text: `Setup not finished`.
  - Tooltip/title explicitly indicates the missing variables.
  - Clicking the disabled connect button prevents action and displays an honest notification, eliminating dead clicks or false "connected" states.
- **Worker Heartbeat Telemetry**:
  - When worker is active (`worker_ready: true`): displays `Publication worker is active and verified.`
  - When worker is offline (`worker_ready: false` with heartbeat): displays `⚠️ Publication worker is offline (last heartbeat: ...). Scheduled publications will not dispatch until the worker is restarted.`
  - When heartbeat is absent: displays `⚠️ Publication worker health has not been verified (worker offline).`
- **AI Drafting Configuration State**:
  - When `ai_ready: false`, `[data-li-action="prepare"]` and `[data-li-action="revise"]` are disabled with explanatory tooltips.
  - `#m360-li-ai-status` informs the user: `AI drafting needs configuration (OPENAI_API_KEY and M360_OPENAI_SPEND_APPROVED must be configured).`
  - Attempting AI preparation without configuration halts honestly with an explicit configuration error message.
- **Zero Fabrication**:
  - No fake connected accounts; shows `No LinkedIn account connected for this workspace.`

### 2. Browser Verification
- Executed `tests/linkedin-ui-browser.cjs` against headless Chrome with DevTools protocol.
- Verified DOM states for:
  - `unconfigured` workspace: banner visible, missing keys listed, connect button disabled with "Setup not finished", worker offline, AI controls disabled.
  - `stale-worker` workspace: honest offline status with timestamp.
  - `fixture-a` workspace: full flow (draft, preview, approval, scheduling, cancellation, attribution).

---

## Stage 3 — Browser E2E Pass of the LinkedIn Workspace

### 1. Changes Implemented
- **Campaign-Flow Handoff**:
  - In `lib/m360-marketing-client.browser.js`, wired `#m360-btn-open-linkedin-config` and `#m360-btn-open-linkedin-workspace` to extract `activeTask.channel_draft_versions.LinkedIn.versions.at(-1)` and pass `{ text: liDraft.body, title: activeTask.title, objective: activeTask.prompt }` directly into `window.Matrix360LinkedIn.open()`.
  - Added "Open in LinkedIn Workspace →" button (`#m360-btn-open-linkedin-workspace`) in the Marketing overview when viewing LinkedIn channel drafts.
- **Headless Chrome E2E Suite (`tests/linkedin-ui-browser.cjs` & `tests/m360-browser-e2e.test.js`)**:
  - Integrated `runBrowserPass()` into the main test suite under `Stage 3 E2E: LinkedIn workspace browser lifecycle`.
  - Asserted zero browser exceptions: `assert.deepEqual(errors, [])`.
  - Asserted campaign handoff: draft text populated into `#m360-li-text` and `#m360-li-composer.hidden === false`.
  - Verified guardrails ON (`fixture-a`): approval control and copyright attribution checkboxes visible and enforced.
  - Verified guardrails OFF (`fixture-b`, team-test mode): approval control is hidden (`approve.hidden === true`).
  - Dead button check: tested all primary buttons (`connect`, `prepare`, `revise`, `approve`, `queue`, `cancel`, `reset-workspace`, `back`). Every button either performs an asynchronous state change, opens a modal/drawer, or navigates back; zero dead buttons.
  - Verified responsive layouts across mobile (375px), tablet (768px), and desktop (1440px) with zero horizontal overflow.
  - Back to dashboard button (`#m360-li-back-btn`) returns cleanly to dashboard without errors.

### 2. Verification Outputs
```
✔ Stage 2 E2E: Main Dashboard serves with HTTP 200 and wires all marketing action buttons (21.7473ms)
✔ Stage 2 E2E: All 5 marketing subpages resolve with HTTP 200 and zero 404 errors (69.721ms)
✔ Stage 2 E2E: Every marketing subpage contains a functional Back to Dashboard navigation link (65.5879ms)
✔ Stage 2 E2E: Primary action buttons and API handlers exist on all 5 subpages (83.0203ms)
✔ Stage 2 E2E: Empty state telemetry renders honest zeros without simulated filler (13.1408ms)
✔ Stage 2 E2E: Unauthorized/unknown page requests return strict 404 (0.3948ms)
PASS: isolated Chrome fixture: AI draft, escaped preview, actual image Blob preview, save, approve, queue, cancel, workspace reset and optional guardrails off; 375/768/1440px no horizontal overflow; no runtime exceptions.
✔ Stage 3 E2E: LinkedIn workspace browser lifecycle (zero errors, guardrails on/off, primary buttons active, campaign handoff) (3370.0656ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
```
- Full test suite: 480/480 tests pass.
- LinkedIn test suite: 71/71 tests pass.
- Audit harness baseline: 32/32 checks pass (`NOT REPRODUCED`).

---

## Stage 4 — Extend the Audit Harness (All 32 Preserved + LI1–LI5 Added)

### 1. Checks Added to `tools/audit/exploits.js`
All checks execute real service, provider, store, and API code, with LinkedIn's network mocked strictly at the boundary:
- **LI1 (Publication Uncertainty & Honest Reconciliation)**:
  - When LinkedIn's REST API responds with HTTP 201 Created but omits the `x-restli-id` response header, real `createPost` throws `ProviderError('POST_ACK_UNKNOWN', ..., { uncertain: true })`.
  - The publication worker (`runOne()`) persists the uncertainty boundary before the HTTP call, catches the error, sets `job.status = 'unknown'`, records the error code, does NOT invent any post ID or URN, and does NOT blindly retry.
  - Calling `service.handle('reconcile', ...)` with the genuine provider URN (`urn:li:share:...`) verifies the author, commentary, and published lifecycle state, and transitions the job to `status: 'published'`, setting `job.provider_post_id` and recording `job.reconciled_by = ctx.actor`.
  - Reconciling with an invalid or mismatched post URN fails closed.
  - Status: `NOT REPRODUCED`.
- **LI2 (Guardrails & Approval Fingerprint Integrity)**:
  - With `LINKEDIN_SAFETY_GUARDRAILS=true`, scheduling an unapproved campaign fails immediately with `APPROVAL_REQUIRED` (HTTP 409).
  - Materially modifying an approved campaign invalidates its approval fingerprint; attempting to schedule with a stale revision fails `REVISION_CONFLICT` (HTTP 409), and scheduling with the current revision without re-approving fails `APPROVAL_REQUIRED` (HTTP 409).
  - With `LINKEDIN_SAFETY_GUARDRAILS=false` (team-test mode), scheduling proceeds directly (`job.review_required === false`), but the cryptographic approval fingerprint calculated from the draft still travels with the queued job.
  - Status: `NOT REPRODUCED`.
- **LI3 (Multi-Tenant Isolation & AAD Binding)**:
  - Tokens sealed for Workspace A use AES-256-GCM with Workspace A's identifier bound as Additional Authenticated Data (AAD).
  - Attempting to decrypt or use Workspace A's token in Workspace B triggers an authentication tag mismatch, failing with `TOKEN_UNAVAILABLE` (HTTP 503).
  - Workspace B querying campaigns, status, or connections receives strictly tenant B records; Workspace A's drafts, connections, and secrets remain completely invisible and unmodifiable.
  - Status: `NOT REPRODUCED`.
- **LI4 (Restricted Features Refusal & Honest Capabilities)**:
  - Invocations for restricted capabilities (`invitations`, `send_message`, `unattended_messages`, `auto_engagement`, `auto_comment`) via `service.handle()` or `/api/linkedin?op=...` return honest capability refusals (HTTP 404 `Unknown LinkedIn operation.`, error code `NOT_FOUND`).
  - The service capability block dynamically returned by `status()` strictly reports all restricted features as `false` (`invitations: false`, `unattended_messages: false`, `ads: false`, `lead_sync: false`).
  - Status: `NOT REPRODUCED`.
- **LI5 (Missing Encryption Key & Zero Hardcoded Fallbacks)**:
  - When `LINKEDIN_TOKEN_ENCRYPTION_KEY` is missing or invalid, `service.handle('connect')` and `/api/linkedin?op=connect` fail closed with `ENCRYPTION_NOT_CONFIGURED` (HTTP 503).
  - Static audit of all source files confirms zero hardcoded fallback key strings or default keys.
  - Status: `NOT REPRODUCED`.

### 2. Permanent Regression Tests
- Added `tests/linkedin-audit-exploits.test.js` turning LI1–LI5 into permanent integration tests.
- All 5/5 tests passing in `tests/linkedin-audit-exploits.test.js`.

### 3. Verification Outputs

#### Exploit Audit Harness Output (`node tools/audit/exploits.js`)
```
====================================================
Matrix360 Phase 2 Trust Rails Exploit Audit Baseline
====================================================
[E1] NOT REPRODUCED
[E2] NOT REPRODUCED
[W1] NOT REPRODUCED
[W2] NOT REPRODUCED
[C1] NOT REPRODUCED
[C2] NOT REPRODUCED
[V1] NOT REPRODUCED
[P1] NOT REPRODUCED
[P2] NOT REPRODUCED
[X1] NOT REPRODUCED
[S1] NOT REPRODUCED
[R1] NOT REPRODUCED
[M1] NOT REPRODUCED
[WG1] NOT REPRODUCED
[WG2] NOT REPRODUCED
[WG3] NOT REPRODUCED
[WG4] NOT REPRODUCED
[WG5] NOT REPRODUCED
[EM1] NOT REPRODUCED
[EM2] NOT REPRODUCED
[EM3] NOT REPRODUCED
[AI1] NOT REPRODUCED
[AI2] NOT REPRODUCED
[AI3] NOT REPRODUCED
[DASH1] NOT REPRODUCED
[DASH2] NOT REPRODUCED
[DASH3] NOT REPRODUCED
[PIL1] NOT REPRODUCED
[NAV1] NOT REPRODUCED
[FE1] NOT REPRODUCED
[PIPE1] NOT REPRODUCED
[HALL1] NOT REPRODUCED
[LI1] NOT REPRODUCED
[LI2] NOT REPRODUCED
[LI3] NOT REPRODUCED
[LI4] NOT REPRODUCED
[LI5] NOT REPRODUCED
====================================================
```
Total Checks: 37 / 37 `NOT REPRODUCED` (100% green).

#### LinkedIn Test Suite Output (`node --test tests/linkedin-*.test.js`)
```
ℹ tests 76
ℹ suites 0
ℹ pass 76
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1425.8419
```
Total LinkedIn Tests: 76 / 76 pass (100% green).

#### Full Test Suite (`npm test`)
```
ℹ tests 485
ℹ suites 14
ℹ pass 485
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 28044.7859
```
Total Test Suite: 485 / 485 pass across 14 test suites (100% green).

---

## Stage 5 — Guarded Live Smoke (Honest Skip & Administrator Action Sheet)

### 1. Honest Skip Explanation (Zero Fabrication)
- **Status**: **SKIPPED (HONEST PROTOCOL)**
- **Reason**: Baseline inventory (Stage 0) confirmed all production LinkedIn environment variables (`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`, `LINKEDIN_TOKEN_ENCRYPTION_KEY`) are **MISSING** from the runtime environment.
- **Strict Anti-Fabrication Guarantee**:
  - No synthetic or simulated LinkedIn API calls were performed against external endpoints.
  - No fake post identifiers, simulated URNs (e.g. `urn:li:share:...`), or invented public URLs were recorded.
  - The UI accurately renders honest unconfigured warnings (`#m360-li-banner`) with disabled connect buttons (`Setup not finished`), preventing dead clicks or false "connected" representations.
  - All automated behaviors, uncertainty boundaries, and edge cases are verified 100% through the real-executing audit harness (`LI1`–`LI5`) and browser E2E test suites with network mocked only at the boundary.

---

### 2. Administrator Action Sheet for Live Verification

To execute the live smoke test on a production or staging instance, the administrator must configure the following:

#### Required Environment Variables

| Variable Name | Purpose | Example / Format |
| :--- | :--- | :--- |
| `LINKEDIN_CLIENT_ID` | OAuth 2.0 Client ID from LinkedIn Developer Portal | `78xxxxxxxxxxxx` |
| `LINKEDIN_CLIENT_SECRET` | OAuth 2.0 Client Secret from Developer Portal | `WPL_AP1_xxxxxxxx` |
| `LINKEDIN_REDIRECT_URI` | Exact callback registered in LinkedIn App | `http://127.0.0.1:8000/client-dashboard.html?linkedin_callback=1` or `https://<domain>/client-dashboard.html?linkedin_callback=1` |
| `LINKEDIN_TOKEN_ENCRYPTION_KEY` | 32-byte Base64 key for AES-256-GCM token sealing with AAD | Generate via command below |
| `LINKEDIN_API_VERSION` | Version of LinkedIn REST API (YYYYMM format) | `202610` |
| `LINKEDIN_STORE_BACKEND` | Storage adapter backend | `sqlite` (local dev) or `supabase` (Vercel production) |
| `LINKEDIN_SAFETY_GUARDRAILS` | Enforce human approval gate & media copyright checks | `true` (production) or `false` (team-test mode) |
| `LINKEDIN_WORKER_SECRET` | Secret for authenticating the background worker endpoint | Generate via command below (32+ chars) |
| `OPENAI_API_KEY` | OpenAI API key for AI post drafting | `sk-proj-xxxxxxxx` |
| `M360_OPENAI_SPEND_APPROVED` | Explicit spend approval for model inference | `true` |

#### Key Generation Commands

To generate cryptographic keys for the environment, run:

```bash
# Generate LINKEDIN_TOKEN_ENCRYPTION_KEY (32 bytes Base64)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Generate LINKEDIN_WORKER_SECRET (32 bytes hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### Step-by-Step LinkedIn Developer App Setup

1. **Create Developer Application**:
   - Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps).
   - Click **Create App**.
   - Enter **App name** (e.g. `Matrix360`), associate your official **LinkedIn Page**, upload an app logo (square, min 100x100px), and enter your privacy policy URL.
2. **Request Necessary Products**:
   - In the **Products** tab:
     - Select and add **Sign In with LinkedIn using OpenID Connect** (provides `openid`, `profile`, `email`).
     - Select and add **Share on LinkedIn** or apply for **Community Management API** (provides `w_member_social`, `w_organization_social`, `r_member_social`).
3. **Configure Authentication & Redirects**:
   - In the **Auth** tab:
     - Copy the **Client ID** into `LINKEDIN_CLIENT_ID`.
     - Copy the **Client Secret** into `LINKEDIN_CLIENT_SECRET`.
     - In **Authorized redirect URLs for your app**, add:
       - Local Preview: `http://127.0.0.1:8000/client-dashboard.html?linkedin_callback=1`
       - Production: `https://YOUR-APP-DOMAIN/client-dashboard.html?linkedin_callback=1`
     - Set `LINKEDIN_REDIRECT_URI` to match the exact URL used.
4. **Configure Server & Worker**:
   - Save the environment variables into `.env.local` or host secret manager.
   - Start the web application: `npm start` (or `node tools/local-preview.cjs`).
   - Start the worker in a background task: `node tools/linkedin-worker.cjs`.
5. **Run Owner-Only Live Smoke**:
   - Sign in to Matrix360 as platform owner or client admin.
   - Navigate to the LinkedIn Workspace via the dashboard header (`💼 LinkedIn`) or left sidebar.
   - Click **Connect LinkedIn** to complete the standard OAuth consent screen.
   - Authorize scopes (`openid profile email w_member_social`).
   - Compose ONE text post: e.g. `"Matrix360 Phase 8 Live Verification Post"`.
   - Click **Schedule Publication** (or approve and schedule if guardrails are on).
   - The publication worker claims the job, uploads/dispatches the post via real LinkedIn REST API, and records the genuine provider URN (`urn:li:share:...`).
   - Verify the post appears on the owner's LinkedIn feed and read-back telemetry verifies `PUBLISHED` status.

---

### Follow-Up: AI Drafting, Revisions, & Company Grounding (Commit `56bf299`)
1. **Interactive In-UI AI API Key Connector**:
   - Added `#m360-li-ai-connector` widget in the LinkedIn campaign composer.
   - Provides live visual status: `● AI Drafting Ready (Connected)` or `⚠️ AI Key Required`.
   - Included inline API Key drawer allowing client admins to connect and verify their OpenAI API key with provider round-trip handshake.
   - Supported session-level persistence (`sessionStorage`) and backend persistence via `op=configure-ai` and `POST /api/marketing?action=ai/configure`.
2. **Company Grounding Without Flattery**:
   - Eliminated the hard 409 `BRAND_REQUIRED` failure when Supabase database brand table is empty.
   - Grounded generation in verified company details from CRM membership (`ctx.membership.name`) and explicit client brand facts.
   - Updated system prompt with strict anti-flattery directives: forbids generic sycophancy, buzzwords ("game-changer", "world-class excellence"), and unsubstantiated claims.
3. **Linked "Revise with AI"**:
   - Fully enabled and wired `data-li-action="revise"` to send existing post text + user revision instructions.
   - Surgical editing preserving verified company facts.
4. **Unified AI Touchpoints**:
   - Key configuration unblocks LinkedIn Composer (`prepare` / `revise`), Content Studio (`content-image` / `content-reel`), Control Center (`/api/control-center`), and Chat-to-Campaign (`/api/marketing?action=chat_to_campaign`).
5. **Verification**:
   - `tests/linkedin-ai-prepare.test.js` (5 / 5 pass).
   - `tests/linkedin-*.test.js` (81 / 81 pass).
   - `tests/m360-browser-e2e.test.js` (7 / 7 pass).
   - `tools/audit/exploits.js` (37 / 37 NOT REPRODUCED).
   - `npm test` (490 / 490 pass across 14 suites).






