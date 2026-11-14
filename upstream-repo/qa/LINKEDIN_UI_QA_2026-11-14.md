# LinkedIn UI verification — 14 November 2026

The LinkedIn module is served inside the existing Marketing client bundle. The existing LinkedIn raw-token form is replaced by a workspace-specific OAuth connection entry. WhatsApp and email forms and handlers were not changed.

## Verified locally

- `node --test workstreams/avinash/frontend/tests/linkedin-ui.test.js`: 6 passed. Covers LinkedIn-only Overview routing, mixed-channel preservation, untrusted preview text/URL handling, explicit local scheduling including a DST gap, validation of proposed AI schedule times, finite batch scheduling with independent failures, and the served bundle/route contract.
- `node --test workstreams/avinash/frontend/tests/control-center.test.js`: 19 passed after updating the intentional LinkedIn routing expectation and adding a LinkedIn handover case.
- `node workstreams/avinash/frontend/tests/linkedin-ui-browser.cjs`: passed in an isolated temporary local Chrome profile. The runner starts its own loopback fixture server and closes Chrome/server afterward. It does not use the user's Chrome profile or real credentials.

The real-browser fixture exercised objective-based draft preparation with a persisted Overview handover identifier, escaped content preview, loading and displaying saved image bytes as a Blob, saving/reopening, approval, queuing, cancellation, switching between two fixture workspaces, and hiding optional approval/media-rights rules when disabled. It observed no JavaScript runtime exceptions and no horizontal overflow at 375, 768 and 1440 CSS pixels.

The fixture also exercised recording an existing CRM lead identifier against a saved campaign and displaying the result as team-recorded attribution, distinct from LinkedIn metrics. Changing workspaces cleared the attribution. This checks interface behavior only; real CRM record verification is covered by the server implementation and separate acceptance.

The fixture is clearly labelled and uses in-memory responses. Its post/grant identifiers are test-only values and are not publication evidence. It is not exposed through an application route or loaded by the production module.

## Workflow added

Accounts and eligible destinations; campaign objective and English/Hindi/Bengali AI requests; concept selection and requested revisions; chunked uploads up to 200 MB; saved Content Studio images; explicit image/video generation requests and persisted completion tracking; author/text/link/media/time preview; draft history; optional exact-version and batch approval; queue/calendar; per-destination failure, retry, cancellation and uncertain-outcome reconciliation; read-back verification; entitled performance metrics.

`Schedule selected` queues a finite selection of saved campaign versions, each retaining its own date/time. Successes remain queued if another campaign fails, and the UI reports each failure. Backend approval requirements still apply when optional guardrails are enabled. This does not create recurring campaigns or generate future posts automatically.

Media previews use authenticated asset reads, never a bearer token in the URL. Object URLs are revoked on edits, new drafts, workspace changes and session expiry. Timers only refresh an open, visible LinkedIn panel. Configuration or worker availability is not inferred from a stored token.

## Not verified by these checks

Real Matrix360 login and CRM authorization, live LinkedIn OAuth or Page approval, real provider publication/media processing/analytics, paid AI/Content Studio calls, hosted deployment and long-running worker behavior are outside this fixture's evidence. Those require separate application/provider acceptance. No screenshot baseline or full accessibility audit was run; responsive overflow checks are not a visual-regression or accessibility certification.

The Chrome MCP browser could not reach the Windows loopback fixture. Native local Chrome was used instead, through the explicitly scoped test runner with a temporary profile.
