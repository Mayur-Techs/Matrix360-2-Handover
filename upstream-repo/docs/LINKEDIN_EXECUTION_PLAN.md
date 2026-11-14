# LinkedIn Campaigns & Publishing — execution plan

Scope: the active Mayur handoff, November 13, 2026. Implement LinkedIn only. WhatsApp and email behavior, configuration and tests are reference material and must remain unchanged.

## Findings and architecture

- This handoff is a filesystem snapshot without Git metadata. The serving application is Node 24/CommonJS, with a CRM membership API and Supabase persistence. The Python project label does not describe this UI service.
- Existing LinkedIn code accepts a manually pasted token and has no OAuth, per-member grants, media processing or durable publication executor. Existing calendar entries are metadata; the execution function rejects LinkedIn.
- No accepted Postiz installation exists in this handoff. Add a native LinkedIn adapter behind the existing Marketing UI, using the existing Supabase REST architecture. A separate durable LinkedIn jobs table adds the missing executor; it does not compete with an existing social scheduler. SQLite provides real local durable execution and tests on Node 24.
- Reuse CRM memberships, Brand Profile, Content Studio saved versions and the configured AI provider. Do not introduce another social platform, paid service or fictitious provider success.

## Milestones and checks

1. [done locally] Inspected source and attachments, verified provider APIs and package reuse. Source links and access requirements are recorded.
2. [done locally] OAuth, encrypted independent grants, destinations, tenant-scoped persistence and capability matrix implemented; replay, workspace binding, expiry and isolation tested with declared provider mocks.
3. [done locally] Composer, actual-byte assets, AI preparation/revisions, campaign history, configurable review rules, durable jobs and worker implemented; restart, concurrent claims, cancellation, unknown outcomes and partial failures tested.
4. [done locally] Marketing UI/OAuth return/results/analytics integrated. Browser fixtures and actual unauthenticated local-server smoke verified. Existing email/WhatsApp paths preserved.
5. [done] Setup, migration, deployment, permissions and exact live acceptance documented. SQL tested on embedded PostgreSQL; hosted deployment and real account acceptance remain pending external configuration/authorization.

## Guardrail inventory presented before implementation

`LINKEDIN_SAFETY_GUARDRAILS=true` controls optional exact-content approval and media-rights acknowledgement. The user explicitly chose **false** on November 14: authorized users can schedule their saved content directly. No recipient opt-in list is required for organic public posts.

Required integration invariants remain separate: Matrix360 membership/roles, LinkedIn OAuth consent and granted scopes, actual Page authority, tenant ownership, protected tokens, OAuth replay protection, valid media, publication deduplication and truthful outcome recording. Disabling these would break the integration or expose another client's data; the switch cannot grant LinkedIn permissions.

Unsupported provider capabilities are unavailable, not hidden consent gates: unattended invitations/DMs, unentitled Lead Sync, Ads spending and native newsletter creation. LinkedIn engagement data is not imported as CRM prospects or passed to generative AI. AI preparation uses the client's supplied objective, saved brand facts and chosen content.

## Blast radius

New LinkedIn API/provider/store/service/browser modules, LinkedIn tests, migration, worker, documentation and LinkedIn env entries. Shared edits limited to LinkedIn entry points, script routing and loading. No email/WhatsApp provider or campaign fixes. No deployment, shared-database migration, paid generation or public publication performed by this task without appropriate existing authorization.

## Evidence ledger

See `LINKEDIN_IMPLEMENTATION_REPORT.md` for the final verification ledger, changed files and explicit gap register. Live access depends on the actual LinkedIn app's enabled products, client credentials, callback registration and an authorized account holder. Local tests cannot supply that evidence.
