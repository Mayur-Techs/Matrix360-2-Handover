## Current Preview

Preview deployed at the user’s request on 2026-10-28:
https://matrix360frontend-4dd8vk0jc-matrix360s-projects.vercel.app/dashboard

Deployment ID: dpl_5sMyWR19y31z7hAgM8EK4r4hpQn8. Vercel state: READY. Fresh Preview build with --force and no --with-cache. Production unchanged. Vercel Authentication remains enabled; browser review requires Vercel sign-in and the existing Matrix360 login.

The first attempt failed because the project had 13 serverless function files on Hobby (limit 12). Resolved by moving unchanged api/preview-original.js to lib/m360-preview-original.js, updating maps-js-overlay.js to import it, and preserving /api/preview-original through a rewrite and the existing creative-integrated dispatcher. All public API routes remain available. Backups are under artifacts/control-center-backup-20261028 with .before-hobby-fix suffixes.

Verification: all 12 automated test groups passed; additional checks passed for the 12-function budget, preserved archive route, POST rejection and traversal rejection. Authenticated Vercel curl confirmed the deployed dashboard includes the Control Center and the deployed browser script compiles. The browser opened the protected Preview and showed Vercel login. Real authenticated Matrix360 regression checks remain pending. Earlier no-deployment statements below describe the pre-deployment stages.

---

# Matrix360 AI Control Center implementation handoff

Date: 2026-10-28
Deployment: none. Production and Preview were not deployed. Git metadata and history were not changed.

## Files changed

- `api/control-center.js`: hardened existing Responses API endpoint; requires its own model configuration; validates the complete model response; allowlists engine routes; forces approval and draft status; rejects missing workspace selection; bounds context; removes provider error details; adds prompt injection rules. Reuses the existing CRM membership pattern. Corrects the optional brand profile host to the host already used by `api/ai-post.js`.
- `api/product-ui.js`: serves the isolated Control Center client through `?mode=control`.
- `api/creative-integrated.js`: injects that client on dashboard responses only.
- `lib/m360-control-contract.js`: dependency-free recursive schema validation and fixed engine routes.
- `lib/m360-control-client.js`: prominent Overview panel, suggested prompts, analysis status, structured strategy output, ordered workflow, reviewable envelope, and existing specialist navigation. Uses textContent for model output. Keeps drafts only in page memory, clears on workspace/session changes, and ignores stale responses.
- `lib/m360-nav-fix.js`: repaired malformed string encoding in the existing embedded router while preserving the original navigation prefix. Backup: `artifacts/control-center-backup-20261028/m360-nav-fix.before-repair.js`.
- `tests/control-center.test.js`: mocked endpoint, client-source, and product asset compilation checks.
- `../tools/control-center-preview.cjs`: explicit offline fixture server, bound to 127.0.0.1:4317; requires `--fixtures`. It uses synthetic data and never calls OpenAI or engine services. This tool is outside the deployment root.
- `CONTROL_CENTER_HANDOFF.md`: this report.

Existing-file backups: repository root `artifacts/control-center-backup-20261028/`. Never deploy this directory.

## Verified sources and boundaries

Dashboard responses: `api/creative-integrated.js` delegates to `api/preview.js`, which loads the existing uploaded archive. Local `lib/m360-multipage-router.js` organizes the Overview and engine pages. New panel mounts immediately after `m360-mp-topbar` with 62vh desktop minimum height.

Session token: existing `matrix360_pilot_token` and expiry in sessionStorage. Server verifies the bearer against CRM `/me/workspaces`. Browser workspace selection is an untrusted selector and must match that authenticated membership list. Prompt/body tenant and user identifiers are not used. CRM membership does not establish a verified user ID; envelope user_id is explicitly null. Tenant ID is a workspace-derived namespace, not a separate tenant record. These drafts must not be promoted into executable tasks without canonical identity resolution.

Existing OpenAI pattern: `api/ai-post.js` uses server fetch, Responses API, strict JSON Schema, signed creative approval, and durable creative quota. Existing creative contracts were not edited.

No common specialist task creation/status API was found. Existing scraper, creative, reel and marketing functions are separate capabilities, not a verified common supervisor task interface. Handover is draft-only: review preserves context in page memory, then opens the existing engine using its router control. Reviewed context now remains visible in a draft panel on the selected engine page. A keyboard-operable selection control supports copying it into the engine prompt. The request ID is displayed as the safe task reference. Nothing is queued, run, published or marked completed. Refresh loses draft. Running/completed state integration and persistent memory remain later work.

A concurrent edit introduced a Control Center into the router during inspection. Router file was not overwritten. Isolated client hides that duplicate `.m360cc-wrap` while preserving existing engine cards. Further inspection found malformed string encoding in `lib/m360-nav-fix.js`, which prevented `api/product-ui.js` from loading. The valid original navigation prefix was preserved and the canonical local router was serialized correctly into the existing exported client. The redundant dynamic router loader was removed; the embedded router remains guarded against duplicate initialization. Product asset smoke tests now compile every generated browser script and load the endpoint. Browser integration still requires verification.

## Verification

Executed:

`node --test workstreams/avinash/frontend/tests/control-center.test.js`

Result: 12 test groups passed, 0 failed (latest run).

Covered with mocked network services: missing/invalid session, unauthorized workspace, missing workspace, tenant spoofing text does not change envelope identity, no model tools, system safety instruction presence, missing key, missing dedicated model despite legacy fallback variable, timeout, malformed schema, provider rate limit, fixed routes despite malicious model route, forced approval, draft status, literal HTML text, store:false, prompt length, repeated requests, client cleanup and stale-workspace guards.

Syntax checked: endpoint, contract, generated client, product-ui and creative-integrated.

Executed after Vercel login: five live OpenAI semantic routing cases using explicitly synthetic business context, plus browser fixture checks for desktop/tablet/mobile, keyboard focus, review, specialist navigation, workspace clearing, stale responses, sign-out/Back visibility, escaped HTML, invalid responses and provider throttling. Browser logs returned no captured error entries in this fixture run. Not executed: live-model injection resistance; reviewer usefulness scoring; actual brand-profile read; real authenticated login/logout/Back and engine regressions against the deployed dashboard. No real test account was used. Fixture checks do not establish deployed authentication correctness or overall pilot reliability.

Live routing matrix: passed all five cases with gpt-4.1-mini and synthetic acceptance context after correcting campaign over-routing. The initial run passed four of five; both reports are retained under artifacts/control-center-verification/. This small sample is not a statistical routing reliability claim.

| Request | Expected |
| --- | --- |
| Find manufacturers in Pune. | Lead Generation & Pipeline |
| Create a Diwali campaign for our residential project. | Content Creation |
| Plan WhatsApp and LinkedIn outreach. | Marketing Activation |
| Which market should we enter next? | Business strategy |
| Find prospects, create a campaign and plan outreach. | Ordered lead, content, marketing workflow |

Existing login/logout, session cleanup, CRM proxy, routes, engine APIs, brand writes and storage behavior were not modified. Runtime regression behavior remains unverified. The existing direct login redirect patch in `api/preview.js` was preserved.

## Configuration and remaining work

Set securely in local environment and later Vercel Preview settings:

- `OPENAI_API_KEY`
- `M360_CONTROL_CENTER_MODEL`: explicitly chosen Responses API model supporting strict structured outputs.
- `M360_CONTROL_CENTER_ENABLED=true`

Do not paste credentials into chat. Optional existing brand service configuration remains server-side. No secrets were read into output, added, or changed. Two five-case live acceptance passes used the approved existing model and an existing local key made available to the Vercel subprocess. Preview Secret values were not pulled or printed. The separate offline fixture server uses a synthetic non-secret key and never calls OpenAI.

Rate limiting is best-effort per bearer session per warm function instance: 20 requests/minute. It is not distributed or a durable spend cap; upgrade to shared authenticated-user/tenant quotas before wider rollout. No server conversation memory is implemented; each request is independent. Approved facts are drawn only from authorized workspace/profile data; current pipeline state is unavailable to this endpoint. Only model fact strings that exactly match trusted approved workspace/profile facts receive the verified label. Other asserted facts move to assumptions as unverified AI inferences. Free-text answers and recommendations still require human review. The model is instructed not to claim execution; free-text behavioral compliance still requires live evaluation.

Director selected the existing text model. Preview is now configured with M360_CONTROL_CENTER_MODEL=gpt-4.1-mini and M360_CONTROL_CENTER_ENABLED=true. OPENAI_API_KEY was already configured and was not replaced. Production configuration was not changed. Remaining Director action: provide an authenticated test session for deployed regression checks and explicitly approve Preview deployment when ready. Canonical user/tenant resolution and common task APIs are required before operational handover. Preview deployment requires explicit approval and must use only `workstreams/avinash/frontend`; never `--prod`.

OpenAI implementation reference: https://developers.openai.com/api/docs/guides/structured-outputs


## Continuation improvements

- Reviewed handover remains available on the selected engine page, without browser storage or automatic execution. Draft discard, Overview return, expiration checks, pageshow/hash/visibility handling, and stale response guards preserve privacy across navigation and session changes.
- The envelope retains the exact original request, the complete ordered workflow, and expected outputs.
- Verified facts are restricted to exact approved source facts. Model-only claims are labeled unverified AI inferences.
- In-memory throttle state is bounded at 1,000 active session entries and fails closed at capacity. The existing limit remains 20 requests/minute per bearer per warm instance.
- Audit events contain request identifiers and numeric token counts only. They exclude prompts, client context, bearer tokens, keys, and provider error bodies.
- Added checks for all three specialist route mappings, strategy responses, missing fields/types, invalid workflow order, clarification/unsupported handover prevention, exact request retention, source-bound facts, audit privacy, and all served JavaScript modes.

The semantic routing matrix now passes with the live configured model against synthetic context. Contract and browser fixture tests complement these checks. No Preview or Production deployment occurred.


## Vercel authentication and verification continuation

- CLI login verified as `matrixdigitalai-4176`.
- Linked project verified: `matrix360s-projects/matrix360_frontend`, ID `prj_CVywrCPPNiBprpn2uS3uDmrXUhvB`.
- Preview settings added as Config: `M360_CONTROL_CENTER_MODEL=gpt-4.1-mini`, `M360_CONTROL_CENTER_ENABLED=true`. Production settings and API keys were not changed.
- A fresh Preview deployment without build-cache reuse is required for the updated settings and source. Explicit deployment approval is still required by the original directive.
- Added `../tools/control-center-live-check.cjs`: explicit `--live` probe, five bounded provider calls, synthetic CRM membership/context only, fixed provider destination, and no specialist execution. It lives outside the deployment root and is never an application auth substitute.
- Tightened supervisor instructions after the model added downstream engines to a content-only campaign request. The repeated five-case matrix passed 5/5; multi-engine order was verified and all envelopes remained drafts with approval required.
- Added dashboard integration tests confirming that Control Center injection occurs only in dashboard GET responses, preserves existing markup, follows navigation script loading, and is absent from login/public pages and HEAD responses.
- Browser fixture checked widths 390, 768 and 1440; no horizontal overflow was observed. At 1440x1000, initial Control Center height was approximately 730px with its top at 202px in the fixture. The fixture includes a prominent synthetic-data banner and does not reproduce all deployed sidebar/auth behavior.
- Keyboard Tab from the prompt focused Analyse & Route with a solid visible focus outline. Review opened the existing specialist route and retained the exact draft context. Workspace changes removed drafts and late responses did not repopulate output. Ending the fixture session and using Browser Back kept the panel hidden.
- HTML supplied in fixture model output produced no image/script elements. Invalid structured output and provider 429 responses displayed controlled blocked states.
- Evidence: `artifacts/control-center-verification/desktop-initial.png`, `mobile-initial.png`, `desktop-fixture.png`, `live-routing.json`, `live-routing-before-routing-fix.json`, `browser-verification.json`.
