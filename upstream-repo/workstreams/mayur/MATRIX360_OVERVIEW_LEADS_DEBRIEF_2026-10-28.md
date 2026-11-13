# Matrix360 Overview and Lead Engines — Mayur Continuation Debrief

Date: 2026-10-28  
Worktree: `E:\Matrixrom\romithandoverwithoverviewagentunfinished1\romit-acceptance-20261027 copy for anti gravity`  
Requested branch: `codex/romit/local-website-login-recovery-20261027`  
Frontend root: `workstreams/avinash/frontend`

## Goal

Continue and verify the Matrix360 local Overview assistant and unified lead-generation flow.

User acceptance requirements:

1. Clarification requests appear as separate, fillable question bubbles.
2. The assistant responds briefly and adapts its format to the request.
3. Engine delegation tells the client where work is running and what to do next.
4. Overview shows working, progress, completion, and failure states.
5. Lead generation stops at the requested count. The default is 10 when no count is supplied.
6. Only the top navigation remains. The left navigation is hidden.
7. Website and Maps lead engines start reliably from an authorized Overview request.

## Current implementation

### Overview UI

`workstreams/avinash/frontend/lib/m360-control-client.js`

- Renders concise, adaptive responses instead of every schema field.
- Displays delegation details, an engine link, progress, and completion toasts.
- Displays a loading spinner while an engine is working.
- Renders each missing-information item as a labelled, required text input.
- The Continue button appends the answers to the original request and resubmits it.
- Uses DOM `textContent` for model output.
- Removes `#m360-sidebar-mp-nav` and hides `.workspace-nav`.
- Starts lead generation only for an explicit lead-engine handover.

### Control Center response policy

`workstreams/avinash/frontend/api/control-center.js`

- Direct execution requests receive only status, destination, next action, and readiness details.
- Strategy requests can still return recommendations, options, and rationale.
- Clarification and unsupported responses never become executable handovers.

### Browser lead subagent

`workstreams/avinash/frontend/lib/m360-unified-leads-subagent.js`

- Tracks the requested target count.
- Shows `found / target` progress.
- Caps displayed and saved results at the target.
- Preserves partial results when one engine fails.

### Server lead orchestrator

`workstreams/avinash/frontend/lib/m360-leads-orchestrator-server.js`

- Parses numeric and written counts such as `3`, `three`, and `twenty-five`.
- Defaults to 10 and clamps the target to 1–2,000.
- Sends the target to both engines.
- Caps merged results at the target.
- Stops the Maps engine when the target is reached.
- Returns `target_limit` and `target_reached` to the browser.
- Preserves per-engine error states and partial results.

## Latest failure and fix

Observed failure:

- Maps: `[ENGINE_TIMEOUT] Request timed out after 20000ms.`
- Website: `[HTTP_401_UNAUTHORIZED] Authentication required`

Root causes and changes:

- The Website bootstrap response sets both a bearer token and an HTTP session cookie. The orchestrator forwarded only the bearer token. It now forwards the first session-cookie pair server-side with the bearer token.
- The Maps start call used a 20-second timeout. It now allows 55 seconds for Render cold start.
- Website bootstrap allows 45 seconds. Website campaign start allows 30 seconds after bootstrap warms the service.
- Authentication values are never returned to the browser or written to logs.

The authentication contract was checked with a bootstrap-only request. The response returned HTTP 200, a token field, and a `Set-Cookie` header. No token or cookie value was printed. No campaign was started during verification.

## Verification completed

Run from `workstreams/avinash/frontend` or adjust paths from the repository root:

```powershell
node --check lib/m360-leads-orchestrator-server.js
node --test tests/leads-orchestrator.test.js tests/control-center.test.js
```

Latest result:

```text
tests 29
pass 29
fail 0
```

Tests cover count parsing, default count, target capping, Maps stop, Website bearer and cookie forwarding, safe UI rendering, clarification controls, route policy, isolation, partial results, malformed responses, and sanitized diagnostics.

## Local start and refresh

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "workstreams/romit/vercel-recovery/dpl_AiuAnMhU3n4YxdKLfMJ8odoYDtEn/start-exact-local.ps1"
```

Wait for:

```text
Ready! Available at http://127.0.0.1:8000
```

Open:

```text
http://127.0.0.1:8000/login.html
```

Use an existing authorized Matrix360 CRM account. Refresh with `Ctrl+F5` after source edits.

`workstreams/romit/LOCAL_DEVELOPMENT.md` still contains older port-8010 text. The current approved launcher and acceptance URL use port 8000.

## Required next checks

1. Start the exact local launcher and sign in with an authorized CRM account.
2. Confirm clarification questions render as separate bubbles on desktop and mobile widths.
3. Submit one approved, low-count lead request, such as three leads, only when live-scraper execution is explicitly authorized.
4. Confirm Website no longer returns HTTP 401.
5. Confirm Maps survives a Render cold start without exceeding 55 seconds.
6. Confirm both engines receive the requested target.
7. Confirm Overview and Leads & Pipeline show consistent progress.
8. Confirm generation stops and results cap at the target.
9. Confirm the completion toast appears and the engine link opens the correct page.
10. Confirm no left navigation returns after route changes, browser Back, or `Ctrl+F5`.

## Known risks

- No live lead campaign was run after the authentication fix because live scraping was explicitly prohibited during this work.
- The Website service has no documented cancellation endpoint. The requested count is sent to it and returned results are capped, but remote work depends on that service honoring `max_results`.
- Vercel dev logs repeatedly showed `PATH TO REGEXP ERROR` for `:path*` and occasional libuv `UV_HANDLE_CLOSING` assertions. The server stayed available, but Mayur should investigate if routing or hot reload becomes unstable.
- Git commands do not work in this copied worktree because its `.git` file points to a missing external `D:` git directory. Do not repair, rewrite, push, merge, or infer branch state without repository-owner direction.
- External engine uptime and Render cold-start behavior remain environment-dependent.

## Safety and scope

- Do not print or package `.env.local` values.
- Do not package `.vercel`, CRM sessions, cookies, tokens, lead exports, or private customer data.
- Do not use `workstreams/avinash/frontend/tools/run_synthetic_demo.py`.
- Do not use a Python static server.
- Do not use port 8010 for this acceptance flow.
- Do not deploy, push, merge, change GitHub/Vercel connections, or run a live scraper without explicit authorization.
- Keep implementation edits under `workstreams/avinash/frontend/`.

## Bundle contents

The companion ZIP preserves repository-relative paths for:

- this debrief;
- the six changed implementation and test files;
- the verified local-development document and exact launcher;
- the two user-provided failure screenshots.

The ZIP contains no environment file or credential.
