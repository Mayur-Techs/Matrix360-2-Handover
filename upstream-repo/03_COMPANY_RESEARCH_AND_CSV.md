# Company research and CSV

Company Details already validates HTTPS URLs, blocks credentials/private networks, extracts same-site evidence, labels researched facts, and stores reviewed context only through the configured workspace store. Marketing reads the resulting workspace context through the server.

CSV contract:

- Maximum 2,000 rows and 1 MB in the browser.
- Required: `name` or `company`.
- Optional: `email`, `phone`, `source`, channel consent flags, `consent_source` and `consent_captured_at`.
- Quoted fields supported; phone leading zeroes preserved; invalid rows and duplicates get row-level errors.
- Preview remains intentionally test-only. Every preview row has `test_data=true`, `outbound_blocked=true`; consent text is not converted into evidence.
- Production staging uses `POST /api/marketing/csv-import`. It calls the configured staging URL or the tenant-scoped CRM batch route. The included CRM migration retains email, phone, suppression and consent evidence with a workspace-scoped dedupe key.
- Sample file contains `.invalid` email and synthetic identity only.
- A real self-test template is the same header with no populated personal row. Mayur enters one private authorized contact only during a later controlled test.

Deployment requirement: apply `workstreams/avinash/crm-backend/20261101_lead_marketing_contacts.sql`, review existing RLS, then deploy the updated CRM backend. Until that happens the compatibility fallback imports lead names/stages but explicitly reports that contact fields were not retained.
