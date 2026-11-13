# Avinash / Romit / Content owner handoff

Avinash review:

- Review Marketing conversations, CSV preview/import, calendar/journey CRUD, SMTP verification/execution and Brevo webhook routes.
- Preserve the now-verified Brevo SMTP authentication path and review the one-address controlled test; next evidence must be sender/IP authorization plus inbox or durable webhook proof, not another unrestricted send.
- Decide canonical deployment wiring for specialist services, CRM staging and the public provider webhook.
- Review the durable repository, migration and readiness route before production activation.

Romit review:

- Connect the implemented workspace-scoped CRM import contract to the authorized staging endpoint with batch IDs, row errors and dedupe.
- Review/apply `workstreams/avinash/crm-backend/20261101_lead_marketing_contacts.sql`, deploy the updated `/workspaces/{workspace}/leads/import` route, then verify one private consented row.
- Provide immutable audience snapshot/task verification contract and consent/suppression provenance.
- Supply the authenticated membership helper used by every RLS policy and a valid service credential/project URL; the currently configured credential returns HTTP 401.

Content owner review:

- Connect the implemented signed specialist-task client to the canonical create/status/result endpoint and immutable asset/version ID contract.
- Provide server-verifiable `Use in Marketing`; no browser assertion is accepted as verification.

Rollback is limited to removing the new routes/client injection/modules and leaving the unapplied SQL file untouched. No hosted state was changed.
