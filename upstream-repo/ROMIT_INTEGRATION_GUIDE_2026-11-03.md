# Romit integration guide: Avinash's Matrix360 build

Date: 3 November 2026. Repository: `AvinashWasHere21/Matrix360WIP`.

This guide accompanies the tested local build requested for publication to `main`. It identifies the application behavior to retain when reconciling this build with Romit's other changes. It is not an instruction to deploy the recovery CRM backend or replace hosted credentials.

## Integration baseline

The remote `main` inspected before publication was:

`89e6ff200737902d6d8949a1744822fc8ab8b808`

Its source matched the local implementation base apart from line endings. The release should be applied on top of that main history; no force push or history replacement is required. The final release SHA is the commit adding this guide; obtain it from the GitHub commit link or:

```powershell
git fetch origin
git log -1 --format=%H origin/main -- ROMIT_INTEGRATION_GUIDE_2026-11-03.md
```

The complete source is under `workstreams/avinash/frontend`. Pages, scripts and assets are in `frontend-source`; handlers are in `api` and `lib`. Root-level duplicate HTML/JS files inside `frontend` must not be restored. They can shadow the integrated Vercel routes.

Romit's separate current checkout was not supplied. Compatibility with changes beyond the baseline above must be resolved and tested rather than assumed.

## Functionality delivered or changed

| Area | Work in this build | Behavior and boundaries to retain |
| --- | --- | --- |
| Public landing experience | Added authored light/night palettes, original silent background video and poster, atmospheric pointer response, restrained parallax, capability reveals and a sticky four-step story. The existing illustrative plan flow remains. | Sticky chapters and atom/subtitles use the same stable chapter state and hysteresis. Scroll and pointer decoration must not move form/control geometry. Keep the distinction between a local illustrative plan and sourced authenticated research. |
| Motion controls | Added persistent Pause preference and coordinated scene/video pausing. | System reduced motion, document visibility and explicit pause take precedence. Remembered pause avoids loading/playing the decorative video. Touch layouts must not require pointer effects. No new runtime dependency is needed. |
| Sign-in | Added native paired palettes, theme switch, skip link, proper heading/tab/panel semantics, roving keyboard focus, password visibility and corrected FAQ navigation. | Preserve existing POST login, session expiry, password clearing and assigned-workspace authorization. FAQ goes to `index.html#faq`; public browsing does not provide guest access to client records. |
| Access requests | Clarified that submission requests a workspace and requires activation. Added explicit POST method to the existing request form. | Keep required fields, rate limits, mail/configuration errors and acknowledgment behavior. Request acceptance is not credential provisioning. No new user account or workspace is created by this presentation change. |
| Workspace shell | Refined sidebar/mobile navigation, typography, native theme surfaces, focus states and touch targets. Retired promotional overview blocks stay suppressed. | `Matrix360Router` owns the six route destinations and query/hash/history behavior. Preserve legacy route controls for callers without showing duplicate navigation. |
| Control Center | Retained the assistant-first overview, concise answer plus expandable full text, clarification and workflow routing. Clarified that drafting does not contact an audience. | Preserve cancellation, workspace/session guards, existing request contracts and separate explicit approval before external sending or publishing. |
| Research summary | Added aligned audience/location/fit cards with individual disclosures, one visible summary and visible uncertainties. Removed redundant executive cards and repeated lists. | Keep source industry/location filters unchanged. Buyer fit does not establish purchase intent. A separate geographic rationale must be supplied or its absence explained. |
| Competitor comparison | Preserved the approved reusable company table. Added industry-appropriate dimensions, conservative legacy fallback, evidence links and dimension-specific interpretation plus final synthesis. | Competitors come from report evidence, never hardcoded names. Aim for five relevant supported competitors; show fewer when supported. “Not stated” does not mean the competitor fails or lacks a service. |
| Quantitative research | Added source-bound comparable metrics and a clear missing-comparison explanation. Retained comparable acre observations and their qualifiers for older reports. | Never turn counts of findings into market share, demand or success rates. Preserve units, qualifiers and exact observations. No bigha-to-acre conversion is made. |
| Campaign action map | Refined selectors and a separate expanded panel with deliverable, purpose, preparation, reviewer requirements and measurement. | Switching actions, including actions in the same broad stage, must show the selected recommendation's own supplied detail. No spend, discount, owner, deadline or publication becomes approved by selecting a card. |
| Message directions | Added four selectable message directions with a separate full-width “Develop the message” panel. Explanations cover buyer decision, proof, next step and measurement. | Keep original observations accessible in their own disclosure. Selection must change substantive explanation and selected state. The heading says these are directions to test, not measured campaign response. |
| Report lifecycle and handoff | Retained report-first scrolling, separate editable prompts, explicit stage handoff and preservation of the previous report on failure. Added profile-version freshness notices. | Research must be read before approving discovery. Do not automatically send a prompt to Leads/Content/Outreach, regenerate research on profile save or rewrite an old report's timestamp. Reject late responses from a different session/workspace. |
| Planning tools | Reflowed the existing budget/test/calendar/journey forms and moved their existing nodes into Market Research. Added readable missing-assumption labels, a Company Details review shortcut and financial bars diverging from zero. | Keep original handlers, field keys, calculations, sliders, values and exact tables. Missing values stay missing. Planning is hypothetical, not historical performance or guaranteed ROI. |
| Lead relevance | Added an industry/location evidence gate before provider candidates are exposed/imported; checkpoints retain qualification results and continue pending batches. | Keep public-URL/download validation, workspace-bound checkpoints, deduplication and partial-result behavior. Fewer verified candidates is valid. Website evidence does not establish purchase intent or verify all contact details. |
| Creative and saved content | Clarified task labels/provider states and gave saved-version Reopen controls distinct accessible names. Earlier exact saved-image/caption/version handoff remains. | Preserve private asset authorization, durable-save handling, retry-save behavior, version history, undo/redo and exact saved creative references in Email. This UI pass does not replace the existing media engine. |
| Outreach | Repaired nested mobile grids and control wrapping, clarified SMTP authentication versus actual delivery, and retained review/status distinctions. | Keep draft/version approvals, consent and suppression filters, role/provider/cap checks, confirmation and accepted-versus-delivered states. No email or social publishing is enabled by styling. |
| Local setup | Windows launcher selects port 8050; loopback pages use the same-origin CRM gateway. MP4 MIME support was added for the existing handler adapter. | Use the actual adapter, not a static file server. Bind only to `127.0.0.1`. Preserve secure-origin checks and hosted integration destinations. |

## Files that must move together

Paths in this table are relative to `workstreams/avinash/frontend` unless stated otherwise.

| Change group | Required files and integration notes |
| --- | --- |
| Public experience and motion | `frontend-source/index.html`; `matrix360-public.css/.js`; `matrix360-motion.css/.js`; `matrix360-polish.css/.js`; `matrix360-brand-loop.mp4`; `matrix360-brand-poster.jpg`. Keep both generated media assets. Repository-root `tools/render-brand-loop.py` is an optional regeneration utility; FFmpeg is not required to run the site. |
| Presentation asset injection | `api/creative-integrated.js` includes polish/motion assets in integrated pages. `lib/m360-preview-server.js` supplies MP4 MIME handling. Keep the existing Vercel route/allowlist and bundled frontend-source behavior. |
| Auth and workspace theme | `frontend-source/login.html`; `client-dashboard.html`; `matrix360-auth-theme.css`; `matrix360-workspace-theme.css/.js`; `matrix360-login-handoff.js`; `lib/m360-onboarding.js`. Auth and workspace share an appearance preference; public night mode remains separate. Research styles are owned by the workspace stylesheet, not duplicate runtime injection. |
| Router and Control Center | `lib/m360-multipage-router.js`; `lib/m360-control-client.js`; polish files. Preserve mount order, route controls, exact selectors and asynchronous mounting. |
| Research data and renderer | `lib/m360-market-research.js`; new `lib/m360-research-presentation.js`; `lib/m360-research-client.js`; workspace/polish styles. Merge the server schema, normalization, renderer and styles as one unit. |
| Lead qualification | `lib/m360-lead-relevance.js`; `lib/m360-leads-orchestrator-server.js`; relevance/orchestrator tests. Do not copy just the import or disable the production evidence gate to satisfy synthetic fixtures. |
| Supporting copy and planning | `lib/m360-affinity-engine.js`; `m360-marketing-client.browser.js`; `m360-post-client.js`; `m360-csv-import-client.browser.js`; `frontend-source/matrix360-media.js`. Affinity default-copy edits do not change ranking/math or overwrite private saved strategy text. |
| Local gateway | `frontend-source/matrix360-api-config.js`; repository-root `START_LOCAL_WINDOWS.cmd`; existing `tools/local-preview.cjs`, `tools/local-auto-login.cjs` and `package.json`. Normal auto-login remains disabled. |
| Regressions | New `audit-ui.test.cjs`, `research-presentation.test.cjs`, `lead-relevance.test.cjs`, `local-api-origin.test.cjs`, `motion.test.cjs`, `public-experience.test.cjs`; corresponding updates to existing shell, control, research, onboarding, lead and workspace tests. Run the root command so both `.test.js` and `.test.cjs` suites execute. |

For a precise release inventory, use `git show --stat <release-sha>` and `git diff <release-sha>^ <release-sha>`. Do not copy the whole sensitive archive or treat every untracked local report as source.

## Additive research contract

New strict provider responses include `research.presentation`:

- `geography_rationale`: proposed regional focus and its limits.
- `dimensions`: one to four client-appropriate comparison headings.
- `competitors[]`: exact original observation plus dimension, verbatim quote and cited source URL.
- `messages[]`: exact original trend, buyer question, required proof, next step, measurement and optional cited source.
- `actions[]`: exact original recommendation, reason, deliverable, preparation, measurement and optional cited source.
- `quantitative[]`: metric, common unit and exact observation/value/qualifier/source associations.
- `synthesis`: common decision and remaining gaps.

Older reports without `presentation` still render. Do not make a migration mandatory or populate old reports with invented evidence.

The normalizer rejects unsafe/unrecognized source URLs, unmatched observations and unsupported/negated positive evidence. Quantities must occur literally with units and qualifiers; partial numeric/unit matches are rejected. These guards validate associations within a report; they do not independently establish the truth of every external webpage.

Maximum response output allowance is now 6,500 tokens instead of 3,300. Existing OpenAI configuration, approved-budget checks and user review still apply. No paid generation was run to measure actual cost or live-provider conformance to the new structure.

## Configuration and private data

- Node.js 24.x. The local adapter has no npm package dependencies; no `npm install` is needed.
- Preserve the destination environment's existing `.env.local`, hosted environment settings, datasets, saved reports and creative assets. None belongs in this source merge.
- Normal authentication settings remain `M360_SHOWCASE_ENABLED=false`, `M360_SHOWCASE_LIVE_ENABLED=false`, and `M360_LOCAL_AUTO_LOGIN_ENABLED=false`.
- CRM sign-in needs the authorized `M360_ROMIT_ORIGINAL_SCRAPER_PREVIEW_KEY` and authorized CRM account. Request configuration privately from the service owner.
- Research still needs authorized AI configuration and `M360_OPENAI_SPEND_APPROVED`; optional integrations remain governed by their existing configuration/approval flags. A variable in `.env.example` is not authorization to enable it.
- No database/schema migration, hosted permission change, backend deployment, new public endpoint destination or account-credential copy is required for these frontend changes.
- Keep the newer hosted CRM. The separate `crm-backend` recovery directory must not be deployed over it.

## Suggested integration procedure

1. Commit or otherwise preserve Romit's current work and private files. Record both branch SHAs. Create a new integration branch from his working branch.
2. Fetch the release and inspect the complete diff. If his branch already contains the baseline main above, apply the release commit with `git cherry-pick --no-commit <release-sha>`; review before committing. If histories differ, reconcile equivalent baseline changes first rather than blindly selecting one whole side.
3. Resolve conflicts by change group. Retain Romit's newer handlers where compatible; preserve Avinash's added presentation/validation behavior. Do not replace entire files with “ours” or “theirs” as a routine conflict fix.
4. Never restore duplicate raw frontend-root pages. Keep canonical asset routes, CSP behavior, private assets and exact saved creative handoff.
5. Run `npm test` from the repository root. Review changed tests rather than weakening authorization, evidence, save or approval assertions.
6. Start the adapter and sign in privately. Inspect the checklist below. Keep paid and outbound actions separately authorized.
7. Review the resulting diff for credentials/private records, then commit the integration. Check deployment triggers before pushing. Do not force-push or bypass branch protections.

## Validation and acceptance checklist

At the audited build: **154 tests passed, 0 failed, 0 skipped**. Regression integrations are mocked. Read-only browser checks additionally used the user's authorized account and existing saved report.

Verified locally:

- Fresh normal sign-in and all six workspace routes.
- Back/Forward route and heading state.
- Five saved competitor rows; aligned audience-card heights; four different expanded message explanations.
- Native light/dark themes without extension double-recoloring.
- Mobile sign-in/workspace at 390 × 844, Outreach grids inside their containers and checked text/control targets at least 44 pixels high.
- Sign-in tab keyboard behavior, FAQ navigation and original report disclosures.
- Anonymous research handler returns HTTP 401. Main pages/styles return HTTP 200.
- Original deployment-route test passes after removing shadowing raw copies from the active tree.

Romit should additionally check:

- Sticky chapter/subtitle state while scrolling both directions; manual chapter controls; Pause remembered after reload; system reduced motion.
- Research text, sources, selected action/message state, stale-profile notice and empty numerical-comparison state.
- Prompt editing, report-first reading, cancellation and explicit approval before each specialist handoff.
- Auth expiry, workspace switching and rejection of late responses.
- Existing creative save/reopen/version/Email handoff with exact saved references.
- Calendar/journey fields, Company Details values and missing planning assumptions.
- Any workflows changed in his own build, including his separate runtime/version requirements.

Not certified by these tests: a newly generated authenticated research report, live scraping, paid creative generation, real imports/profile saves, inbox delivery, social publication, comprehensive multi-tenant isolation or production readiness. No migrations or external sends were performed for this release validation.

## Recovery and rollback

The release is intended as a normal child commit on existing main. Preserve the preceding main SHA above. If a later rollback is required, inspect and revert the release commit normally; do not reset or force-push shared history. A revert is a separate decision, not an automatic action instructed by this document.

Moved raw frontend copies remain in a local archive outside Git. They are historical recovery material, not deployment source. Private data/configuration is not restored or overwritten by a source-code rollback.

Detailed historical records: `AUDIT_IMPLEMENTATION_2026-11-03.md`, `WEBSITE_AUDIT_2026-11-03.md`, and `FUNCTIONALITY_MERGE_HANDOFF_2026-11-03.md`. Their earlier branch/test/publication statements are dated snapshots; the current release commit and this guide identify the merge candidate.
