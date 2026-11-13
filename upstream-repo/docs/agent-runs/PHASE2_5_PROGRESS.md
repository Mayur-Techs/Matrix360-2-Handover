# Matrix360 Phase 2.5 Progress Log — Correction & Honest Re-Verification

## Node version
`v24.22.1`

## Branch
`mayur/phase2_5-correction`

---

## Starting state (Stage 0 Sentinel Grep)

### Commands executed
```bash
cd workstreams/avinash/frontend
node --version
grep -n "knownIdentities\|9198300\|wa_\${randomUUID\|0.80/conversation\|direct_user_prompt_instruction\|crm_opt_in_verified" api/marketing.js lib/m360-marketing-orchestrator.js
```

### Raw Output
```
v24.22.1
api/marketing.js:788:                const knownIdentities = {
api/marketing.js:795:                  const known = knownIdentities[email];
api/marketing.js:818:                    consent_evidence: 'direct_user_prompt_instruction',
api/marketing.js:961:                    phone: `9198300${num}`,
api/marketing.js:966:                    consent_evidence: { whatsapp: true, source: 'crm_opt_in_verified' }
api/marketing.js:1034:                `• **Estimated Meta API Cost:** ₹0.80/conversation (Total: ₹${costInr} / ~$${costUsd} USD)`,
lib/m360-marketing-orchestrator.js:1890:      const messageId = ack?.provider_message_id || `wa_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
```

---

## Stage log

### Stage 0 — Prove the current state (no code changes yet)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Branch**: `mayur/phase2_5-correction`
- **Files created**: `docs/agent-runs/PHASE2_5_PROGRESS.md`
- **Product code edits**: None (as strictly instructed).
- **Sentinel Grep Output**:
  - `api/marketing.js:788`: Hardcoded `knownIdentities` dictionary with personal emails.
  - `api/marketing.js:795`: Reference to `knownIdentities`.
  - `api/marketing.js:818`: Fabricated consent evidence `direct_user_prompt_instruction`.
  - `api/marketing.js:961`: Synthetic phone generator `9198300${num}`.
  - `api/marketing.js:966`: Fabricated consent evidence `crm_opt_in_verified`.
  - `api/marketing.js:1034`: Fabricated Meta API Cost `₹0.80/conversation`.
  - `lib/m360-marketing-orchestrator.js:1890`: Fallback message ID synthesis `wa_${randomUUID()...}`.
- **Commit**: `3bfcb02`

---

### Stage 1 — Remove chat auto-send and all invented data (closes E1, W1 for real)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Branch**: `mayur/phase2_5-correction`
- **Files changed / created**:
  - `workstreams/avinash/frontend/lib/m360-rates.js` (created channel cost estimator: marketing WhatsApp `0.8631` INR + 18% GST, utility `0.1150`, email `0.01`, SMS `0.15`)
  - `lib/m360-rates.js` (root shim)
  - `workstreams/avinash/frontend/api/marketing.js` (completely deleted 428-line autonomous directive block: removed `knownIdentities`, synthetic email/phone generators `lead-prompt-*` and `9198300*`, `direct_user_prompt_instruction`, `crm_opt_in_verified`, `shree-heights-brochure.pdf` fallback, hardcoded `₹0.80/conversation`, and all calls to `importLeadsToTask`, `approveChannelDraft`, and `executeMarketingChannel`; replaced with safe draft-only response returning `conversation.status = 'ready_for_review'`, real CRM audience counts, and rates-table cost preview)
  - `workstreams/avinash/frontend/tests/m360-roles-quota-chat.test.js` (updated Safe Chat Drafts E1 test to execute real HTTP handler `/api/marketing/conversations` and assert 0 send adapter calls, 0 synthetic contacts, status `ready_for_review`, drafts `draft_for_review`)
  - `workstreams/avinash/frontend/tests/m360-autonomous-directives.test.js` (updated suite to assert safe draft-only contract instead of legacy auto-send expectations)
  - `workstreams/avinash/frontend/tests/m360-whatsapp-campaign-vault.test.js` (updated test to assert `ready_for_review` and real target audience summary)
- **Commands run with real output**:
  - `grep -n -F -e "knownIdentities" -e "9198300" -e "direct_user_prompt_instruction" -e "crm_opt_in_verified" -e "0.80/conversation" api/marketing.js`:
    ```
    (Exit code 1, 0 matches - all completely removed from api/marketing.js)
    ```
  - Sentinel grep across both files:
    ```
    lib/m360-marketing-orchestrator.js:1890:      const messageId = ack?.provider_message_id || `wa_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    ```
  - `node --test workstreams/avinash/frontend/tests/m360-roles-quota-chat.test.js`:
    ```
    ▶ Stage 7 (E1 & E2): Roles, Quota & Safe Chat Drafts
      ✔ RBAC (E2): sales_operator cannot approve or send campaigns; client_admin and platform_owner can (0.9511ms)
      ✔ API Server-Side RBAC (E2): sales_operator gets HTTP 403 on approve and execute routes (91.1011ms)
      ✔ Safe Chat Drafts (E1): Conversation prepares draft state without sending or generating synthetic contacts (32.0865ms)
      ✔ Send Quota (E2): Enforces daily and monthly limits atomically and rejects excess sends (0.9144ms)
    ✔ Stage 7 (E1 & E2): Roles, Quota & Safe Chat Drafts (126.4061ms)
    ℹ tests 4
    ℹ suites 1
    ℹ pass 4
    ℹ fail 0
    ```
  - `npm test`:
    ```
    ℹ tests 252
    ℹ suites 9
    ℹ pass 252
    ℹ fail 0
    ℹ duration_ms 14261.4217
    ```
- **Decisions made**:
  - `api/marketing.js` conversations endpoint strictly operates in draft-only mode. It decomposes requests into handover envelopes, waits for draft preparation via `dispatchMarketingTask(envelope, { waitForDraft: true })`, appends a single structured assistant message containing the one-line confirmation, real audience summary (counts only), and cost preview, and sets `conversation.status = 'ready_for_review'`.
  - Zero calls to `approveChannelDraft`, `executeMarketingChannel`, or `importLeadsToTask` occur in the conversation workflow.
  - Eliminated all hardcoded personal email addresses (`knownIdentities`), synthetic phone number generation, and fallback brochure URLs.

---

### Stage 2 — Never fabricate a provider receipt (closes W2 for real)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Branch**: `mayur/phase2_5-correction`
- **Files changed / created**:
  - `workstreams/avinash/frontend/lib/m360-marketing-orchestrator.js` (Email and WhatsApp live-send branches updated: eliminated all synthetic ID generation `wa_${randomUUID...}`; if provider acknowledgment lacks a genuine `provider_message_id`, record execution as `status: 'failed'`, `provider_message_id: null`, `last_error: 'NO_PROVIDER_ID'`; only record quota for `acceptedCount`; return honest status `failed` or `partial_failure` or `provider_accepted`)
  - `workstreams/avinash/frontend/tests/m360-outbox-worker.test.js` (added test `executeMarketingChannel honest receipts (W2)` verifying missing `provider_message_id` fails with `NO_PROVIDER_ID` and never synthesizes IDs)
- **Commands run with real output**:
  - `grep -n "wa_\${randomUUID\|'wa_' +\|\"wa_\" +" lib/m360-marketing-orchestrator.js`:
    ```
    (Exit code 1, 0 matches - all completely removed)
    ```
  - Full sentinel grep across `api/marketing.js` and `lib/m360-marketing-orchestrator.js`:
    ```
    (Exit code 1, 0 matches - all 7 original defects removed!)
    ```
  - `node --test workstreams/avinash/frontend/tests/m360-outbox-worker.test.js`:
    ```
    ▶ Stage 8 (W1 & W2): Durable Outbox Worker & Honest Provider Sends
      ✔ Approval snapshots eligible audience into campaign_outbox with deterministic idempotency keys (3.294ms)
      ✔ Partial batch failure: Recipient 3 failure leaves 1-2 provider_accepted, 3 failed, and 4-5 queued (1.2353ms)
      ✔ WhatsApp honest sends (W1): Missing provider message id fails with NO_PROVIDER_ID and never generates fake wa_ id (1.6762ms)
      ✔ executeMarketingChannel honest receipts (W2): Missing provider_message_id fails with NO_PROVIDER_ID and never synthesizes IDs (24.9043ms)
      ✔ Mode gating: draft_only keeps outbox queued; team_test dispatches only allowlisted recipients (0.5994ms)
      ✔ Concurrency: Two workers claiming outbox never double-send the same row (0.3339ms)
    ✔ Stage 8 (W1 & W2): Durable Outbox Worker & Honest Provider Sends (33.7751ms)
    ℹ tests 6
    ℹ suites 1
    ℹ pass 6
    ℹ fail 0
    ```
  - `npm test`:
    ```
    ℹ tests 253
    ℹ suites 9
    ℹ pass 253
    ℹ fail 0
    ℹ duration_ms 14217.0496
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
- **Decisions made**:
  - Live execution for both Email and WhatsApp strictly validates that adapter returns a genuine `provider_message_id`. If omitted or null, the execution record is marked `failed` with `NO_PROVIDER_ID` and no ID is synthesized.
  - Quota recording (`recordSendQuotaUsage`) only counts `acceptedCount`, preventing charging/counting failed sends against send limits.
  - Removed non-standard `consent_verified: true` from WhatsApp dispatch payload.

---

### Stage 3 — Consent cannot be asserted by the caller (hardens C2)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Branch**: `mayur/phase2_5-correction`
- **Files changed / created**:
  - `workstreams/avinash/frontend/lib/m360-marketing-orchestrator.js` (In `importLeadsToTask`: hardened lead import so caller cannot assert `granted` without a verified consent source on the record. If `granted` or opt-in flags arrive without source, status is stored as `unknown`, `consent_evidence` flags are removed, and a per-row `consent_warnings` warning is attached and returned in `task.audience_snapshot.consent_warnings`)
  - `workstreams/avinash/frontend/api/marketing.js` (Exposed `consent_warnings` in `/api/marketing/import-leads` JSON response)
  - `workstreams/avinash/frontend/tests/m360-consent.test.js` (Added test `Caller cannot assert granted consent without evidence source (C2 hardening)` asserting leads with `email_opt_in_status: 'granted'` and no source are stored as `unknown` with `consent_warnings` and remain ineligible on all channels)
  - `workstreams/avinash/frontend/tests/marketing-production-suite.test.js` (Updated `Direct Lead Injection` test contacts to include genuine consent source `consent_source: 'crm_verified_form'` and timestamp)
- **Commands run with real output**:
  - `node --test workstreams/avinash/frontend/tests/m360-consent.test.js`:
    ```
    ▶ Stage 2 (C2): Consent and Suppression as Data
      ✔ A JSON lead with only email+phone has unknown consent and empty evidence (7.3038ms)
      ✔ Caller cannot assert granted consent without evidence source (C2 hardening) (1.0427ms)
      ✔ A contact with only email+phone is ineligible on every channel (0.2285ms)
      ✔ Consent becomes eligible ONLY with a granted consent row containing source, timestamp, and wording (0.2481ms)
      ✔ A suppressed contact is ineligible even with granted consent (0.3104ms)
      ✔ Cross-channel suppression blocks all channels (0.1992ms)
    ✔ Stage 2 (C2): Consent and Suppression as Data (11.1562ms)
    ℹ tests 6
    ℹ suites 1
    ℹ pass 6
    ℹ fail 0
    ```
  - `node --test workstreams/avinash/frontend/tests/marketing-production-suite.test.js`:
    ```
    ✔ WhatsApp Meta Key Vault: Tenant-isolated AES-256-GCM encryption and provider verification (11.6857ms)
    ✔ Persona Mode Switcher: Dynamically shifts between B2B Industrial and B2C Affinity (82.0115ms)
    ✔ Multi-Agent Team Collaboration: Supervisor review controls and inter-agent directives (76.5641ms)
    ✔ Direct Lead Injection: Imports contacts and updates Gate 2 audience eligibility (76.6623ms)
    ℹ tests 4
    ℹ suites 0
    ℹ pass 4
    ℹ fail 0
    ```
  - `npm test`:
    ```
    ℹ tests 254
    ℹ suites 9
    ℹ pass 254
    ℹ fail 0
    ℹ duration_ms 14464.4349
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
- **Decisions made**:
  - Closed the loophole where callers asserting `granted` or boolean consent flags could automatically gain eligibility without providing an explicit consent source on the contact record.
  - Implemented per-row and snapshot-level `consent_warnings` collection that alerts operators whenever unverified consent assertions are downgraded to `unknown`.

---

### Stage 4 — Real cost preview from a rates table (replaces the ₹0.80/conversation myth)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Branch**: `mayur/phase2_5-correction`
- **Files changed / created**:
  - `workstreams/avinash/frontend/lib/m360-rates.js` (Created real cost estimator using India delivery rates: WhatsApp marketing ₹0.8631, WhatsApp utility ₹0.1150, Email ₹0.01, SMS ₹0.15 + 18% GST)
  - `lib/m360-rates.js` (Root export shim)
  - `workstreams/avinash/frontend/tests/m360-rates.test.js` (Unit test verifying 100-recipient WhatsApp marketing estimate = 100 * 0.8631 * 1.18 = 101.8458, utility pricing, email pricing, and 0 recipients)
- **Commands run with real output**:
  - `grep -rn -E "0\.80|per[ .-]conversation" api/ lib/`:
    ```
    lib/m360-budget-estimator.js:153: * @param {number} [options.power=0.80] - Power (default 0.80 -> 80% power)
    lib/m360-budget-estimator.js:162:  const power = Number(options.power ?? 0.80);
    lib/m360-rates.js:5: * Replaces hard-coded per-conversation myths with real per-message India rates + 18% GST.
    ```
    (Zero cost-related occurrences of 0.80 or per-conversation remain in api/ or lib/)
  - `node --test workstreams/avinash/frontend/tests/m360-rates.test.js`:
    ```
    ▶ Stage 4: Real Cost Preview from Rates Table
      ✔ asserts a 100-recipient marketing WhatsApp estimate = 100 * 0.8631 * 1.18 = 101.8458 (1.0606ms)
      ✔ asserts utility WhatsApp rate is 0.1150 + 18% GST (0.1896ms)
      ✔ asserts email rate is 0.01 + 18% GST (0.1442ms)
      ✔ returns 0 for zero recipients (0.9289ms)
    ✔ Stage 4: Real Cost Preview from Rates Table (3.6665ms)
    ℹ tests 4
    ℹ suites 1
    ℹ pass 4
    ℹ fail 0
    ```
  - `npm test`:
    ```
    ℹ tests 258
    ℹ suites 10
    ℹ pass 258
    ℹ fail 0
    ℹ duration_ms 14504.3922
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
- **Decisions made**:
  - All channel cost estimates use per-delivered-message pricing models reflecting Meta and telecom carrier tariffs in India, including standard statutory 18% GST.
  - Eliminated all references to flat ₹0.80 per-conversation marketing costs.

---

### Stage 5 — Confirm the real fixes are intact (V1, R1, S1, P1, P2)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Branch**: `mayur/phase2_5-correction`
- **Files tested**:
  - `workstreams/avinash/frontend/tests/m360-vault-key.test.js` (V1 verified: `VAULT_KEY_MISSING` on empty or short key, HKDF v2 encryption, 0 default key strings, 0 credential writes to disk)
  - `workstreams/avinash/frontend/tests/m360-webhooks.test.js` (R1 & S1 verified: raw bytes HMAC verification, unicode escape support, strict tenant isolation across phone_number_id, multilingual suppression in Hindi/Bengali/English)
  - `workstreams/avinash/frontend/tests/m360-provider-verification.test.js` (P1 & P2 verified: RBAC on `providers/configure`, invalid credentials reject and leave Gate 3 false, managed WhatsApp returns honest onboarding state machine and never fake `verified: true`)
- **Commands run with real output**:
  - `node --test tests/m360-vault-key.test.js tests/m360-provider-verification.test.js tests/m360-webhooks.test.js`:
    ```
    ▶ Stage 5 (P1 & P2): Verify-then-Save Providers & Honest WhatsApp States
      ✔ RBAC: sales_operator cannot configure providers; client_admin and platform_owner can (0.8252ms)
      ✔ WhatsApp provider verification with invalid credentials leaves gate3 false and returns unverified (31.6646ms)
      ✔ Managed WhatsApp mode returns onboarding status, never verified: true (0.5191ms)
      ✔ All valid onboarding state machine transitions exist in WHATSAPP_ONBOARDING_STATES (0.8661ms)
    ✔ Stage 5 (P1 & P2): Verify-then-Save Providers & Honest WhatsApp States (35.5002ms)
    ▶ Stage 1 (V1): Required Vault Key & HKDF Derivation
      ✔ Grep test: no default key string in source code (1.8111ms)
      ✔ Throws VAULT_KEY_MISSING when env var is unset or empty (0.7162ms)
      ✔ Throws VAULT_KEY_MISSING when decoded key is shorter than 32 bytes (0.4168ms)
      ✔ Encrypt and decrypt round-trips with real key (Version 2 HKDF) (4.995ms)
      ✔ Backward compatibility: decrypts legacy v1 ciphertext (0.6597ms)
      ✔ Marketing API refuses to serve (HTTP 503) when VAULT_KEY_MISSING (4.259ms)
      ✔ Zero credential writes to disk: saveTasksToDisk does not write provider_credentials (1.1216ms)
    ✔ Stage 1 (V1): Required Vault Key & HKDF Derivation (15.8909ms)
    ▶ Stage 6 (X1, R1, S1): Raw HMAC Webhooks & Multilingual Suppression
      ✔ X1: A signed raw payload with unicode escape sequences (\u0020) verifies successfully (not 401) (8.5818ms)
      ✔ R1: A STOP for tenant A never changes tenant B contacts or tasks (28.881ms)
      ✔ S1: Hindi and Bengali STOP keywords write suppression records and revoke WhatsApp status (2.7094ms)
    ✔ Stage 6 (X1, R1, S1): Raw HMAC Webhooks & Multilingual Suppression (41.7498ms)
    ℹ tests 14
    ℹ suites 3
    ℹ pass 14
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
- **Decisions made**:
  - Confirmed V1, R1, S1, P1, and P2 security rails remain intact without any regressions.

---

### Stage 6 — Durable store, outbox, quota, webhook tenant isolation (M1, E2, X1)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Branch**: `mayur/phase2_5-correction`
- **Files tested**:
  - `workstreams/avinash/frontend/tests/m360-durable-store.test.js` & `tests/m360-outbox-worker.test.js` (M1: durable save and multi-process resume; partial batch failure leaves sent rows recorded and retries only unsent ones)
  - `workstreams/avinash/frontend/tests/m360-roles-quota-chat.test.js` (E2: atomic daily and monthly workspace send quota enforcement)
  - `workstreams/avinash/frontend/tests/m360-webhooks.test.js` (X1: WhatsApp inbound opt-out/opt-in strictly tenant-isolated via `phone_number_id`, never affects other tenants)
- **Commands run with real output**:
  - `node --test tests/m360-durable-store.test.js tests/m360-outbox-worker.test.js tests/m360-roles-quota-chat.test.js tests/m360-webhooks.test.js`:
    ```
    ✔ Stage 4 (M1): Durable store save and multi-process reload returns identical campaign (340.6619ms)
    ✔ Stage 4 (M1): Zero disk writes when durable store is active (1.7222ms)
    ▶ Stage 8 (W1 & W2): Durable Outbox Worker & Honest Provider Sends
      ✔ Approval snapshots eligible audience into campaign_outbox with deterministic idempotency keys (6.4831ms)
      ✔ Partial batch failure: Recipient 3 failure leaves 1-2 provider_accepted, 3 failed, and 4-5 queued (2.5503ms)
      ✔ WhatsApp honest sends (W1): Missing provider message id fails with NO_PROVIDER_ID and never generates fake wa_ id (1.0469ms)
      ✔ executeMarketingChannel honest receipts (W2): Missing provider_message_id fails with NO_PROVIDER_ID and never synthesizes IDs (46.1622ms)
      ✔ Mode gating: draft_only keeps outbox queued; team_test dispatches only allowlisted recipients (0.9605ms)
      ✔ Concurrency: Two workers claiming outbox never double-send the same row (0.8336ms)
    ✔ Stage 8 (W1 & W2): Durable Outbox Worker & Honest Provider Sends (62.0491ms)
    ▶ Stage 7 (E1 & E2): Roles, Quota & Safe Chat Drafts
      ✔ RBAC (E2): sales_operator cannot approve or send campaigns; client_admin and platform_owner can (1.6755ms)
      ✔ API Server-Side RBAC (E2): sales_operator gets HTTP 403 on approve and execute routes (213.3106ms)
      ✔ Safe Chat Drafts (E1): Conversation prepares draft state without sending or generating synthetic contacts (36.3769ms)
      ✔ Send Quota (E2): Enforces daily and monthly limits atomically and rejects excess sends (1.2808ms)
    ✔ Stage 7 (E1 & E2): Roles, Quota & Safe Chat Drafts (254.7707ms)
    ▶ Stage 6 (X1, R1, S1): Raw HMAC Webhooks & Multilingual Suppression
      ✔ X1: A signed raw payload with unicode escape sequences (\u0020) verifies successfully (not 401) (11.6561ms)
      ✔ R1: A STOP for tenant A never changes tenant B contacts or tasks (33.1817ms)
      ✔ S1: Hindi and Bengali STOP keywords write suppression records and revoke WhatsApp status (2.5162ms)
    ✔ Stage 6 (X1, R1, S1): Raw HMAC Webhooks & Multilingual Suppression (49.2539ms)
    ℹ tests 15
    ℹ suites 3
    ℹ pass 15
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
- **Decisions made**:
  - Confirmed M1 (durable store & outbox worker), E2 (atomic quota ledger & RBAC), and X1 (strict tenant isolation by phone_number_id) remain robust and fully functional.

---

### Stage 7 — Replace the grep harness with a behavioural one (mandatory)
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Branch**: `mayur/phase2_5-correction`
- **Files changed / created**:
  - `tools/audit/exploits.js` (Completely rewritten from source-code grep string-matching to real handler execution with mocked network providers. Added mandatory top comment `// This harness MUST execute the handler. Grep/string-matching the source is forbidden.` Each of the 13 checks drives `api/marketing.js` handlers and orchestrator modules directly and asserts actual behavior)
  - `workstreams/avinash/frontend/tests/m360-behavioural-audit.test.js` (Permanent regression suite under `tests/` asserting all 13 checks return `NOT REPRODUCED` via execution)
- **Commands run with real output**:
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
  - `node --test workstreams/avinash/frontend/tests/m360-behavioural-audit.test.js`:
    ```
    ▶ Stage 7: Behavioural Exploit Audit Suite (All 13 Checks)
      ✔ executes all 13 checks against real handlers and confirms 13/13 NOT REPRODUCED (49.5715ms)
    ✔ Stage 7: Behavioural Exploit Audit Suite (All 13 Checks) (50.6986ms)
    ℹ tests 1
    ℹ suites 1
    ℹ pass 1
    ℹ fail 0
    ```
  - `npm test`:
    ```
    ℹ tests 259
    ℹ suites 11
    ℹ pass 259
    ℹ fail 0
    ℹ duration_ms 14623.5572
    ```
  - Full Sentinel Grep:
    ```
    (Exit code 1, 0 matches)
    ```
- **Decisions made**:
  - Replaced the legacy string-matching audit script with an honest behavioral harness that executes real HTTP handlers and domain logic under mocked network conditions.
  - Zero regex or string-matching of product code is used to determine compliance.

---

### Stage 8 — Honest Verification Report & Sign-off
- **Status**: `DONE` (`VERIFIED_LOCAL`)
- **Branch**: `mayur/phase2_5-correction`
- **Files changed / created**:
  - `docs/agent-runs/PHASE2_5_REPORT.md` (Full verification report documenting before/after sentinel grep, 13/13 behavioural harness output, 259/259 Node 24 test passes, multi-process durability, and executive summary)
  - `docs/agent-runs/PHASE2_5_PROGRESS.md` (Updated with Stage 8 completion)
- **Commands run with real output**:
  - Full Sentinel Grep:
    ```
    (Exit code 1, 0 matches)
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
    ℹ tests 259
    ℹ suites 11
    ℹ pass 259
    ℹ fail 0
    ```
- **Decisions made**:
  - Signed off on all acceptance criteria for Phase 2.5. Ready for review before proceeding to subsequent phases.


