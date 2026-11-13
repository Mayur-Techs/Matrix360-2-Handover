# Marketing implementation matrix

The referenced 123-item task-register file was not present in the authorized worktree or Downloads search, so individual IDs cannot be truthfully copied. This phase matrix is the evidence-backed substitute pending that file.

| Phase | Status | Evidence | Owner/blocker |
|---|---|---|---|
| Baseline/non-regression | LOCAL_VERIFIED | 91/91 baseline; 109/109 final | Codex |
| Company research/context reuse | ALREADY_PRESENT_LOCAL_VERIFIED | `api/brand.js`, workspace tests | Hosted persistence still owner-controlled |
| Overview → Marketing | LOCAL_VERIFIED | Control Center and Marketing API tests | Authenticated browser sign-in not performed |
| CSV validation/import | LOCAL_VERIFIED / DEPLOY_PENDING | browser preview/import, authenticated CRM batch route, contact/consent migration and compatibility fallback | Deploy CRM route + reviewed SQL to retain contact fields in hosted CRM |
| Synthetic vs self-only datasets | LOCAL_VERIFIED | `test_data`, `outbound_blocked`, blank sample | Mayur supplies private self-only row later |
| Leads/CRM handoff | LOCAL_VERIFIED | campaign creation and refresh query the authorized CRM; showcase uses its own browser-local pipeline | Hosted CRM uptime and deployment |
| Content handoff | LOCAL_VERIFIED / HOSTED_UNVERIFIED | saved poster versions become immutable Marketing refs; text strategy remains available when none exist | Current storage credential must authorize hosted query |
| Ten-channel drafts/versioning/approval | LOCAL_VERIFIED | existing + regression tests | Live AI optional and disabled without approval |
| Monthly calendar and journeys | LOCAL_VERIFIED | ISO dates, timezone, CRUD, counts, bounded draft rules | Journey worker needs reviewed shared DB/runtime |
| Conversations/tasks/events persistence | LOCAL_VERIFIED / HOSTED_UNVERIFIED | atomic gitignored local recovery plus normalized Supabase repository/migration | Avinash/Romit review and hosted RLS apply |
| Brevo email adapter | LIVE_AUTH_VERIFIED / DELIVERY_UNVERIFIED | SMTP authentication succeeds; execution, exact approval, allowlist and cap tests pass; one local execution records provider acceptance | Authorize the current IP, verify a domain sender, then prove delivery/webhook evidence with one controlled test |
| WhatsApp/Meta/LinkedIn adapters | MOCK_TESTED | injected provider response tests | Live execution intentionally disabled |
| Live outbound/provider receipts | PARTIAL | one Brevo SMTP execution was accepted by the provider, but no inbox receipt or durable delivery webhook is verified | Mayur controlled self-test and Avinash/Romit durable webhook deployment |

When the task register is supplied, map its 123 IDs to this evidence; do not bulk-mark them complete.
