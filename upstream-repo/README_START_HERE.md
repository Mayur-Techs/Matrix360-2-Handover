# Matrix360 local setup

This repository is a multi-workstream checkout. The current Matrix360 web application is in `workstreams/avinash/frontend`; unrelated workstreams remain independent.

## Prerequisites

- Node.js 24.x and npm.
- An authorized Matrix360 CRM test account.
- Authorized hosted-service configuration supplied privately by the service owners.

The local adapter has no npm package dependencies, so no `npm install` is required. Do not commit `.env.local`.

## Environment

Copy `workstreams/avinash/frontend/.env.example` to `workstreams/avinash/frontend/.env.local` and fill only the integrations you are authorized to use.

For normal login, keep both settings false:

```dotenv
M360_SHOWCASE_ENABLED=false
M360_SHOWCASE_LIVE_ENABLED=false
```

Normal CRM login requires the existing authorized `M360_ROMIT_ORIGINAL_SCRAPER_PREVIEW_KEY`. The gateway fails closed with HTTP 503 when it is missing or invalid. OpenAI and media generation remain hosted, opt-in integrations and require their documented keys, models, enablement and spend-approval settings. Maps, Website, CRM, Supabase, reel and social integrations also remain hosted; the local adapter does not make the application offline or standalone.

- Local public pages and the sign-in form require no secret.
- Authenticated CRM access requires `M360_ROMIT_ORIGINAL_SCRAPER_PREVIEW_KEY` and an existing authorized account.
- Control Center/OpenAI features additionally use `M360_CONTROL_CENTER_ENABLED`, `M360_CONTROL_CENTER_MODEL`, `OPENAI_API_KEY`, the selected model variables and explicit spend approval where the handler requires it.
- Supabase/CRM persistence uses the existing authorized `M360_AI_TRIAL_SUPABASE_SERVICE_KEY` and `M360_CRM_DEV_PUBLISHABLE_KEY` configuration.
- Maps, Website, reel, social and FFmpeg workers are optional hosted integrations represented by the matching URL/key variables in `.env.example`.
- Document qualification is optional and uses the `MATRIX360_ENGINE_*` variables plus `MATRIX360_CRM_API_URL`.

## Start and stop

From the repository root:

```powershell
npm start
```

Open <http://127.0.0.1:8000/login.html>. Stop the server with `Ctrl+C` in the same terminal.

If port 8000 is occupied, inspect its owner and choose another local port; do not terminate an unrelated process:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen
$env:PORT='8020'
npm start
```

The adapter binds only to `127.0.0.1`. `START_LOCAL_WINDOWS.cmd` provides the same launcher on Windows.

## Tests

```powershell
npm test
```

These tests use mocked integrations. Passing tests and a visible login page do not prove real-account login, hosted-service parity, paid generation, live scraping, publication or production readiness.

## Troubleshooting

- `Port is in use`: set `PORT` to a free local port.
- HTTP 503 during login: provide the authorized CRM preview key in `.env.local`.
- Hosted feature unavailable: compare the required variable names in `.env.example` with the service owner's authorized configuration.
- After server-side JavaScript changes, restart `npm start`. Page assets are read from disk; refresh the browser with `Ctrl+F5`.

Do not enable showcase/private-presenter modes, bypass login or workspace authorization, create credentials, migrate databases, or change hosted permissions as part of local setup.
