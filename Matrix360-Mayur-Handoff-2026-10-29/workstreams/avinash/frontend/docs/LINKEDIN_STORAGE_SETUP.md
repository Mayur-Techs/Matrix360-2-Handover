# LinkedIn persistence and worker hosting

The LinkedIn store is separate from Email and WhatsApp. No existing campaign table or provider configuration changes.

## Local / persistent Node host

Node 24 supplies SQLite. `LINKEDIN_STORE_BACKEND=sqlite` uses `data/linkedin.sqlite` at the handoff root by default, outside the served frontend. Set `LINKEDIN_SQLITE_PATH` to an absolute path on a persistent private volume for another host. Back up the SQLite database with its WAL through a SQLite-aware backup or after stopping the worker. Never place this database under a public asset directory. Local migrations run idempotently when the store opens.

SQLite and its worker must share one persistent volume on one machine. Do not use independent replica-local SQLite files. The store rejects SQLite on Vercel unless an operator explicitly supplies `LINKEDIN_DURABLE_SQLITE_RUNTIME=true`; ordinary Vercel functions do not supply that durable volume.

## Hosted SaaS / Vercel

1. Use `LINKEDIN_STORE_BACKEND=supabase` (the default on Vercel).
2. Apply `migrations/20261114_linkedin.sql` to the intended Supabase PostgreSQL database using its administrator SQL interface. This creates only the three `m360_linkedin_*` tables, their index and seven RPC functions, in one transaction.
3. Configure `LINKEDIN_SUPABASE_URL` and `LINKEDIN_SUPABASE_SERVICE_KEY`, or reuse the existing `M360_MARKETING_SUPABASE_URL` and `M360_AI_TRIAL_SUPABASE_SERVICE_KEY`. Keys stay server-side. The current existing project URL is the fallback; set the URL explicitly for another database.
4. Schedule the LinkedIn worker in the same environment. A Vercel request alone does not constitute a persistent scheduler. The API/worker setup guide supplies its entry point and authentication configuration.
5. Run two-tenant and two-worker acceptance against an isolated staging database before connecting real clients. The local SQLite tests and mocked REST contract tests do not prove a hosted migration or deployment.

RLS is enabled without browser policies. Anonymous/authenticated roles cannot read or mutate these tables or execute their RPCs. Server-side service-role access is intentional; every application request must first authorize the Matrix360 workspace. The RPCs keep workspace IDs in every record/job key. Claiming is the service-only worker operation across tenants, using `FOR UPDATE SKIP LOCKED`.

## Execution semantics

Jobs are unique by workspace and job ID. Preparation claims use a lease. An expired `leased` job may be reclaimed. The worker must atomically change the job to `dispatching` with its valid lease token immediately before sending a post. An expired `dispatching` job becomes `unknown`; it is not retried. A provider timeout after dispatch follows the same rule. Reconciliation must establish the actual outcome before any new publication is authorized.

Cancellation can win while queued or leased. Once dispatch starts cancellation is rejected. Completion from a stale worker token is rejected. A completed destination remains completed while another destination waits for a retry. Optimistic record revisions prevent silent campaign edits from overwriting another editor's changes. An explicit HTTP 429 provider rejection can return to the queue only with the active worker lease and the internal `providerRejected` marker; a timeout or unknown outcome cannot use that path.

## Migration rollback

The store's `cleanup({now, workspace})` deletes expired OAuth states, expired unfinished uploads, and chunks with no live upload or saved asset. It replaces organization Page names older than 56 days with their URN and marks the profile expired, and removes analytics older than 365 days. Omit `workspace` only in the server worker for global cleanup. Saved asset chunks and campaign/publication evidence are retained. This method must be invoked by the worker or a maintenance task to enforce expiry storage cleanup. Refreshing destination discovery retrieves current Page details again.

Before rollback, stop only the LinkedIn worker and disconnect the LinkedIn route. Export/back up the three LinkedIn tables. Dropping these tables/functions is destructive and is not part of this implementation. Existing Email/WhatsApp tables are unaffected. A transaction failure while initially applying this migration rolls back its changes.

Status: SQLite creation and local restart/concurrency tests are automated. The actual PostgreSQL migration was also applied twice and its RPCs exercised locally on PostgreSQL 18.6 through PGlite 0.5.16: 13 grouped checks passed. This includes tenant keys, optimistic updates, OAuth state, lease transitions, cancellation, explicit-rejection retry, cleanup, RPC grants, and anonymous/authenticated RLS denial. Hosted migration, Supabase PostgREST integration, multi-process PostgreSQL lock contention, and deployment require verification in the actual target environment.

## Reproduce the isolated PostgreSQL check

The dev-only harness is `qa/linkedin-postgres-check.cjs` at the handoff root. It uses [PGlite's documented in-memory PostgreSQL API](https://pglite.dev/docs/), from the [official Electric repository](https://github.com/electric-sql/pglite). Version 0.5.16 is Apache-2.0. It is deliberately absent from application dependencies.

From PowerShell, install the pinned package into a temporary directory, then run the harness from the handoff root:

```powershell
npm install --prefix "$env:TEMP\matrix360-linkedin-pglite-0.5.16" --no-save --no-package-lock --ignore-scripts --audit=false --fund=false @electric-sql/pglite@0.5.16
node qa/linkedin-postgres-check.cjs
```

The harness creates an in-memory database and fixture roles only; it does not read credentials or contact Supabase. `PGLITE_PACKAGE_PATH` can point to the installed package when the runner uses a different temporary directory. The Codex sandbox and escalated runner on this Windows host have different temp roots; installation and execution used the same runner. The check prints its actual engine version and individual results.
