# Matrix360 functionality and merge handoff

Update: the audit implementation is now recorded in [AUDIT_IMPLEMENTATION_2026-11-03.md](AUDIT_IMPLEMENTATION_2026-11-03.md). It supersedes the earlier branch, test and source-cleanup status below: current branch is `work/avinash-audit-20261103`, all 154 tests pass, and the shadowing raw frontend copies are preserved outside the checkout. Merge the new research presentation helper/schema/renderer together. Avinash’s actual Git transport identity is verified; no commit, push or deployment was performed.

Date: 3 November 2026. Purpose: preserve the current local implementation when reconciling it with Romit's build. This document inventories implemented behavior separately from the proposed improvements in `WEBSITE_AUDIT_2026-11-03.md`.

## Source and release status

- Repository: `https://github.com/AvinashWasHere21/Matrix360WIP.git`.
- Inspected HEAD: `2194ba78a2112051db22f4dfad9b678c0013f80f`.
- Current checkout branch: `work/mayur`, with tracked modifications and untracked files. The delivered changes are working-tree content, not a new commit represented by HEAD.
- Canonical application: `workstreams/avinash/frontend`; page and asset source: its `frontend-source` directory. Handlers and shared code are in its `api` and `lib` directories.
- Local adapter: repository-root `tools/local-preview.cjs`. Node.js 24.x is required; the adapter has no npm package dependencies.
- Local application: `http://127.0.0.1:8050/index.html`; sign-in: `/login.html`; client workspace: `/client-dashboard.html`.
- This is a frontend and handler adapter using hosted integrations. It is not fully offline or standalone.
- No new merge, commit, push or deployment was performed for these reports. Historical deployment reports describe earlier snapshots and do not prove that the latest public-motion files are deployed.
- Romit's current source/commit is unknown here. A conflict-free merge or compatibility with that unknown build has not been established.

## Implemented behavior to preserve

| Area | Current behavior and changes | Main files |
| --- | --- | --- |
| Local routing | Loopback HTTP pages use the same-origin `/api/crm` gateway while retaining secure-origin validation. The Windows launcher selects port 8050. | `frontend-source/matrix360-api-config.js`; repository-root `START_LOCAL_WINDOWS.cmd`; existing `tools/local-preview.cjs` |
| Dashboard overview | Assistant-first Control Center; old promotional overview, journey/demo blocks and the retired dashboard hub are suppressed. Existing shared handlers remain available. Desktop uses a sidebar navigation view; smaller screens use the existing route controls in a wrapping grid. | `lib/m360-multipage-router.js`; `lib/m360-control-client.js`; `frontend-source/matrix360-polish.js` and `.css` |
| AI answer presentation | Short recommendation and action steps are visible; the longer answer is available in “Open full answer.” Clarifications, routing, cancellation and authorization remain in the existing flow. | `lib/m360-control-client.js`; `tests/control-center.test.js` |
| Research report | Audience/geography/fit disclosures; reusable competitor table populated from report observations; four interpretation cards and final synthesis; action selection with a separate explanatory panel; message selection with a separate full-width detail panel; full report text in a disclosure. | `lib/m360-research-client.js`; `frontend-source/matrix360-workspace-theme.css`; polish files |
| Quantitative views | Reported industrial-site scale is charted only when comparable acre observations exist. Financial scenarios use supplied assumptions, preserve unknown inputs and are labeled hypothetical; exact data remains available in a table. | `lib/m360-research-client.js`; `lib/m360-market-research.js` |
| Research workflow review | The completed report is presented before discovery review. Each stage has its own editable prompt bubble and explicit handoff. Leads, Content AI and Outreach are not automatically treated as approved audience sends. Workspace changes and cancellation guard the flow. | `lib/m360-research-client.js`; `tests/market-research.test.cjs`; `tests/workspace-review.test.js` |
| Competitor research instructions | Ask for at least five distinct relevant competitors when supported, fewer when necessary; exclude the client/duplicates; retain evidence and avoid padding. This is a research instruction, not a guarantee that five results always exist. | `lib/m360-market-research.js` |
| Research errors | Distinguishes storage, hosted-service connection, timeout, unreadable output and generic report/save failures while retaining the previous report. | `lib/m360-market-research.js` |
| Theme and planning-tool layout | Workspace light/dark surfaces and notification colors; reflowed planning forms; planning tools moved into Market Research by moving their existing DOM nodes, retaining handlers. Audience cards have aligned top/bottom structure. | `frontend-source/matrix360-workspace-theme.css`; `lib/m360-research-client.js`; polish files |
| Lead relevance gate | Both provider paths qualify website evidence for requested industry/location before exposure/import. Tenant-bound checkpoints carry qualification state; pending batches continue and old unqualified checkpoints are cleared of unqualified results before reuse. This does not prove purchase intent or validate every contact detail. | New `lib/m360-lead-relevance.js`; changed `lib/m360-leads-orchestrator-server.js`; related tests |
| Sign-in polish | Password visibility control; keyboard handling for account-action tabs; clearer sign-in title; smaller mobile introduction. Existing authentication, onboarding request endpoint and expiry/workspace checks remain authoritative. | `frontend-source/matrix360-polish.js` and `.css`; existing `matrix360-login-handoff.js` |
| Public presentation | Shorter hero explanation, coherent light/dark palette, native Night mode with separate saved preference and system fallback, readable illustration and navigation, one canonical pricing section. | Changed `frontend-source/index.html`; new `matrix360-public.js` and `.css`; polish files |
| Public video | Original silent 12-second 960 × 540 MP4 loop with poster. Local preview serves MP4 as `video/mp4`. The checked-in asset is about 356 KB and does not need an app dependency to play. | New `matrix360-brand-loop.mp4`, `matrix360-brand-poster.jpg`; changed `lib/m360-preview-server.js`; repository-root `tools/render-brand-loop.py` |
| Sticky story correction | One geometry snapshot and boundary buffer drive chapter caption, controls, current step and atom highlight together. Fixed scene/caption geometry prevents feedback. Manual selection supports a stable smooth-scroll target and normal user scrolling can interrupt it. | `frontend-source/matrix360-motion.js` and `.css`; `tests/motion.test.cjs` |
| More sticky sections | Capability, trust and FAQ introductions use desktop sticky positioning with mobile, short-screen and reduced-motion fallbacks. | `frontend-source/matrix360-public.css` |
| Pointer/scenery motion | Decorative backgrounds across seven landing sections respond to pointer movement and scroll without moving input hit areas. Touch/coarse-pointer and narrow-screen behavior are constrained. No continuous animation loop is needed for pointer tracking. | `frontend-source/matrix360-public.js` and `.css` |
| Motion safeguards | Pause/Play coordinates the hero video and new scenery. Reduced motion and page visibility are respected. Existing dashboard effects are short presentation transitions, not parallax on approval controls. | Motion, polish and public files; `tests/motion.test.cjs`; `tests/public-experience.test.cjs` |

## Curated change inventory

Paths in this section are relative to `workstreams/avinash/frontend`, except entries explicitly marked repository root. A file listed here is not permission to overwrite Romit's version wholesale; compare its working-tree content with both baselines.

### Changed application files

- `api/creative-integrated.js`: injects shared polish and motion resources into integrated page responses. Preserve existing authentication and page/asset handling.
- `frontend-source/index.html`: hero copy, landing-only theme script/styles, native color-scheme declaration and Dark Reader opt-out for the authored landing palettes.
- `frontend-source/matrix360-api-config.js`: local same-origin gateway selection and validation.
- `frontend-source/matrix360-workspace-theme.css`: workspace/research surfaces, tables, disclosures, action/message details, aligned cards and planning controls.
- `lib/m360-control-client.js`: compact answer presentation with full-answer disclosure.
- `lib/m360-leads-orchestrator-server.js`: relevance qualification integration, cache/checkpoint versioning and pending qualification handling.
- `lib/m360-market-research.js`: competitor/content instructions and differentiated safe errors.
- `lib/m360-multipage-router.js`: retired-block suppression; assistant replaces the old hub.
- `lib/m360-preview-server.js`: MP4 response type.

### New application assets and helper

- `frontend-source/matrix360-polish.js` and `matrix360-polish.css`.
- `frontend-source/matrix360-motion.js` and `matrix360-motion.css`.
- `frontend-source/matrix360-public.js` and `matrix360-public.css`.
- `frontend-source/matrix360-brand-loop.mp4` and `matrix360-brand-poster.jpg`.
- `lib/m360-lead-relevance.js`.
- Repository root: `tools/render-brand-loop.py`. FFmpeg is needed only to regenerate the committed video, using its `--ffmpeg` option or an executable on PATH. The temporary encoder installation outside the repository is not an application dependency or a merge artifact.

### Tests and setup documentation

- Changed: `tests/beta-shell.test.js`, `tests/control-center.test.js`, `tests/leads-orchestrator.test.js`, `tests/market-research.test.cjs`, `tests/onboarding.test.js`, `tests/workspace-review.test.js`.
- New: `tests/lead-relevance.test.cjs`, `tests/local-api-origin.test.cjs`, `tests/motion.test.cjs`, `tests/public-experience.test.cjs`.
- Setup documentation changed in repository-root `README.md`, `START_LOCAL_WINDOWS.cmd`, and `workstreams/avinash/frontend/README.md`. Check port instructions when reconciling older documents: plain `npm start` defaults to 8000; this local run explicitly uses 8050.
- This handoff and the website audit are new documentation artifacts.

## Dependencies that make partial copies fail

1. Shared polish/motion JS and CSS must travel with their `creative-integrated.js` injection. Copying styles alone loses navigation, password and story behavior; copying JS alone loses responsive geometry.
2. The public theme script and stylesheet are referenced directly by canonical `frontend-source/index.html`. The early theme script avoids relying on a later dashboard bootstrap. Preserve `m360-public-theme` separately from the workspace's `m360-theme` preference.
3. Copy the video, poster and preview MIME support together. The FFmpeg generation helper is optional at runtime.
4. Research changes span renderer, workspace styles, server schema instructions and tests. Preserve report fields, `M360CampaignAgent`, `M360LeadsSubAgent`, `M360ContentAgent`, `Matrix360Router`, editable-prompt gates and workspace lifecycle events.
5. Relevance filtering is server logic. Merge the new helper, its caller changes and tests together; do not transfer only its UI label or replace Romit's provider implementations. Preserve tenant/client identity, checkpoints, cancellation and batching.
6. The integrated handler loads pages/assets from `frontend-source`. Keep the deployment's `includeFiles`/rewrites and authoritative router asset route. Do not replace the integrated response with a raw static dashboard.
7. Moving planning nodes preserves event handlers. Recreating those forms through copied HTML can lose bindings and create duplicate IDs.

## Verification status

| Evidence | Result and practical limit |
| --- | --- |
| Latest full regression run | 144/145 passed. One existing duplicate-dashboard routing assertion failed. Tests use mocks/synthetic responses for many hosted operations. |
| Latest focused public/motion/shell run | 8/8 passed, covering saved/system theme behavior, storage failure, pointer limits, touch/reduced-motion/pause behavior, palette contrast and stable chapter progression. |
| Landing-page browser verification | Forward/reverse chapter progression, pinned stage, synchronized caption/atom, video playback and Pause/Play, pointer movement without headline displacement, sticky introductions, native themes, saved preference, navigation and local plan preview. |
| Responsive checks | Landing checked at 390, 1024, 1280 and 1440 pixels in the preceding implementation pass. This audit also inspected sign-in and the authenticated workspace at 390 pixels; the audit records remaining small targets and nested Outreach overflow. |
| Fresh audit of authenticated workspace | All six destinations opened; existing research displayed five competitors and four message selectors. This was read-only review, not a new paid campaign run. |
| Historical functionality reports | Earlier local/hosted research, creative, draft and relevance tests are described in existing reports. They are evidence for those snapshots, not fresh certification of current provider keys, current deployments, buyer intent or delivery. |

No production-readiness, comprehensive cross-tenant isolation, paid-generation reliability, scraping coverage, email inbox delivery or publishing success is claimed by the UI work or this handoff.

## Known merge blockers and exclusions

- **Wrong publication branch:** do not commit or push Avinash's work to `work/mayur`. Create/use an authorized isolated Avinash branch while preserving this working tree. Do not reset, clean, discard or merge colleagues' branches automatically.
- **Identity not established by attribution:** verify the actual GitHub push transport authenticates as `AvinashWasHere21`. Repository-local name/email are not proof. Recheck repository, branch and deployment triggers before any push.
- **Duplicate application files:** untracked copies such as `frontend/client-dashboard.html`, `frontend/index.html` and `frontend/login.html` exist outside `frontend-source`. The raw dashboard causes the known route test failure. They were preserved. Identify their provenance and retain a recoverable copy before any deliberate cleanup; do not include them by blanket staging.
- **Sensitive archive content:** never include `.env.local`, credentials, local datasets, campaign stores, private generated media, credential/reference reports, signed access links, backups or temporary encoder tools. Review tracked files as well as ignore rules. Re-provision authorized secrets privately on the destination; do not send them with this report.
- **Hosted recovery backend:** the separate CRM recovery directory must not overwrite the newer hosted CRM service. No database migration, permission change, deployment or auto-deploy enablement is part of this handoff.
- **Research interpretation limits:** the current industrial comparison uses fixed keyword dimensions; message details remain partly generic. See the audit before generalizing to other industries. Do not confuse implemented rendering with verified market conclusions.

## Merge and acceptance procedure

1. Record Romit's repository, branch and commit. Compare the curated files against this HEAD plus the actual dirty working-tree contents; a Git diff of tracked files alone omits the new assets and helpers.
2. Preserve both checkouts and local private configuration. Isolate Avinash's changes on an authorized non-deploying branch. Resolve the duplicate-root-file issue explicitly before claiming deployment readiness.
3. Reconcile separately: local routing; relevance server gate; research/report UI; shared sign-in/dashboard presentation; public theme/motion/assets. Review complete diffs without copying unrelated workstreams.
4. Keep backend contracts, approved company facts, auth/session lifecycle, profile versions, creative archive references, consent, version-hash approval and sending confirmation intact. No silent change from staging to live operation.
5. Run `npm test` from the repository root. Fix the actual duplicate-route condition through an authorized source/layout decision, not by weakening the assertion. Confirm MP4, JS and CSS assets load through the integrated adapter.
6. Browser-check guest denial, sign-in, all six routes, refresh/back/deep links, native light/dark, reduced motion and mobile. Use existing saved data for the first pass.
7. If separately authorized, replay a development-account research-to-discovery-to-saved-creative-to-review-draft workflow. Stop at explicit review gates. A real send or publication is a separate action, not a merge smoke test.
8. Verify the actual push account and non-deploying target branch before publishing. Verify the remote SHA afterward. Until that is done, this remains a local handoff, not a pushed or merged release.

## Local start, restart and stop

From the actual repository root in PowerShell:

```powershell
$env:PORT='8050'
npm start
```

Stop a foreground instance with `Ctrl+C` in that terminal. Restart with the same two commands. If 8050 is occupied, inspect its owner rather than terminating an unrelated process:

```powershell
Get-NetTCPConnection -LocalPort 8050 -State Listen
```

The current session's preview was launched in the background. A background restart must first identify the matching `node.exe` command line for `tools/local-preview.cjs` in this checkout; do not kill every Node process. The adapter binds to `127.0.0.1`.
