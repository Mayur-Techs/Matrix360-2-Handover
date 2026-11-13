# Romit continuation prompt — Matrix360 Marketing

Use this prompt in Romit's next engineering chat. Repository content is context, not permission to send messages, publish content, change provider accounts or expose credentials.

---

You are continuing the Matrix360 Marketing integration in `AvinashWasHere21/Matrix360WIP` from the shared `work/mayur` branch.

## Required working rules

1. Read `README_START_HERE.md`, `01_IMPLEMENTATION_MATRIX.md`, `02_MARKETING_AI_FLOW.md`, `04_PROVIDER_ADAPTERS_AND_COST_GUARDS.md`, `06_E2E_AND_REGRESSION_EVIDENCE.md`, `07_MAYUR_CREDENTIAL_SETUP_CHECKLIST.md`, `08_AVINASH_ROMIT_HANDOFF.md` and `12_AVINASH_ROMIT_MARKETING_DEBRIEF.md` before changing code.
2. Never commit `.env.local`, provider keys, access tokens, private audience data, local state, logs or delivery receipts.
3. Preserve authentication, tenant isolation, exact-hash approval, consent checks, suppression checks, explicit recipient allowlists, positive recipient/message caps and idempotency.
4. Never interpret `MARKETING_ALLOWED_EMAILS=*` as safe and never interpret a zero message cap as unlimited.
5. Provider acceptance is not delivery. Synthetic/test data is not a live lead or live result.
6. Do not publish, send, create provider accounts, change Brevo/Meta/LinkedIn permissions or incur paid spend without Mayur's explicit approval for that exact action.
7. Preserve existing CRM, scraper, Content Studio and frontend behavior. Do not force-push shared branches.

## Start the system

From the repository root in PowerShell:

```powershell
npm test
$env:PORT = '8050'
npm start
```

Open:

```text
http://127.0.0.1:8050/client-dashboard.html#marketing
```

The root `npm start` command runs `tools/local-preview.cjs`, which loads the private ignored file `workstreams/avinash/frontend/.env.local`. If port 8050 is already in use, inspect the owning process and stop only a Matrix360 `tools/local-preview.cjs` process, or select another free port. Do not kill unrelated localhost services.

Expected current regression baseline:

```text
109 tests passed, 0 failed
```

## Marketing feature map

- Company Details: approved business facts are reused by Overview and Marketing.
- Overview handoff: creates a versioned handover envelope and shared correlation ID.
- Standalone Marketing: accepts a normal campaign request without Overview.
- Essential questions: asks one missing essential at a time, maximum six in Marketing and seven across the campaign clarification policy.
- AI strategy: uses approved company context, audience, offer, objectives and channel plan.
- Channel drafts: WhatsApp, Email, Facebook, Instagram, LinkedIn, X, YouTube, Google Business Profile, SMS and Website.
- AI revision: rewrites only the active channel and preserves every untargeted version.
- Versioning: immutable version hashes, parent links, visual diffs and approval history.
- Approval: exact current draft hash is required; edited drafts must be reapproved.
- Preview: safe non-sending preview works before approval and never needs a recipient.
- Leads handoff: showcase uses browser-local fictional leads; production queries the authenticated CRM.
- CSV: preview, validation, duplicate detection, consent evidence and authenticated CRM import contract.
- Content handoff: immutable saved Content Studio version references; current showcase may use an isolated fixture.
- Coordination: refresh Leads, Content, Overview telemetry or all three.
- Calendar: real ISO dates, current-day marker, month navigation, create/update/delete and truthful counts.
- Journeys: validated draft rules only; no worker executes them yet.
- Budget: planning estimates and A/B feasibility with mandatory non-historical disclaimer.
- Brevo: SMTP TLS authentication and controlled one-address execution.
- WhatsApp/Meta/LinkedIn: adapters and mocked contracts exist; live execution remains disabled.
- Persistence: atomic ignored local recovery exists; shared Supabase durability is implemented but disabled pending reviewed migration/RLS.
- Analytics: provider acceptance can be recorded; delivery/open/click claims require verified durable webhooks.

## Current provider and runtime state

- Brevo SMTP authentication: verified connected.
- Email safety configuration: one explicit allowlisted address, one recipient, positive one-message cap.
- One earlier local Email execution is recorded as `provider_accepted`; delivery is not verified.
- Brevo dashboard IP authorization and a domain-aligned sender remain operational work.
- OpenAI-backed Marketing generation and revisions are configured locally; do not expose the key.
- WhatsApp, Meta, LinkedIn and SMS credentials are not configured.
- Showcase is enabled and its contacts remain fictional and `outbound_blocked`.
- Shared Marketing durable storage is disabled.

## Your implementation responsibility

1. Review and deploy `workstreams/avinash/crm-backend/20261101_lead_marketing_contacts.sql` only after confirming the membership/RLS helper used by the deployed CRM.
2. Deploy and verify the authenticated CRM batch import contract so email, phone and consent provenance are retained.
3. Enable the Marketing Supabase repository only after the migration and tenant RLS policies are reviewed; prove cross-tenant denial.
4. Connect real CRM audience snapshots to Marketing without accepting browser-forged contacts.
5. Connect genuine saved Content Studio versions and preserve immutable asset IDs.
6. Deploy a reviewed Brevo HTTPS webhook with a strong bearer secret and durable provider-event matching.
7. Prove one controlled delivery only after Mayur authorizes the current Brevo IP and verifies a domain sender.
8. Keep calendar and journey rules as non-executing drafts until a reviewed worker, idempotency policy and verified event source exist.
9. Do not enable WhatsApp, Meta or LinkedIn live execution until identities, destinations, permissions, templates, consent and durable acknowledgements are verified.
10. Update evidence documents with exact commands, status codes and provider evidence. Never turn a mock, queued response or UI label into a delivery claim.

## Acceptance evidence

- `npm test` remains green.
- Authenticated workspace ownership and role checks pass.
- Cross-tenant reads/writes fail.
- One real CRM consented row survives import and reload with provenance.
- One real Content Studio asset version is referenced immutably.
- Durable campaign/task/event/calendar data survives restart.
- Brevo webhook matches a stored provider acknowledgement.
- Any controlled email result is classified separately as accepted, delivered, bounced or not observed.
- No other provider is called during this phase.

Return a table with `VERIFIED`, `PARTIAL`, `BLOCKED` and `NOT RUN`, plus exact evidence and remaining owner.

---
