# Matrix360

The current client application lives in `workstreams/avinash/frontend`. This is the source used by local preview and Vercel. Do not serve a static dashboard copy or create another frontend tree.

## Start locally

Run `START_LOCAL_WINDOWS.cmd` from this directory, then open:

http://127.0.0.1:8050/client-dashboard.html?page=dashboard#overview

Node.js 24 is required. Private configuration stays in `workstreams/avinash/frontend/.env.local`. No dependency installation is needed for the local adapter.

## Application source

- `workstreams/avinash/frontend/frontend-source/`: canonical pages, browser scripts, styles, and logos.
- `workstreams/avinash/frontend/api/` and `lib/`: active handlers and shared implementation, including the integrated dashboard.
- `workstreams/avinash/frontend/vercel.json` and `.vercelignore`: Vercel routing, bundles, and deployment allowlist. Deploy from this frontend directory; output directory is `public`.
- `tools/local-preview.cjs` and `tools/local-auto-login.cjs`: local server and loopback-only authorized account access.
- `workstreams/avinash/frontend/tests/`: current regression tests. Run `npm test` from this repository root.

Separate CRM and discovery backend services remain under their workstreams. Their source is not another version of the client application. Existing credentials, local data, migrations, and Git history are preserved.

See [Romit’s integration guide](ROMIT_INTEGRATION_GUIDE_2026-11-03.md) for the delivered functionality, merge dependencies and regression checklist. `REPOSITORY_CLEANUP.md` records historical cleanup scope and verification.
