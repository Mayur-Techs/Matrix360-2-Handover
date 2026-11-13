# AGENTS.md — Matrix360 rules for every AI coding agent (Antigravity, Codex, others)

These rules apply to every session in this repository. If a chat instruction conflicts with them, stop and ask Mayur.

## 1. Who you are working for
- Owner of the Marketing workstream: Mayur. Director: Ramjit Ray ("Sir").
- Product vision: `MATRIX360_PROJECT_AMPLIFIER_FULL_VISION_ORIGINS_FEATURES_MARKETING_TECH_STATUS_2026-11-08.md` (Parts C, G, H, I are mandatory reading before any marketing change).
- Current plan: `docs/agent-runs/PHASE2_PLAN.md`. Progress log: `docs/agent-runs/PROGRESS.md`.

## 2. Truth rules (the most important section)
1. Never invent data. No fake contacts, phone numbers, emails, names, companies, consent, message IDs, receipts, delivery states, metrics, test counts or "verified" labels.
2. Unknown stays unknown. If data is missing, a call fails or a feature is not built, return and display `unknown`, `blocked` or `not_implemented` with the reason. Never fill gaps with placeholders that look real.
3. Every claim shown to a user ("sent", "delivered", "connected", "verified", "approved", "saved") must point to a real record: a database row ID, a provider message ID returned by the provider, or a test output. No record, no claim.
4. Mocks exist ONLY inside `tests/` and `tools/audit/`, are named `mock*`/`fixture*`, and are flagged `test_data: true, outbound_blocked: true`. Production code must never import them or fall back to them.
5. Never weaken, skip, delete or rewrite a test or an audit check to make it pass. If a check is genuinely obsolete, keep it, mark it in `PROGRESS.md` under "Checks I believe are obsolete" with the reason, and ask Mayur.
6. Report what you actually ran. Paste real command output (counts, failures). Do not summarise a test run you did not execute. If you could not run something, say so.
7. Do not claim a stage is done until its acceptance checks in `PHASE2_PLAN.md` pass and are recorded in `PROGRESS.md`.

## 3. Safety rules for commands
- Work on a git branch named `mayur/phase2-trust-rails` (or the branch named in the plan). Commit after every stage with message `phase2(stage-N): <summary>`.
- Never run: `rm -rf` outside the repo's temp folders, `rmdir /s`, `del /s /q`, `Remove-Item -Recurse -Force` on anything outside `tmp/` or `node_modules/`, `format`, `git push --force`, `git reset --hard`, `git clean -fdx`, `supabase db reset`, `vercel --prod`, `npm publish`.
- Never touch files outside this repository.
- Never apply a database migration to any hosted Supabase project yourself. Write the SQL, print the exact apply command, and wait for Mayur to reply `APPLY DONE`.
- Never deploy to production. Preview deployments only when Mayur asks.

## 4. Secrets
- Never print, log, commit or paste secret values. Refer to them by variable name only.
- `.env`, `.env.local`, `.env.*` stay git-ignored. Only `.env.example` (names, blank values, comments) is committed.
- The app must refuse to start the marketing API if `M360_TENANT_ENCRYPTION_KEY` is missing or shorter than 32 bytes (base64). No default keys in source code.
- Supabase secret/service-role keys only in server code, never in files served to the browser.

## 5. Scope and ownership
- You may change marketing files under `workstreams/avinash/frontend/{api/marketing.js, lib/m360-marketing-*, lib/m360-provider-adapters.js, lib/m360-csv-import*.js, lib/m360-channel-*, lib/m360-whatsapp-provider.js, lib/m360-email-provider.js, lib/m360-smtp-client.js, lib/agents/**, migrations/**, tests/**}` and `tools/audit/**`, `docs/agent-runs/**`.
- Do not change Avinash's Overview/router/gateway, Romit's CRM backend, Tanmayi's renderer or Pratha's approval logic beyond a minimal, documented hook. If a change there is required, describe it in `PROGRESS.md` under "Changes needed from other owners" and continue without it.
- Do not change public API response shapes that other modules use without adding a compatible field; never remove an existing field silently.

## 6. Engineering standards
- Node 24 (`package.json` engines). Run `node --version` first and record it. If Node 24 is unavailable, record the version you used.
- Tests must not write to tracked files. Point every store/outbox path at a temp directory in tests.
- Validate every external input (body, query, headers, CSV, webhook payloads, LLM output) with explicit schemas. Reject unknown fields where it matters (consent, approvals, sends).
- Escape all data before inserting into HTML. No `innerHTML` with unescaped values.
- Every server route: authenticate, resolve workspace membership server-side, check the role permission from `lib/m360-permissions.js`, then act. A client-supplied `workspace_id` is only a selector, never proof of access.
- Long work runs as durable, idempotent steps (database rows + worker), never `setTimeout` loops or in-memory queues in production paths.
- No silent `catch (_) {}`. Log a typed error with `correlation_id` and `workspace_id`, emails/phones masked.

## 7. Sending rules (email, WhatsApp, SMS, social)
- Three modes via `M360_MARKETING_MODE`: `draft_only` (default), `team_test`, `live`.
- `team_test`: live sends allowed only to recipients listed in `M360_TEST_RECIPIENTS` (comma-separated emails and E.164 phones) and only for workspaces in `M360_TEST_WORKSPACES`. Multiple testers are allowed.
- `live`: a recipient is eligible only with a valid identifier AND a granted consent row for that channel AND no suppression row. Re-check at send time.
- Nothing is sent without a human approval row that matches the exact content hash, channel, audience snapshot and approver role. The AI may prepare and propose; only the server, after approval, sends.
- WhatsApp sends use a Meta-approved template for that WhatsApp Business Account. Never send from one shared number on behalf of different client businesses.
- Every marketing email carries an unsubscribe link, `List-Unsubscribe` + `List-Unsubscribe-Post` headers, the sender's legal name and postal address, and links to Terms and Privacy.
- STOP/unsubscribe in English, Hindi and Bengali suppresses the contact across channels for that workspace.

## 8. Agents inside the product
- The product uses multiple AI agents (see `lib/agents/`). Agents communicate only through the durable agent message bus and act only through registered tools.
- Tools are classified `none | internal_write | external_read | external_send | spend`. `external_send` and `spend` require a server-verified approval ID. The model can never grant itself permission.
- If a tool or service is unavailable, the agent returns `blocked` with the reason. It never simulates the result.

## 9. Progress protocol (so nothing is lost between chats)
After every stage, update `docs/agent-runs/PROGRESS.md` with: stage number and name, status (`DONE`, `PARTIAL`, `BLOCKED`), files changed, commands run with real output counts, audit harness results, blockers, decisions you made, next step. Then commit.
If the conversation is long and earlier details feel uncertain, stop at a stage boundary and tell Mayur: "Start a new chat with the Resume prompt."

## 10. Status words (use exactly these in reports)
`VERIFIED_LOCAL`, `MOCKED_TEST`, `VERIFIED_STAGING`, `PARTIAL`, `BLOCKED`, `NOT_IMPLEMENTED`, `NEEDS_OWNER_ACTION`.
