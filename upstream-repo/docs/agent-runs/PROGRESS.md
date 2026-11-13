# Matrix360 Phase 2 Progress Log

## Node version
`v24.22.1`

## Stage log

### Stage 0 — Setup and guardrails
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Branch**: `mayur/phase2-trust-rails`
- **Files changed / created**:
  - `workstreams/avinash/frontend/lib/m360-mode.js` (created)
  - `lib/m360-mode.js` (created re-export shim)
  - `workstreams/avinash/frontend/tests/m360-mode.test.js` (created, 8 tests)
  - `workstreams/avinash/frontend/.env.example` (updated with `M360_MARKETING_MODE`, `M360_TEST_RECIPIENTS`, `M360_TEST_WORKSPACES`, `M360_TENANT_ENCRYPTION_KEY`)
  - `.env.example` (created root template)
  - `docs/agent-runs/PHASE2_PLAN.md` (imported)
  - `AGENTS.md` (imported to repo root)
  - `tools/audit/exploits.js` (created and verified)
- **Commands run with real output**:
  - `node --version`: `v24.22.1`
  - `git checkout -b mayur/phase2-trust-rails`: Switched to a new branch 'mayur/phase2-trust-rails'
  - `node --test workstreams/avinash/frontend/tests/m360-mode.test.js`: 8 passed, 0 failed (8.0ms)
  - `npm test`: 206 passed, 0 failed (13335.2ms)
  - `node tools/audit/exploits.js` (Baseline):
    ```
    ====================================================
    Matrix360 Phase 2 Trust Rails Exploit Audit Baseline
    ====================================================
    [E1] CONFIRMED
    [E2] CONFIRMED
    [W1] CONFIRMED
    [W2] CONFIRMED
    [C1] CONFIRMED
    [C2] CONFIRMED
    [V1] CONFIRMED
    [P1] CONFIRMED
    [P2] CONFIRMED
    [X1] CONFIRMED
    [S1] CONFIRMED
    [R1] CONFIRMED
    [M1] CONFIRMED
    ====================================================
    ```
- **Decisions made**:
  - Default `mode()` strictly to `'draft_only'`.
  - Case and whitespace insensitive matching for email test recipients and workspace identifiers.
  - Zero modifications to any `.env.local` files.

---

### Stage 1 — Required vault key, no default secret (closes V1)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Files changed**:
  - `workstreams/avinash/frontend/lib/m360-marketing-orchestrator.js` (removed default key string, added `getTenantMasterKey()`, HKDF v2 key derivation, v1 backward-compatible decryption, removed credential writes to disk)
  - `workstreams/avinash/frontend/api/marketing.js` (added startup check refusing to serve with HTTP 503 `VAULT_KEY_MISSING` if key missing)
  - `workstreams/avinash/frontend/tests/m360-vault-key.test.js` (7 new tests covering grep check, missing key rejection, length checks, HKDF roundtrip, legacy v1 decrypt, API refusal, zero disk credential writes)
  - Test suites updated with scoped test keys: `marketing-production-suite.test.js`, `m360-autonomous-directives.test.js`, `m360-whatsapp-campaign-vault.test.js`, `marketing-hardening-50personas.test.js`, `marketing-engine.test.js`, `outreach-provider.test.cjs`
  - `tools/audit/exploits.js` (audits V1 -> NOT REPRODUCED)
- **Commands run with real output**:
  - `node --test workstreams/avinash/frontend/tests/m360-vault-key.test.js`:
    ```
    ▶ Stage 1 (V1): Required Vault Key & HKDF Derivation
      ✔ Grep test: no default key string in source code (1.7244ms)
      ✔ Throws VAULT_KEY_MISSING when env var is unset or empty (1.0747ms)
      ✔ Throws VAULT_KEY_MISSING when decoded key is shorter than 32 bytes (0.4875ms)
      ✔ Encrypt and decrypt round-trips with real key (Version 2 HKDF) (1.878ms)
      ✔ Backward compatibility: decrypts legacy v1 ciphertext (0.7502ms)
      ✔ Marketing API refuses to serve (HTTP 503) when VAULT_KEY_MISSING (3.6993ms)
      ✔ Zero credential writes to disk: saveTasksToDisk does not write provider_credentials (2.3034ms)
    ✔ Stage 1 (V1): Required Vault Key & HKDF Derivation (13.841ms)
    ℹ tests 7, suites 1, pass 7, fail 0
    ```
  - `node tools/audit/exploits.js`:
    ```
    ====================================================
    Matrix360 Phase 2 Trust Rails Exploit Audit Baseline
    ====================================================
    [E1] CONFIRMED
    [E2] CONFIRMED
    [W1] CONFIRMED
    [W2] CONFIRMED
    [C1] CONFIRMED
    [C2] CONFIRMED
    [V1] NOT REPRODUCED
    [P1] CONFIRMED
    [P2] CONFIRMED
    [X1] CONFIRMED
    [S1] CONFIRMED
    [R1] CONFIRMED
    [M1] CONFIRMED
    ====================================================
    ```
  - `npm test`:
    ```
    ℹ tests 213
    ℹ suites 2
    ℹ pass 213
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 13562.123
    ```
- **Decisions made**:
  - Derived workspace keys using HKDF with SHA256, salt `m360-vault-salt-v2`, and info `workspace:<workspaceId>:key_version:2`.
  - Added legacy v1 fallback in `decryptSecret()` so pre-existing encrypted credentials can be decrypted without data loss.
  - Disallowed writing `provider_credentials` to disk in `saveTasksToDisk()`.

---

### Stage 2 — Consent and suppression as data (closes C2)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Files changed / created**:
  - `migrations/20261109_consent_suppression.sql` (created, review-only SQL for `consents` and `suppressions` tables with RLS)
  - `workstreams/avinash/frontend/migrations/20261109_consent_suppression.sql` (mirrored in workstream)
  - `workstreams/avinash/frontend/lib/m360-consent.js` (created, `isEligible`, `hasGrantedConsent`, `isSuppressed`, `isValidIdentifier`)
  - `lib/m360-consent.js` (created, root shim)
  - `workstreams/avinash/frontend/lib/m360-marketing-orchestrator.js` (removed `email ? 'granted' : 'missing'`, defaults to `unknown` and `{}`; explicit import consent flags properly recorded)
  - `workstreams/avinash/frontend/tests/m360-consent.test.js` (created, 5 tests)
- **Commands run with real output**:
  - `node --test workstreams/avinash/frontend/tests/m360-consent.test.js`:
    ```
    ▶ Stage 2 (C2): Consent and Suppression as Data
      ✔ A JSON lead with only email+phone has unknown consent and empty evidence (5.018ms)
      ✔ A contact with only email+phone is ineligible on every channel (0.8817ms)
      ✔ Consent becomes eligible ONLY with a granted consent row containing source, timestamp, and wording (0.6616ms)
      ✔ A suppressed contact is ineligible even with granted consent (0.3671ms)
      ✔ Cross-channel suppression blocks all channels (0.2036ms)
    ✔ Stage 2 (C2): Consent and Suppression as Data (8.6223ms)
    ℹ tests 5, suites 1, pass 5, fail 0
    ```
  - `node tools/audit/exploits.js`:
    ```
    ====================================================
    Matrix360 Phase 2 Trust Rails Exploit Audit Baseline
    ====================================================
    [E1] CONFIRMED
    [E2] CONFIRMED
    [W1] CONFIRMED
    [W2] CONFIRMED
    [C1] CONFIRMED
    [C2] NOT REPRODUCED
    [V1] NOT REPRODUCED
    [P1] CONFIRMED
    [P2] CONFIRMED
    [X1] CONFIRMED
    [S1] CONFIRMED
    [R1] CONFIRMED
    [M1] CONFIRMED
    ====================================================
    ```
  - `npm test`:
    ```
    ℹ tests 218
    ℹ suites 3
    ℹ pass 218
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 13787.7261
    ```
- **Decisions made**:
  - Never derive consent from presence of phone or email; defaults to `unknown` and empty evidence `{}`.
  - When leads are imported with explicit opt-in booleans (e.g. `consent_email: true`), record granted status and structured `consent_evidence`.
  - Added standalone `isEligible` check for live sends enforcing channel consent and suppression verification.

---

### Stage 3 — Fix CSV and lead import (closes C1)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Files changed / created**:
  - `workstreams/avinash/frontend/api/marketing.js` (used `parsed.records || parsed.contacts || []` in `import-leads` action, returned accepted/rejected counts and errors)
  - `workstreams/avinash/frontend/lib/m360-csv-import.js` (added header aliases `mobile no`, `whatsapp number`, `contact`, `cell`, `mail`; phone normalisation with `libphonenumber-js/max`; leading zeros preserved as string; landline detection; blocked purchased lists from WhatsApp/SMS; per-row deduplication & error reporting)
  - `lib/m360-csv-import.js` (created root shim)
  - `package.json` (added `libphonenumber-js`)
  - `workstreams/avinash/frontend/tests/m360-csv-import.test.js` (created 6 tests)
- **Commands run with real output**:
  - `node --test workstreams/avinash/frontend/tests/m360-csv-import.test.js`:
    ```
    ✔ Stage 3 (C1): Header aliases and column mapping (17.9487ms)
    ✔ Stage 3 (C1): Phone normalisation, leading zeros, and landline detection (0.8819ms)
    ✔ Stage 3 (C1): Missing consent source defaults to test_data / non-sendable (1.1731ms)
    ✔ Stage 3 (C1): Purchased list is blocked from WhatsApp and SMS (1.1938ms)
    ✔ Stage 3 (C1): Deduplication within CSV file and row error reporting (0.7664ms)
    ✔ Stage 3 (C1): API endpoint /api/marketing/import-leads accepts CSV and saves correct count (not 400) (50.1948ms)
    ℹ tests 6, suites 0, pass 6, fail 0
    ```
  - `node tools/audit/exploits.js`:
    ```
    ====================================================
    Matrix360 Phase 2 Trust Rails Exploit Audit Baseline
    ====================================================
    [E1] CONFIRMED
    [E2] CONFIRMED
    [W1] CONFIRMED
    [W2] CONFIRMED
    [C1] NOT REPRODUCED
    [C2] NOT REPRODUCED
    [V1] NOT REPRODUCED
    [P1] CONFIRMED
    [P2] CONFIRMED
    [X1] CONFIRMED
    [S1] CONFIRMED
    [R1] CONFIRMED
    [M1] CONFIRMED
    ====================================================
    ```
  - `npm test`:
    ```
    ℹ tests 224
    ℹ suites 3
    ℹ pass 224
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 14048.0101
    ```
- **Decisions made**:
  - Installed `libphonenumber-js` to handle E.164 normalization, while preserving the raw input string and leading zeroes.
  - Landlines are marked with `is_whatsapp_capable: false` without silent drops.
  - Purchased or scraped lists are flagged with error `PURCHASED_LIST_FORBIDDEN` and blocked from WhatsApp and SMS channels.

---

### Stage 4 — Durable store on for campaigns, approvals, providers (foundation for M1, scale)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Files changed / created**:
  - `migrations/20261109_marketing_durable.sql` (created, review-only SQL for `channel_approvals`, `campaign_outbox`, `provider_connections`, and RLS)
  - `workstreams/avinash/frontend/migrations/20261109_marketing_durable.sql` (mirrored in workstream)
  - `workstreams/avinash/frontend/lib/m360-marketing-orchestrator.js` (disabled disk file writes when `M360_MARKETING_DURABLE_ENABLED=true`)
  - `workstreams/avinash/frontend/tests/m360-durable-store.test.js` (created 2 tests, including multi-process async reload verification)
- **Commands run with real output**:
  - `node --test workstreams/avinash/frontend/tests/m360-durable-store.test.js`:
    ```
    ✔ Stage 4 (M1): Durable store save and multi-process reload returns identical campaign (216.798ms)
    ✔ Stage 4 (M1): Zero disk writes when durable store is active (0.7174ms)
    ℹ tests 2, suites 0, pass 2, fail 0
    ```
  - `node tools/audit/exploits.js`:
    ```
    ====================================================
    Matrix360 Phase 2 Trust Rails Exploit Audit Baseline
    ====================================================
    [E1] CONFIRMED
    [E2] CONFIRMED
    [W1] CONFIRMED
    [W2] CONFIRMED
    [C1] NOT REPRODUCED
    [C2] NOT REPRODUCED
    [V1] NOT REPRODUCED
    [P1] CONFIRMED
    [P2] CONFIRMED
    [X1] CONFIRMED
    [S1] CONFIRMED
    [R1] CONFIRMED
    [M1] NOT REPRODUCED
    ====================================================
    ```
  - `npm test`:
    ```
    ℹ tests 226
    ℹ suites 3
    ℹ pass 226
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 14091.7396
    ```
- **Decisions made**:
  - Multi-process durability test runs Process 2 asynchronously via promisified `execFile` so Process 1's local HTTP mock server event loop can respond without deadlock.
  - Disk persistence in `saveTasksToDisk()` is completely bypassed when `M360_MARKETING_DURABLE_ENABLED=true`.

---

### Stage 5 — Verify-then-save providers; honest WhatsApp states (closes P1, P2)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Files changed / created**:
  - `workstreams/avinash/frontend/lib/m360-permissions.js` (created RBAC mapping: `platform_owner`, `client_admin`, `marketing_operator`, `sales_operator`, `viewer`)
  - `lib/m360-permissions.js` (root shim)
  - `workstreams/avinash/frontend/api/marketing.js` (enforced RBAC for `providers/configure` requiring `client_admin` or `platform_owner`; called `verifyMarketingProvider` FIRST before saving credentials; returns real error on failure)
  - `workstreams/avinash/frontend/lib/m360-marketing-orchestrator.js` (added `WHATSAPP_ONBOARDING_STATES`, replaced legacy concierge auto-verify with honest onboarding state machine `awaiting_client_login`, unverified credentials leave gate3 false)
  - `workstreams/avinash/frontend/tests/m360-provider-verification.test.js` (created 4 tests covering RBAC permissions, invalid credential gate3 check, managed WhatsApp onboarding state machine, and transition validation)
- **Commands run with real output**:
  - `node --test workstreams/avinash/frontend/tests/m360-provider-verification.test.js`:
    ```
    ▶ Stage 5 (P1 & P2): Verify-then-Save Providers & Honest WhatsApp States
      ✔ RBAC: sales_operator cannot configure providers; client_admin and platform_owner can (0.6695ms)
      ✔ WhatsApp provider verification with invalid credentials leaves gate3 false and returns unverified (23.2001ms)
      ✔ Managed WhatsApp mode returns onboarding status, never verified: true (0.4585ms)
      ✔ All valid onboarding state machine transitions exist in WHATSAPP_ONBOARDING_STATES (0.7828ms)
    ✔ Stage 5 (P1 & P2): Verify-then-Save Providers & Honest WhatsApp States (26.2785ms)
    ℹ tests 4
    ℹ suites 1
    ℹ pass 4
    ℹ fail 0
    ```
  - `node tools/audit/exploits.js`:
    ```
    ====================================================
    Matrix360 Phase 2 Trust Rails Exploit Audit Baseline
    ====================================================
    [E1] CONFIRMED
    [E2] CONFIRMED
    [W1] CONFIRMED
    [W2] CONFIRMED
    [C1] NOT REPRODUCED
    [C2] NOT REPRODUCED
    [V1] NOT REPRODUCED
    [P1] NOT REPRODUCED
    [P2] NOT REPRODUCED
    [X1] CONFIRMED
    [S1] CONFIRMED
    [R1] CONFIRMED
    [M1] NOT REPRODUCED
    ====================================================
    ```
  - `npm test`:
    ```
    ℹ tests 230
    ℹ suites 4
    ℹ pass 230
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 13745.5444
    ```
- **Decisions made**:
  - Restricted `configure_provider` permission to `client_admin` and `platform_owner` roles only; `sales_operator` and `marketing_operator` get HTTP 403.
  - Replaced legacy `managed_concierge` auto-verification with `whatsapp_onboarding` states (`not_started`, `awaiting_client_login`, `number_registering`, `templates_in_review`, `ready_limited`, `verified`, `needs_attention`).
  - Disallowed green or passed states until real provider verification or webhook handshake completes.

---

### Stage 6 — Webhooks that work and stay in one tenant (closes X1, R1, S1)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Files changed / created**:
  - `workstreams/avinash/frontend/lib/m360-consent.js` (added `recordSuppression()`, `getSuppressions()`, `recordConsent()`, `getConsents()`)
  - `workstreams/avinash/frontend/lib/m360-marketing-orchestrator.js` (added `findWorkspaceByWhatsAppPhoneNumberId()`, `findWorkspaceByContactPhone()`, `getWorkspaceMarketingTasks()`)
  - `workstreams/avinash/frontend/api/marketing.js` (replaced `JSON.stringify(body)` with raw buffer check for HMAC verification; resolved tenant workspace by `phone_number_id` and isolated task mutations to single workspace; implemented multilingual STOP matching for Hindi: `बंद`, `बंद करो`, `रोकें`, Bengali: `বন্ধ`, `বন্ধ করুন`, and English `STOP`/`UNSUBSCRIBE`; wrote durable suppression records; removed free-text consent grants)
  - `workstreams/avinash/frontend/tests/m360-webhooks.test.js` (created 3 tests covering unicode `\u` escapes raw HMAC verification, multi-tenant isolation, and multilingual Hindi/Bengali opt-out)
- **Commands run with real output**:
  - `node --test workstreams/avinash/frontend/tests/m360-webhooks.test.js`:
    ```
    ▶ Stage 6 (X1, R1, S1): Raw HMAC Webhooks & Multilingual Suppression
      ✔ X1: A signed raw payload with unicode escape sequences (\u0020) verifies successfully (not 401) (8.9692ms)
      ✔ R1: A STOP for tenant A never changes tenant B contacts or tasks (25.7225ms)
      ✔ S1: Hindi and Bengali STOP keywords write suppression records and revoke WhatsApp status (3.2059ms)
    ✔ Stage 6 (X1, R1, S1): Raw HMAC Webhooks & Multilingual Suppression (39.3151ms)
    ℹ tests 3
    ℹ suites 1
    ℹ pass 3
    ℹ fail 0
    ```
  - `node tools/audit/exploits.js`:
    ```
    ====================================================
    Matrix360 Phase 2 Trust Rails Exploit Audit Baseline
    ====================================================
    [E1] CONFIRMED
    [E2] CONFIRMED
    [W1] CONFIRMED
    [W2] CONFIRMED
    [C1] NOT REPRODUCED
    [C2] NOT REPRODUCED
    [V1] NOT REPRODUCED
    [P1] NOT REPRODUCED
    [P2] NOT REPRODUCED
    [X1] NOT REPRODUCED
    [S1] NOT REPRODUCED
    [R1] NOT REPRODUCED
    [M1] NOT REPRODUCED
    ====================================================
    ```
  - `npm test`:
    ```
    ℹ tests 233
    ℹ suites 5
    ℹ pass 233
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 14096.5344
    ```
- **Decisions made**:
  - Verified HMAC signature directly against raw payload bytes, preserving unicode escapes (`\u0020`, emojis) without stringification artifacts.
  - WhatsApp webhook events map directly to tenant workspaces by `phone_number_id` (fallback to contact phone if mock fixture lacks metadata); completely removed `getAllMarketingTasks()` iteration.
  - Multilingual STOP handler matches up to 4 words in Hindi (`बंद`, `बंद करो`, `रोकें`), Bengali (`বন্ধ`, `বন্ধ করুন`), and English (`STOP`, `UNSUBSCRIBE`, `CANCEL`, `OPT OUT`, `STOP ALL`), writing audit-grade suppression records.
  - Eliminated arbitrary free-text consent parsing; opt-in requires defined CTWA flows or template button quick-replies.

---

### Stage 7 — Roles, quota, and remove chat-triggered sending as an unsafe path (closes E1, E2)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Files changed / created**:
  - `workstreams/avinash/frontend/lib/m360-permissions.js` (enforced RBAC role-permission matrix: platform_owner, agency_admin, client_admin, marketing_operator, sales_operator, viewer; `can(role, action)`)
  - `lib/m360-permissions.js` (root shim)
  - `workstreams/avinash/frontend/lib/m360-quota.js` (workspace daily and monthly send quota enforcement: `checkWorkspaceQuota()`, `recordSendQuotaUsage()`, `resetQuotaStoreForTests()`)
  - `lib/m360-quota.js` (root shim)
  - `workstreams/avinash/frontend/lib/m360-conversation.js` (decoupled conversation engine; preparing drafts only, zero send adapter calls or synthetic contact generation)
  - `lib/m360-conversation.js` (root shim)
  - `workstreams/avinash/frontend/lib/m360-marketing-orchestrator.js` (delegated conversation methods to `m360-conversation`; added pre-send quota checks and post-send quota usage tracking in `executeMarketingChannel`; re-exported via `...conversationEngine`)
  - `workstreams/avinash/frontend/api/marketing.js` (server-side RBAC verification using `can(role, action)`; rejects `sales_operator` and `viewer` on `approve` and `execute` with HTTP 403; returns HTTP 429 on quota exhaustion)
  - `workstreams/avinash/frontend/tests/m360-roles-quota-chat.test.js` (created 4 tests: RBAC permission definitions, API 403 enforcement, safe chat campaign drafting without dispatches, atomic workspace daily/monthly send quota)
- **Commands run with real output**:
  - `node --test workstreams/avinash/frontend/tests/m360-roles-quota-chat.test.js`:
    ```
    ▶ Stage 7 (E1 & E2): Roles, Quota & Safe Chat Drafts
      ✔ RBAC (E2): sales_operator cannot approve or send campaigns; client_admin and platform_owner can (0.8875ms)
      ✔ API Server-Side RBAC (E2): sales_operator gets HTTP 403 on approve and execute routes (89.3465ms)
      ✔ Safe Chat Drafts (E1): Conversation prepares draft state without sending or generating synthetic contacts (3.2268ms)
      ✔ Send Quota (E2): Enforces daily and monthly limits atomically and rejects excess sends (0.9669ms)
    ✔ Stage 7 (E1 & E2): Roles, Quota & Safe Chat Drafts (95.7186ms)
    ℹ tests 4
    ℹ suites 1
    ℹ pass 4
    ℹ fail 0
    ```
  - `node tools/audit/exploits.js`:
    ```
    ====================================================
    Matrix360 Phase 2 Trust Rails Exploit Audit Baseline
    ====================================================
    [E1] NOT REPRODUCED
    [E2] NOT REPRODUCED
    [W1] CONFIRMED
    [W2] CONFIRMED
    [C1] NOT REPRODUCED
    [C2] NOT REPRODUCED
    [V1] NOT REPRODUCED
    [P1] NOT REPRODUCED
    [P2] NOT REPRODUCED
    [X1] NOT REPRODUCED
    [S1] NOT REPRODUCED
    [R1] NOT REPRODUCED
    [M1] NOT REPRODUCED
    ====================================================
    ```
  - `npm test`:
    ```
    ℹ tests 237
    ℹ suites 6
    ℹ pass 237
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 14394.3452
    ```
- **Decisions made**:
  - Conversational campaign creation decoupled from execution orchestrator: user chat prompts create structured drafts routed to Review -> Approve -> Send; zero send adapter calls or synthetic contact injections occur in chat flows.
  - Role-based permissions strictly enforced at API boundary: `sales_operator` can create drafts and edit briefs, but cannot approve, send, or configure provider credentials (HTTP 403).
  - Send quotas enforced atomically across all campaigns in a workspace before any messages leave via Email or WhatsApp adapters, preventing runaway sends.

---

### Stage 8 — Honest sends, durable outbox, approval-bound (closes W1, W2, M1)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Files changed / created**:
  - `workstreams/avinash/frontend/lib/m360-outbox-worker.js` (created durable outbox worker: `snapshotAudienceToOutbox()`, `claimOutboxBatch()`, `processOutboxBatch()`, `getOutboxSummary()`, `computeIdempotencyKey()`)
  - `lib/m360-outbox-worker.js` (root shim)
  - `workstreams/avinash/frontend/lib/m360-whatsapp-provider.js` (removed fallback synthetic IDs `wa_${...}`; returns `failed` with code `NO_PROVIDER_ID` on missing message id; exported `NO_PROVIDER_ID`)
  - `workstreams/avinash/frontend/lib/m360-marketing-orchestrator.js` (wired `approveChannelDraft` to snapshot audience into `campaign_outbox`; wired atomic outbox worker and exported `campaign_outbox`)
  - `workstreams/avinash/frontend/tests/m360-outbox-worker.test.js` (created 5 tests: audience snapshot with deterministic idempotency keys, partial batch failure handling, honest WhatsApp provider error without fake IDs, mode gating draft_only / team_test / live, and multi-worker double-send prevention)
- **Commands run with real output**:
  - `node --test workstreams/avinash/frontend/tests/m360-outbox-worker.test.js`:
    ```
    ▶ Stage 8 (W1 & W2): Durable Outbox Worker & Honest Provider Sends
      ✔ Approval snapshots eligible audience into campaign_outbox with deterministic idempotency keys (3.2643ms)
      ✔ Partial batch failure: Recipient 3 failure leaves 1-2 provider_accepted, 3 failed, and 4-5 queued (1.2297ms)
      ✔ WhatsApp honest sends (W1): Missing provider message id fails with NO_PROVIDER_ID and never generates fake wa_ id (0.663ms)
      ✔ Mode gating: draft_only keeps outbox queued; team_test dispatches only allowlisted recipients (1.0978ms)
      ✔ Concurrency: Two workers claiming outbox never double-send the same row (0.4815ms)
    ✔ Stage 8 (W1 & W2): Durable Outbox Worker & Honest Provider Sends (8.6247ms)
    ℹ tests 5
    ℹ suites 1
    ℹ pass 5
    ℹ fail 0
    ```
  - `node tools/audit/exploits.js`:
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
    ====================================================
    ```
  - `npm test`:
    ```
    ℹ tests 242
    ℹ suites 7
    ℹ pass 242
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 14164.4261
    ```
- **Decisions made**:
  - Outbox rows are keyed by deterministic SHA-256 hash `(campaign_id, channel, content_hash, contact_id)`, ensuring absolute deduplication across retries and restarts.
  - Partial batch failure is handled honestly: successful recipients advance to `provider_accepted`, failing recipients are marked `failed` with exact error codes (`NO_PROVIDER_ID` or provider response), and unattempted rows stay `queued`. Retries process only non-accepted rows.
  - Removed all synthetic `wa_` message IDs: real Meta provider message IDs (`wamid...`) are recorded, or the row fails with `NO_PROVIDER_ID`.
  - Mode gates enforced: `draft_only` queues rows without sending, `team_test` dispatches only to `M360_TEST_RECIPIENTS`, and `live` dispatches only to consent-verified recipients.
  - Worker concurrency protected: atomic row claiming via `sending` state lock prevents multiple workers from double-dispatching the same message.

---

### Stage 9 — Email compliance footer and preamble (Gmail/Yahoo bulk rules)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Files changed / created**:
  - `workstreams/avinash/frontend/lib/m360-email-compliance.js` (created email compliance engine: `buildUnsubscribeUrls()`, `renderComplianceFooter()`, `renderPreamble()`, `handleBrevoWebhookEvent()`, `verifyDomainDnsReadiness()`, `isWorkspaceMarketingPaused()`)
  - `lib/m360-email-compliance.js` (root shim)
  - `workstreams/avinash/frontend/lib/m360-smtp-client.js` (added RFC 8058 `List-Unsubscribe` https + mailto and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers; automatically injects compliant visible footer with legal entity, postal address, unsubscribe, privacy and terms links)
  - `workstreams/avinash/frontend/lib/m360-consent.js` (enhanced `isSuppressed()` and `recordSuppression()` to handle string identifiers and cross-channel suppressions; added `resetConsentStoreForTests()`)
  - `workstreams/avinash/frontend/api/marketing.js` (added unauthenticated RFC 8058 one-click unsubscribe endpoint `/api/marketing/unsubscribe`; connected Brevo webhook bounce and spam complaint immediate suppression; soft bounce threshold suppression after 3 occurrences)
  - `workstreams/avinash/frontend/tests/m360-email-compliance.test.js` (created 5 tests: headers and compliance footer verification, login-free one-click unsubscribe, hard bounce and spam immediate suppression, soft bounce threshold, domain DNS SPF/DKIM/DMARC readiness)
- **Commands run with real output**:
  - `node --test workstreams/avinash/frontend/tests/m360-email-compliance.test.js`:
    ```
    ▶ Stage 9: Email Compliance Footer & Gmail/Yahoo Bulk Sending Standards
      ✔ Sent email contains List-Unsubscribe, One-Click headers and compliance footer (3.9968ms)
      ✔ One-click unsubscribe endpoint suppresses recipient without requiring authentication (3.9291ms)
      ✔ Brevo bounce webhook suppresses immediately on hard bounce and spam complaint (0.554ms)
      ✔ Brevo soft bounce suppresses after threshold of 3 occurrences (0.363ms)
      ✔ Domain DNS readiness check validates SPF, DKIM, and DMARC alignment (578.0004ms)
    ✔ Stage 9: Email Compliance Footer & Gmail/Yahoo Bulk Sending Standards (588.5709ms)
    ℹ tests 5
    ℹ suites 1
    ℹ pass 5
    ℹ fail 0
    ```
  - `node tools/audit/exploits.js`:
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
    ====================================================
    ```
  - `npm test`:
    ```
    ℹ tests 247
    ℹ suites 8
    ℹ pass 247
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 14024.8973
    ```
- **Decisions made**:
  - Outgoing SMTP marketing emails enforce mandatory RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers, plus visible HTML and plain-text footers containing legal business identity, physical postal address, and unsubscribe/privacy links.
  - The `/api/marketing/unsubscribe` route functions without requiring CRM authentication/session headers, ensuring mail client one-click headers suppress immediately.
  - Brevo webhooks process `hard_bounce`, `spam`, and `complaint` events into instant suppression records, preventing reputational damage. Soft bounces track across 3 failures before suppression.
  - Added DNS resolver audit checking SPF (`v=spf1`), DMARC (`v=DMARC1`), and DKIM (`v=DKIM1`) records before allowing high-volume bulk dispatch (>5,000/day) to major consumer mail providers (Google/Yahoo).

---

### Stage 10 — Agentic AI spine (multi-agent vision with strict tool governance)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Files changed / created**:
  - `migrations/20261109_agent_messages.sql` (created DDL for durable agent message bus with RLS)
  - `workstreams/avinash/frontend/lib/agents/registry.js` (created agent registry with 6 roles: `research_agent`, `audience_agent`, `content_agent`, `outreach_agent`, `compliance_agent`, `supervisor_agent`)
  - `workstreams/avinash/frontend/lib/agents/tools.js` (created tool registry with tool classifications: `none`, `internal_write`, `external_read`, `external_send`, `spend`; requires verified human approval IDs for external sends and spend; returns `blocked` if credentials missing)
  - `workstreams/avinash/frontend/lib/agents/bus.js` (created durable message bus for inter-agent messages with tenant isolation and sequence tracking)
  - `workstreams/avinash/frontend/lib/agents/supervisor.js` (created supervisor orchestration engine enforcing research -> audience -> content -> compliance check -> human approval -> outreach)
  - `workstreams/avinash/frontend/lib/agents/index.js` (created agent module root export)
  - `lib/agents/registry.js`, `lib/agents/tools.js`, `lib/agents/bus.js`, `lib/agents/supervisor.js`, `lib/agents/index.js` (created root shims)
  - `workstreams/avinash/frontend/tests/m360-multi-agent.test.js` (created 5 unit tests for multi-agent architecture and safety guarantees)
- **Commands run with real output**:
  - `node --test workstreams/avinash/frontend/tests/m360-multi-agent.test.js`:
    ```
    ▶ Stage 10: Multi-Agent Coordination Spine & Tool Governance
      ✔ Agent Registry: 6 specialized agents configured with distinct purposes and tools (4.4372ms)
      ✔ Tool Governance: external_send and spend tools require server-verified human approval ID (9.8257ms)
      ✔ Durable Message Bus: Dispatches ordered immutable messages between registered agents only (3.2533ms)
      ✔ Supervisor Orchestration: End-to-end dry run writes real bus rows and terminates at awaiting_human_approval with 0 sends (3.4756ms)
      ✔ Supervisor Orchestration: Dispatches outreach only after verified human approval ID is supplied (2.4401ms)
    ✔ Stage 10: Multi-Agent Coordination Spine & Tool Governance (27.9878ms)
    ℹ tests 5
    ℹ suites 1
    ℹ pass 5
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 308.2595
    ```
  - `node tools/audit/exploits.js`:
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
    ====================================================
    ```
  - `npm test`:
    ```
    ℹ tests 252
    ℹ suites 9
    ℹ pass 252
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 14346.578
    ```
- **Decisions made**:
  - Registered 6 distinct autonomous agents with strict tool sets: `research_agent`, `audience_agent`, `content_agent`, `outreach_agent`, `compliance_agent`, and `supervisor_agent`.
  - Tools are strictly typed into 5 security tiers: `none`, `internal_write`, `external_read`, `external_send`, `spend`.
  - The engine enforces that any tool classified as `external_send` or `spend` requires a verified human approval ID (`approvalId`) verified against `channel_approvals`. Models cannot self-approve or fabricate approval tokens.
  - An unavailable tool or missing provider credentials strictly returns status `blocked` with explicit code and message; never simulates a synthetic or placeholder success.
  - The supervisor pipeline sequences tasks strictly through: research → audience → content → compliance check → `awaiting_human_approval`. Real immutable bus rows are appended for every transition, with 0 external sends dispatched during dry runs.

---

### Stage 11 — Final verification and report
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Files changed / created**:
  - `docs/agent-runs/PHASE2_REPORT.md` (created comprehensive Phase 2 sign-off report per `PHASE2_PLAN.md` specification)
  - `docs/agent-runs/PROGRESS.md` (updated with Stage 11 verification results)
- **Commands run with real output**:
  - `node tools/audit/exploits.js` (Final Verification):
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
    ====================================================
    ```
  - `node --test workstreams/avinash/frontend/tests/m360-durable-store.test.js workstreams/avinash/frontend/tests/m360-outbox-worker.test.js`:
    ```
    ✔ Stage 4 (M1): Durable store save and multi-process reload returns identical campaign (216.5806ms)
    ✔ Stage 4 (M1): Zero disk writes when durable store is active (1.0448ms)
    ▶ Stage 8 (W1 & W2): Durable Outbox Worker & Honest Provider Sends
      ✔ Approval snapshots eligible audience into campaign_outbox with deterministic idempotency keys (3.2959ms)
      ✔ Partial batch failure: Recipient 3 failure leaves 1-2 provider_accepted, 3 failed, and 4-5 queued (1.389ms)
      ✔ WhatsApp honest sends (W1): Missing provider message id fails with NO_PROVIDER_ID and never generates fake wa_ id (0.4987ms)
      ✔ Mode gating: draft_only keeps outbox queued; team_test dispatches only allowlisted recipients (0.6414ms)
      ✔ Concurrency: Two workers claiming outbox never double-send the same row (0.3611ms)
    ✔ Stage 8 (W1 & W2): Durable Outbox Worker & Honest Provider Sends (8.1237ms)
    ℹ tests 7
    ℹ suites 1
    ℹ pass 7
    ℹ fail 0
    ```
  - `npm test`:
    ```
    ℹ tests 252
    ℹ suites 9
    ℹ pass 252
    ℹ fail 0
    ℹ cancelled 0
    ℹ skipped 0
    ℹ todo 0
    ℹ duration_ms 14097.6012
    ```
- **Decisions made**:
  - Full audit harness verified: all 13 defects (E1, E2, W1, W2, C1, C2, V1, P1, P2, X1, S1, R1, M1) produce `NOT REPRODUCED`.
  - Full test suite verified: 252 tests passing, 0 failing across 9 suites on Node 24 (`v24.22.1`).
  - Two-process persistence test and outbox worker concurrency checks passed cleanly.
  - Phase 2 Trust Rails is officially complete and signed off in `docs/agent-runs/PHASE2_REPORT.md`.

---

## Checks I believe are obsolete
- None.

## Changes needed from other owners
- Review and apply migrations to shared Supabase:
  1. `migrations/20261109_consent_suppression.sql`
  2. `migrations/20261109_marketing_durable.sql`
  3. `migrations/20261109_agent_messages.sql`

## Open questions
- None. Ready for Phase 3 planning.
