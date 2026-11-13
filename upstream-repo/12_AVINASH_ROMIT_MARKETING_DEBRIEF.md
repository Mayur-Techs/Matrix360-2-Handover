# Matrix360 Marketing debrief for Avinash and Romit

Date: 2026-11-01
Target branch: `work/mayur`

## Outcome

The first acceptance milestone is implemented locally: a campaign can originate in Overview or directly in Marketing, reuse Company Details, assemble a reviewable strategy and ten channel drafts, refresh Leads/Content dependencies, place campaign events on a real calendar, revise and approve exact channel versions, and prepare a controlled email test without requiring unrestricted provider access.

The software is ready for review and isolated local demonstration. It is not approved for production bulk sending or live social publishing.

## Feature summary

| Area | Current state |
|---|---|
| Company Details reuse | Local verified |
| Overview-to-Marketing envelope | Local verified |
| Standalone Marketing conversation | Local verified; maximum six essential questions |
| Grounded Marketing AI | Local live AI evidence recorded with approved company context |
| Ten channel drafts | Local verified |
| Active-channel AI revision | Local verified; other channel hashes preserved |
| Exact-hash approval and history | Local verified |
| Safe non-sending previews | Local verified |
| CRM audience refresh | Showcase verified; hosted production verification pending |
| CSV preview/import | Local verified; hosted contact/consent migration pending |
| Content Studio references | Contract/mock verified; genuine hosted retrieval pending |
| Calendar CRUD and counts | Local verified |
| Journey rule CRUD | Local verified as drafts; no execution worker |
| Local recovery | Verified through ignored atomic JSON state |
| Shared Supabase durability | Implemented, disabled pending migration/RLS review |
| Brevo SMTP authentication | Verified connected |
| Brevo controlled execution | One local provider-accepted execution recorded; delivery unverified |
| WhatsApp/Meta/LinkedIn | Adapter contracts mock-tested; live disabled |
| Browser QA | Dark guided workflow, no final console errors |
| Automated regression | 109 passed, 0 failed |

## Email safety boundary

The committed code deliberately keeps these controls:

- approved current Email version/hash;
- explicit operator action;
- server-side recipient allowlist;
- positive recipient limit;
- positive per-campaign message cap;
- deterministic idempotency key;
- consent, unsubscribe, suppression, do-not-contact and revocation checks for production audiences;
- synthetic audience block;
- verified SMTP connection;
- provider acceptance recorded separately from delivery.

The controlled showcase test bypasses CRM consent only for the one explicitly entered, server-allowlisted self-test address. It does not bypass the allowlist, cap, draft approval or provider verification. The bulk signed-in route retains the explicit approval phrase.

An intermediate diagnostic changed the allowlist to `*`, the recipient limit to 1,000, zero to unlimited and added timestamp entropy to idempotency. Those unsafe changes were not accepted for publication; the strict controls above were restored.

## Deliverability note

Brevo SMTP now authenticates successfully and an earlier request received provider acceptance. Mayur did not observe inbox delivery. Do not attribute this to one unverified cause. Before another controlled test:

1. authorize the current public IP in Brevo;
2. verify a sender on a business-owned domain;
3. configure SPF/DKIM/DMARC for that domain;
4. keep the recipient and message cap at one;
5. register the durable webhook only after the shared store is ready;
6. classify the result from provider evidence and inbox observation.

## Main implementation locations

- `workstreams/avinash/frontend/api/marketing.js`
- `workstreams/avinash/frontend/lib/m360-marketing-orchestrator.js`
- `workstreams/avinash/frontend/lib/m360-marketing-client.browser.js`
- `workstreams/avinash/frontend/lib/m360-channel-versioner.js`
- `workstreams/avinash/frontend/lib/m360-channel-readiness.js`
- `workstreams/avinash/frontend/lib/m360-marketing-calendar.js`
- `workstreams/avinash/frontend/lib/m360-marketing-journeys.js`
- `workstreams/avinash/frontend/lib/m360-marketing-durable-store.js`
- `workstreams/avinash/frontend/lib/m360-csv-import.js`
- `workstreams/avinash/frontend/lib/m360-crm-import-client.js`
- `workstreams/avinash/frontend/lib/m360-content-assets-client.js`
- `workstreams/avinash/frontend/lib/m360-provider-adapters.js`
- `workstreams/avinash/frontend/lib/m360-smtp-client.js`
- `workstreams/avinash/frontend/contracts/`
- `workstreams/avinash/frontend/migrations/`
- `workstreams/avinash/crm-backend/20261101_lead_marketing_contacts.sql`

## Avinash decisions required

- Approve the canonical hosted deployment paths for Marketing, CRM import, Content tasks and provider webhooks.
- Review provider execution boundaries and keep non-email channels disabled until account permissions are available.
- Review the public HTTPS webhook deployment and secret-management mechanism.
- Decide whether this branch should enter `main` through a pull request after Romit's database/RLS review.

## Romit work required

- Review/apply the CRM contact and consent migration.
- Deploy the authenticated batch import route and verify retained fields.
- Review/apply Marketing Supabase migrations and tenant RLS.
- Verify local-to-hosted task, conversation, event, approval, execution and calendar persistence.
- Connect immutable CRM audience and Content Studio artifact contracts.
- Prove webhook matching and restart recovery.
- Record exact evidence without sending additional campaigns unless Mayur authorizes the action.

## Runbook

```powershell
git switch work/mayur
npm test
$env:PORT = '8050'
npm start
```

Open `http://127.0.0.1:8050/client-dashboard.html#marketing`.

Secrets remain only in the ignored `workstreams/avinash/frontend/.env.local`. Copy required names from `.env.example`; never copy values from Mayur's machine or commit local Marketing state.

## Release position

`LOCAL_MILESTONE_VERIFIED` for campaign preparation and controlled provider testing.
`NOT_READY_REMEDIATION_REQUIRED` for production bulk email, automated journeys, social publishing and verified delivery analytics.
