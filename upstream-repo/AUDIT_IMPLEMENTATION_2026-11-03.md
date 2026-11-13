# Website audit implementation — 3 November 2026

This is the implementation record for `WEBSITE_AUDIT_2026-11-03.md`. The audit remains a historical description of the earlier state. The current source includes the repairs below.

## Application and source status

- Local application: http://127.0.0.1:8050/index.html
- Sign-in: http://127.0.0.1:8050/login.html
- Saved research: http://127.0.0.1:8050/client-dashboard.html?page=research#market-research
- Canonical application: `workstreams/avinash/frontend`, with pages and assets in `frontend-source`.
- Branch: `work/avinash-audit-20261103`. Base HEAD: `2194ba78a2112051db22f4dfad9b678c0013f80f`.
- Changes remain in the working tree. Earlier unrelated changes and private files have not been staged.
- Windows Git Credential Manager's selected Git transport credential was checked against GitHub's authenticated user and repository APIs: `AvinashWasHere21`, with push access to `AvinashWasHere21/Matrix360WIP`. Repository-local attribution now uses `196699697+AvinashWasHere21@users.noreply.github.com`; credential selection is pinned locally to that account. GitHub CLI authentication is separate and was unavailable.
- No commit, push, merge or deployment was performed. The GitHub workstream workflow is a hygiene check, not a deployment guarantee. Hosted Git integration settings have not established that this branch is non-deploying; verify that before any push.

## Findings and repairs

| Finding | Implemented change |
| --- | --- |
| A01 | Sign-in offers the public site and illustrative plan. It no longer promises a guest CRM dashboard. |
| A02 | Sign-in help links directly to `index.html#faq`. The existing pricing redirect is retained. |
| A03 | Access requests explain email acknowledgment and activation. The success message does not claim account provisioning. Existing validation and notification behavior remain. |
| A04 | Control Center distinguishes drafting from separately reviewed and explicitly approved sends or publishing. |
| A05 | Research is labeled “Message directions to test”; its report navigation target uses the same heading. |
| A06 | Each message's separate full-width panel explains a buyer decision, proof needed, next step and measurement. Original observations remain in a disclosure. New structured fields can supply client-specific explanations; older reports have distinct evidence-dependent guidance. |
| A07 | Geography uses its own supplied rationale. Older reports explicitly state when no regional comparison exists. Buyer fit does not imply purchase intent. |
| A08 | Comparison interpretation identifies dimension-specific proof and unanswered questions. The four-lens industrial design and final synthesis remain. Missing information is not called competitor failure. |
| A09 | Actions expose deliverable, purpose, preparation, review and measurement. Exact recommendation bindings distinguish actions within the same broad stage. Incentives require approved conditions. |
| A10 | Creative, CSV and Control Center labels identify the task/output. CSV staging/import behavior is unchanged. |
| A11 | Missing planning inputs use readable labels and link to Company Details without saving or changing calculations. |
| B01 | The reusable competitor table is preserved. New reports supply industry-appropriate dimensions and evidence. Older reports derive supported themes conservatively instead of always showing industrial columns. Negated claims and company-name-only keywords do not create positive evidence. |
| B02 | Safely linked evidence appears with findings where an actual association exists. Unsupported links are dropped. Original sources remain available. |
| B03 | Duplicate executive cards and repeated finding lists are removed. One decision summary, visual explanations, visible uncertainties and the complete original report remain. |
| B04 | Sourced quantities require comparable units and literal values with qualifiers. No finding-count market-share charts or bigha-to-acre conversion are introduced. Missing comparisons explain why there is no numerical chart. Hypothetical financial bars diverge from zero and retain the exact table. |
| B05 | Report reads compare saved and current profile versions. Changed Company Details produce a review-needed notice without regenerating, rewriting report dates or deleting the previous report. |
| C01 | Sign-in and workspace use native paired palettes and opt out of extension recoloring. Stored/system theme handling is shared between those pages; the public site's separate preference remains. Light-mode input specificity is corrected. |
| C02 | Workspace buttons, text inputs, selects and textareas have a 44-pixel minimum height. Sign-in retains visible focus and native input behavior. |
| C03 | Outreach nested grids wrap within their container at narrow widths. Data tables retain local horizontal scrolling. The mobile header has less empty space. |
| C04 | Sign-in has one main heading, a skip link, tab/panel relationships and roving keyboard focus. Password visibility remains available. |
| C05 | Saved creative Reopen controls include headline, date and version in their accessible names. |
| C06 | Configured AI access is distinguished from a successful provider request; SMTP authentication is distinguished from delivery. Draft, review, hypothetical and missing-data qualifications remain. No paid or outbound retry was added. |
| C07 | The router owns navigation; the presentation layer delegates to it and preserves legacy controls as hidden sources rather than deleting them. Research styles moved from runtime injection to the workspace stylesheet. Auth colors use their scoped token layer. This is incremental consolidation; unrelated legacy CSS was not broadly rewritten. |

## Optional polish addressed

The approved landing hero, video, sticky sequence, pointer response and parallax are retained. The primary goal CTA uses consistent wording. One overlapping landing paragraph is clearer without removing the planned-development qualification. Pause motion now persists in a separate appearance preference, applies to atmospheric scenery and does not load/play the decorative video while remembered as paused. System reduced motion still takes precedence. Dashboard motion remains restrained.

No full CSS rewrite, removal of approved landing sections or hardware performance optimization was justified by a measured failure. No hardware frame-rate, battery, Core Web Vitals or low-end-device benchmark is claimed. Existing saved marketing strategy text is preserved; revised default guidance does not overwrite private stored plans.

## Research contract and merge dependencies

New helper: `lib/m360-research-presentation.js`. `lib/m360-market-research.js` requests an additive `presentation` object containing geography rationale, comparison dimensions, exact-bound competitor evidence, message explanations, action deliverables, comparable quantities and synthesis. New strict responses include it; legacy responses/reports without it remain accepted.

Evidence is tied to an exact report observation and an HTTPS citation returned by search. Unsafe/unknown URLs, invented quotes, unmatched observations and negative evidence are rejected or shown as unknown. Numerical values must occur literally with their units and qualifiers; partial numeric/unit matches are rejected. This validates report associations, not the truth or freshness of every external webpage.

The maximum response output allowance increased from 3,300 to 6,500 tokens to accommodate the additional structure. Existing AI configuration and approved-budget gates still apply. No paid request was made to measure actual token usage, cost or provider conformance to the new schema. Merge the server helper, schema handling and renderer together.

Current-pass files, relative to `workstreams/avinash/frontend`:

- `frontend-source/client-dashboard.html`, `index.html`, `login.html`
- `frontend-source/matrix360-auth-theme.css` (new), `matrix360-workspace-theme.css`, `matrix360-workspace-theme.js`
- `frontend-source/matrix360-login-handoff.js`, `matrix360-media.js`
- `frontend-source/matrix360-motion.js`, `matrix360-public.js`, `matrix360-polish.js`, `matrix360-polish.css` (these files also contain earlier work)
- `lib/m360-affinity-engine.js`, `m360-control-client.js`, `m360-csv-import-client.browser.js`, `m360-market-research.js`, `m360-marketing-client.browser.js`, `m360-multipage-router.js`, `m360-onboarding.js`, `m360-post-client.js`, `m360-research-client.js`
- `lib/m360-research-presentation.js` (new)
- `tests/audit-ui.test.cjs`, `tests/research-presentation.test.cjs` (new), `tests/motion.test.cjs`
- Repository-root audit and handoff documents were updated to link to this implementation record.

Other dirty files predate this pass. Do not treat the complete dirty checkout as a safe blanket commit or copy private reports, credentials or datasets into Romit's build. His current source/commit was not supplied, so a conflict-free merge remains unverified.

## Duplicate-source recovery

Nineteen untracked raw frontend-root copies were shadowing canonical deployment routes and confusing the existing route regression. Each file was checked as untracked, hashed and moved without deletion to:

`E:\Matrixnov\Matrix360-preserved-root-copies-20261103`

Its `manifest.json` records original/canonical hashes. Eighteen copies differed from the canonical source; the logo matched. The archive preserves every moved file. Do not restore these raw files over the canonical integrated routes. The original “Raw dashboard must not shadow the integrated route” assertion is unchanged and now passes.

## Verification

- Final `npm test`: **154 passed, 0 failed, 0 skipped**. Full log: `E:\Matrixnov\audit-final-tests.log`.
- New regressions cover evidence attribution, safe links, negations, units/qualifiers, legacy non-industrial reports, distinct message selections, same-stage action details, stale-profile notices, original report retention, auth semantics/palette contrast and remembered motion pause.
- Authenticated browser: private sign-in succeeded; all six destinations opened, Back/Forward restored the expected route and heading, and the saved report retained five competitors. Four message selections showed different buyer decisions and proof. Audience card heights matched. Native light/dark rendering and the absence of extension double-recoloring were checked.
- Responsive browser: sign-in and workspace were checked at 390 × 844; nested Outreach grids fit their containers and checked controls met the 44-pixel height target. Earlier desktop/tablet and motion tests remain supporting evidence rather than a claim to inspect every possible state.
- Sign-in keyboard tabs and FAQ routing were checked. No access request was submitted. No browser console errors were observed in the checked renewed-session research flow.
- Unslop: rendered landing, sign-in, access-request and saved research corpora were scanned with phrase, structure, silhouette and readability tools. Sign-in preservation passed (1/1 extracted constraint); access-request extraction found no machine constraints. Manual review preserved auth/approval/uncertainty distinctions. Landing, sign-in and access-request phrase scans had no matches. Research had three soft “comprehensive” matches in original saved observations; these are retained rather than rewriting history. Repeated labels, cells and the retained original-text structure account for soft structural flags. No introduced hard or anti-slop-register hit was found.
- Evidence and screenshots are local under `E:\Matrixnov\website-audit-evidence` and `E:\Matrixnov\audit-fixed-*.png`. They are not part of the source merge.

These are mocked/regression tests plus authorized read-only browser checks of existing hosted data. New authenticated research generation, scraping, paid creative generation, imports, profile saves, email delivery, social publishing, comprehensive tenant isolation and production readiness were not exercised or certified.

## Start, stop and restart

From PowerShell:

```powershell
Set-Location -LiteralPath 'E:\Matrixnov\Matrix360-updatedversion 2\Matrix360-Mayur-Continuation-2026-10-31-FULL-SENSITIVE\Matrix360WIP'
$env:PORT='8050'
npm start
```

The adapter binds to `127.0.0.1`. Plain `npm start` without `PORT` defaults to 8000. `START_LOCAL_WINDOWS.cmd` selects 8050.

For a server started in that foreground terminal, stop with **Ctrl+C**; restart by running the last two commands again.

At delivery the background adapter is Node process **760**, listening on port 8050. To stop that specific process after checking that it still owns the expected adapter:

```powershell
Get-CimInstance Win32_Process -Filter 'ProcessId=760' | Select-Object ProcessId,Name,CommandLine
# Proceed only if this is node.exe running tools/local-preview.cjs.
Stop-Process -Id 760
```

To restart after stopping it, use the start commands above. Do not kill another process if Windows has reused the PID or port. Existing `.env.local` and datasets were preserved; no missing configuration was established by these read-only checks. Normal sign-in required the user's authorized account. Any new hosted job remains subject to its existing service configuration and budget/approval requirements.
