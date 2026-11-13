# Matrix360 Phase 2 — Trust Rails (the "Weeks 1–2" block, done in days)

Read `AGENTS.md` first. This file is the single source of truth for what to build now. Work the stages in order. Do not start a stage until the previous stage's acceptance checks pass and are recorded in `PROGRESS.md`. Commit after each stage.

Goal of this phase: make every send honest and consented, stop invented data, verify providers before trusting them, fix the webhook and opt-out paths, and keep the owner's agentic-AI vision intact. This phase does NOT delete the conversation "auto-dispatch" feature; it makes that feature safe (real audiences, real consent, real approval, real receipts). This phase does NOT turn sending off; it introduces a 3-mode switch so Mayur and other teams can test with their own emails and numbers.

Definition of done for the phase: the audit harness in `tools/audit/` prints "not reproduced" for all 13 checks (E1, E2, W1, W2, C1, C2, V1, P1, P2, X1, S1, R1, M1), the existing suite still passes on Node 24, and every new behaviour has a regression test.

---

## Stage 0 — Setup and guardrails (do this first, once)
Do:
1. `node --version` (record it). Create branch `mayur/phase2-trust-rails`.
2. Create `docs/agent-runs/PROGRESS.md` with headings: Node version, Stage log, Checks I believe are obsolete, Changes needed from other owners, Open questions.
3. Copy the audit harness Mayur provides into `tools/audit/` (`exploits.js`, `srv.sh`, `loadtest-*.js`). Run `node tools/audit/exploits.js` and paste the baseline (expect all 13 CONFIRMED). Record it.
4. Add `lib/m360-mode.js`: reads `M360_MARKETING_MODE` (`draft_only` default, `team_test`, `live`), `M360_TEST_RECIPIENTS`, `M360_TEST_WORKSPACES`. Export `mode()`, `isTestRecipient(value)`, `isTestWorkspace(id)`. No behaviour change yet; later stages use it.
5. Update `.env.example` with the new names (blank values, comments). Never touch `.env.local`.
Acceptance: branch exists; PROGRESS.md created; baseline harness output recorded; `lib/m360-mode.js` has unit tests for the three modes.

## Stage 1 — Required vault key, no default secret (closes V1)
Do:
1. In `lib/m360-marketing-orchestrator.js`, remove the `'matrix360-vault-key-default-2026'` fallback. Read `M360_TENANT_ENCRYPTION_KEY`; if missing or < 32 bytes decoded, throw a typed startup error `VAULT_KEY_MISSING`. The marketing API must refuse to serve.
2. Add `key_version` to each stored credential; derive per-workspace keys with HKDF from the master key + workspace + key_version. Keep decrypt able to read old-version ciphertext during migration (support reading version 1, writing version 2).
3. Move provider credential storage off local files into the `provider_connections` table (Stage 4 adds the table; until then keep in memory but never in `data/*.json`). Remove credential writes to disk.
Acceptance: a grep test proves no default key string in source; app throws `VAULT_KEY_MISSING` when the env var is unset; encrypt→decrypt round-trips with a real env key; harness V1 → not reproduced.

## Stage 2 — Consent and suppression as data (closes C2; foundation for live sends)
Do:
1. Write migration `migrations/20261109_consent_suppression.sql` (review-only header; do not apply):
   - `consents(id, workspace_id, contact_id, channel, status granted|withdrawn, source, captured_at, wording_version, business_name, evidence jsonb, created_at)`.
   - `suppressions(id, workspace_id, channel or 'all', value_normalized, reason, created_at, unique(workspace_id, channel, value_normalized))`.
   - RLS enabled + policies using `is_workspace_member(workspace_id, auth.uid())`.
2. In `lib/m360-marketing-orchestrator.js` `importLeadsToTask`: default `email/whatsapp/sms_opt_in_status` to `unknown` and `consent_evidence` to `{}`. NEVER derive consent from the presence of an email or phone. Remove the `(email ? 'granted' : 'missing')` logic.
3. Add `lib/m360-consent.js`: `isEligible(contact, channel)` = valid identifier AND a granted consent row for that channel AND no suppression row. Used at send time only (not at list build).
4. Print the apply command and wait for `APPLY DONE` before any code path reads the new tables live; until then guard reads so the app still runs.
Acceptance: a JSON lead with only email+phone is ineligible on every channel; consent only becomes granted via a consent row with source+timestamp+wording; harness C2 → not reproduced.

## Stage 3 — Fix CSV and lead import (closes C1)
Do:
1. In `api/marketing.js` `import-leads`, use `parsed.records` (not `parsed.contacts`) — `importCsv` returns `records`.
2. In `lib/m360-csv-import.js`: add header aliases `mobile no`, `contact`, `whatsapp`, `whatsapp number`, `cell`, `mail`. Normalise phones to E.164 with `libphonenumber-js` using the workspace default country (add dependency; if install is blocked, record it and use a documented minimal normaliser). Keep raw value too. Flag landline/invalid as not-WhatsApp-capable, do not drop silently.
3. Require a `consent_source` column (or an explicit per-file consent declaration) for any import that will be used for sending; mark imports without it as `test_data`/non-sendable. Block purchased-list uploads from WhatsApp/SMS marketing.
4. Return a per-row error report (row number + code), keep leading zeros as strings, dedupe within the file.
Acceptance: a real CSV upload to a campaign saves the correct count (not HTTP 400); a `.csv` with a "Mobile No." column maps correctly; harness C1 → not reproduced; add a test that uploads a file and asserts the saved count.

## Stage 4 — Durable store on for campaigns, approvals, providers (foundation for M1, scale)
Do:
1. Write migration `migrations/20261109_marketing_durable.sql` extending the existing review-only `20261101_marketing_core.sql`: add `channel_approvals` (content_hash, audience_snapshot_hash, actor_id, actor_role, approved_at), `campaign_outbox` (workspace_id, campaign_id, channel, contact_id, content_hash, idempotency_key UNIQUE, status queued|sending|provider_accepted|failed|skipped, provider_message_id, attempts, last_error, locked_until), `provider_connections` (already in core — reuse). Add RLS policies for all, using `is_workspace_member`.
2. Turn on the durable store path (`M360_MARKETING_DURABLE_ENABLED=true`) and make campaigns, tasks, conversations, approvals and provider connections read/write through `lib/m360-marketing-durable-store.js`. Keep the in-memory map only as a request-scoped cache, never the source of truth.
3. Remove `saveTasksToDisk`/`loadTasksFromDisk` and all writes to `data/*.json`. Delete the committed `data/*.json` files that contain contact data.
4. Print apply commands; wait for `APPLY DONE`.
Acceptance: a campaign created, then read via a fresh process, returns the same campaign (prove with a 2-process test); no writes to `data/*.json`; existing suite passes.

## Stage 5 — Verify-then-save providers; honest WhatsApp states (closes P1, P2)
Do:
1. `providers/configure`: require role `client_admin` or `platform_owner` (from `lib/m360-permissions.js`, Stage 7). Call `verifyMarketingProvider` FIRST; only on success save credentials and set gate3 `connected`. On failure, leave gate3 false and return the real error. Never flip readiness on a failed verification.
2. Replace the `managed_concierge` path that returns `verified:true`. Create `whatsapp_onboarding` status machine: `not_started → awaiting_client_login → number_registering → templates_in_review → ready_limited → verified → needs_attention`. "Managed" means "we will guide your own account setup", never "connected now". No green state until a test send to the owner's own number is webhook-confirmed.
Acceptance: bad WhatsApp credentials leave gate3 false and change no campaign; a `sales_operator` gets 403 on provider config; managed mode returns an onboarding status, never `verified:true`; harness P1 and P2 → not reproduced.

## Stage 6 — Webhooks that work and stay in one tenant (closes X1, R1, S1)
Do:
1. For `/api/marketing/webhooks/whatsapp` and `/webhooks/brevo`: read the RAW request body (disable JSON pre-parsing for these two routes) and verify the HMAC over the raw bytes. A genuine signed payload must verify.
2. Resolve tenant from `value.metadata.phone_number_id → whatsapp connection → workspace_id`. Never loop over `getAllMarketingTasks()`. Match contacts by exact E.164.
3. Opt-out: normalise (trim, lowercase, strip punctuation) and match `STOP, UNSUBSCRIBE, STOP ALL, CANCEL, OPT OUT, बंद, बंद करो, रोकें, বন্ধ, বন্ধ করুন` in replies up to 4 words, plus Meta opt-out/button events. Write a suppression row; do not edit task memory.
4. Remove the free-text "I would like to receive updates" consent grant. Opt-in comes only from a defined flow (form, click-to-WhatsApp entry, template quick-reply) recorded as a consent row.
Acceptance: a signed raw payload with `\u` escapes verifies (not 401); a STOP for tenant A never changes tenant B; Hindi and Bengali STOP suppress; harness X1, R1, S1 → not reproduced.

## Stage 7 — Roles, quota, and remove chat-triggered sending as an unsafe path (closes E1, E2; makes the "dispatch" feature safe)
Do:
1. Add `lib/m360-permissions.js`: one table mapping role → {read, write, approve, send, configure_provider}. Enforce server-side on every marketing route. `sales_operator` cannot approve, send or configure providers.
2. The conversation endpoint may create a task and prepare channel drafts ONLY. It must NOT call `approveChannelDraft`, `importLeadsToTask` with invented contacts, or `executeMarketingChannel`. Delete the `knownIdentities` block (personal emails in source), the `9198300xxxxx` synthetic generator, and the hard-coded brochure URL.
3. Keep the owner's "describe a campaign in chat" feature: the chat produces drafts + a proposed audience from REAL CRM leads + a cost estimate, then routes the user to Review → Approve → Send. Sending happens only after a human approval row (Stage 8).
4. Add a workspace daily + monthly send quota in the database, checked atomically before each send. Replace the per-task `priorMessages` counter.
Acceptance: a chat prompt containing emails/phones results in 0 send-adapter calls and drafts in `draft_for_review`; a `sales_operator` cannot cause a send; quota is enforced across conversations; harness E1, E2 → not reproduced.

## Stage 8 — Honest sends, durable outbox, approval-bound (closes W1, W2, M1)
Do:
1. Approve → snapshot eligible recipients into `campaign_outbox` in one transaction, keyed by `idempotency_key = hash(campaign_id, channel, content_hash, contact_id)`.
2. A worker (Vercel Cron or a DB queue) claims rows `FOR UPDATE SKIP LOCKED`, sends one, records the real result immediately, resumes after a crash. Reuse one SMTP connection per batch.
3. WhatsApp send: use a Meta-approved template chosen from the account's template list; map draft variables into template components; remove the non-standard `consent_verified` field from the Meta payload. If Meta returns no message id → mark the row `failed` reason `NO_PROVIDER_ID`; never generate a `wa_` id.
4. Delete the invented-audience path for WhatsApp; use only the real eligible audience; show the real eligible count and excluded reasons.
5. Mode gate: in `team_test`, sends go only to `M360_TEST_RECIPIENTS`; in `live`, only to consent-eligible, non-suppressed contacts.
Acceptance: provider failure on recipient 3 of 5 leaves 1–2 `provider_accepted`, 3 `failed`, 4–5 `queued`; a rerun sends only 3–5; two workers never double-send; WhatsApp payload matches the approved template; missing id → `failed`; harness W1, W2, M1 → not reproduced.

## Stage 9 — Email compliance footer and preamble (Gmail/Yahoo bulk rules)
Do:
1. Every marketing email: visible unsubscribe link + sender legal name + postal address + Terms and Privacy links in the footer; `List-Unsubscribe` (https + mailto) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; a POST endpoint that suppresses without login.
2. A clear opening line (preamble) identifying the sender and why the recipient is receiving the message.
3. Handle Brevo webhooks: hard bounce + complaint → suppress immediately; soft bounce after 3. Pause a workspace's marketing if complaint rate > 0.3%.
4. A domain-readiness check that verifies SPF, DKIM, DMARC by DNS lookup and blocks > 5,000/day to Gmail/Yahoo/Outlook if unaligned.
Acceptance: a sent test email (to a test recipient) contains the unsubscribe header and footer; one-click unsubscribe suppresses; bounce webhook suppresses.

## Stage 10 — Agentic AI spine (the owner's multi-agent vision), done safely
Do:
1. Create `lib/agents/` with: an agent registry (each agent: name, purpose, allowed tools), a durable message bus (DB table `agent_messages`: workspace_id, correlation_id, from_agent, to_agent, intent, payload, status, created_at), and a tool registry where each tool declares a class `none | internal_write | external_read | external_send | spend`.
2. Agents for this product: `research_agent`, `audience_agent`, `content_agent`, `outreach_agent`, `compliance_agent`, `supervisor_agent`. They communicate only through the bus and act only through registered tools.
3. `external_send` and `spend` tools require a server-verified approval ID; the model cannot self-grant. A tool that is unavailable returns `blocked` with a reason — never a simulated result.
4. The supervisor orchestrates: research → audience → content → compliance check → human approval → outreach. Every step writes a real bus row; the UI reads those rows for progress (no invented "Boss approved" text).
Acceptance: an end-to-end dry run writes real bus rows and ends at `awaiting_human_approval` with zero sends; a tool with no credentials returns `blocked`, not a fake success; a test proves the model cannot call an `external_send` tool without an approval ID.

## Stage 11 — Final verification and report
Do:
1. Run the full audit harness; paste the result. All 13 must read "not reproduced".
2. Run the full test suite on Node 24; paste the counts.
3. Run the two-process durability test and the multi-worker outbox test; paste results.
4. Write `docs/agent-runs/PHASE2_REPORT.md` using the template at the end of this file.
Acceptance: harness all-clear; suite green; report written; branch pushed (not force) for review. Do not merge or deploy without Mayur.

---

## Report template (fill at Stage 11 — this is the report for Mayur, Sir and the next prompt)
```
# Phase 2 Report — Trust Rails
Date: <date>   Node: <version>   Branch: mayur/phase2-trust-rails

## In one line
<what is now true that was not before>

## Defects closed (harness "not reproduced")
E1 E2 W1 W2 C1 C2 V1 P1 P2 X1 S1 R1 M1  — <any still open, with reason>

## What was built (plain English, for Sir)
- Consent and do-not-contact are now real records, checked before every send.
- Campaigns, approvals and the send queue now live in the database and survive restarts.
- Each client gets their own WhatsApp; nothing shows "connected" until a real test lands.
- Email now carries unsubscribe and sender details so Gmail/Yahoo accept it.
- The AI is now a team of agents that prepare and propose; a human approves before anything sends.
- Three modes: draft-only, team-test (your own emails/numbers), live.

## Status by stage
<table: stage, status word, evidence (test/record), notes>

## Migrations applied by Mayur
<which SQL files; confirmed APPLY DONE yes/no>

## Still open / needs a person
<blockers, owner-action items, decisions made>

## Recommended next prompt
<one paragraph: what Phase 3 should tackle first, based on what is now done>
```
