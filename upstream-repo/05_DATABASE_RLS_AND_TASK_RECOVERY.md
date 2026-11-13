# Database, RLS and task recovery

`workstreams/avinash/frontend/migrations/20261101_marketing_core.sql` defines review-only tables for campaigns, tasks/events, envelopes, audience snapshots, artifact refs, channel versions/approvals, provider metadata, executions/delivery events, conversations/messages, journey rules and calendar events. RLS is enabled for every tenant table.

The owner-specific workspace-membership helper is intentionally not invented. Avinash/Romit must bind policies to their reviewed authenticated membership function before applying the migration. Do not apply this DDL to hosted Supabase without explicit authorization.

`m360-marketing-durable-store.js` provides normalized task, envelope, event, audience, artifact, version, approval, execution, journey and conversation synchronization, restart recovery and idempotency lookup. It is opt-in with `M360_MARKETING_DURABLE_ENABLED=true` and exposes a sanitized readiness result through `GET /api/marketing/durability`. The API fails closed when the credential or schema is rejected. Process memory remains the local preview fast path; disk persistence exists solely when `M360_MARKETING_TEST_STORE_PATH` is explicitly set for isolated tests.

The local preview now sets `M360_MARKETING_LOCAL_STORE_PATH=data/marketing-state.json`. Campaign tasks, their event histories and conversations are written atomically to this gitignored file and reloaded after restart. This is local recovery, not a substitute for multi-instance production storage.

Activation remains `BLOCKED`: the currently configured Supabase service credential returned HTTP 401 during a read-only readiness probe, including for the existing brand-profile table. Keep `M360_MARKETING_DURABLE_ENABLED=false` until the project URL and service credential are corrected and the reviewed migration/RLS policies are applied. Enabling it sooner intentionally makes Marketing writes fail closed.

Rollback: back up authorized staging data, then drop tables in reverse foreign-key dependency order. Production rollback must be owner-reviewed.
