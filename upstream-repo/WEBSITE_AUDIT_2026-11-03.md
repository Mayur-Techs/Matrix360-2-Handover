# Matrix360 website audit

Implementation update: see [AUDIT_IMPLEMENTATION_2026-11-03.md](AUDIT_IMPLEMENTATION_2026-11-03.md) for completed repairs, 154 passing tests and current branch/verification status. The audit below records the earlier state; its branch and test figures are historical.

Date: 3 November 2026. Scope: public landing page, sign-in and access requests, and the authenticated client workspace. This is an audit and implementation proposal. No application source was changed for this audit.

## Assessment

The current visual direction should be retained. The largest remaining gains are clearer claims, more specific research explanations, accessible controls, and consistent rendering across themes and routes. Adding more effects is a lower priority than making each screen easier to understand.

The most important findings are:

1. Sign-in advertises a demo dashboard that is not the normal authenticated experience. Its FAQ link also opens pricing instead of the FAQ.
2. Access requests send an email and notify the team; they do not provision an account. The form should explain the activation step before submission.
3. The Control Center says nothing can be sent externally from the page, although its campaign flow can append a real email-release interface. The text needs to distinguish preparing a draft from explicitly approving and sending it.
4. Research selections work, but their expanded explanations still contain substantial repeated guidance. Some headings imply measured customer response where the report only provides observations and suggested tests.
5. The competitor table template is reusable, but its four subject columns and keyword rules are fixed to industrial property. That is a data-interpretation limitation, not a reason to replace the table design.
6. Dark Reader is still recoloring sign-in and the workspace. During this audit the workspace theme was `light`, the switch was off, and Dark Reader rendered it dark. This does not establish that the native light palette is defective.
7. Several workspace controls are smaller than 44 pixels high, and Outreach has nested mobile overflow even though the document itself fits the viewport.

## Evidence and limits

The public site and sign-in were reviewed in the browser and in source. After the user signed in privately, all six workspace destinations were opened: Control Center, Leads & Pipeline, Content Creation, Market Research, Outreach, and Company Details. An existing research report contained five competitor rows and four message selections. No new report was requested.

Browser observations included desktop layouts, sign-in at 390 × 844, and the authenticated workspace at 390 × 844. Earlier implementation checks also covered the landing page at 1024, 1280 and 1440 pixels wide. Those earlier checks are supporting history, not a fresh full audit of every state at every breakpoint. Temporary viewport overrides were reset.

No credentials were collected in chat. No research, lead discovery, AI revision, paid generation, access-request email, approval, send, import, profile save, asset deletion, publishing or deployment action was triggered during this audit. Existing content and navigation were inspected. Successful navigation is not certification of all connected services or tenant isolation.

The latest application regression result, from the preceding implementation pass, is **145 tests: 144 passed, 1 failed**. The failure is `Raw dashboard must not shadow the integrated route` in `tests/vercel-preview.test.cjs`, caused by an existing duplicate `frontend/client-dashboard.html`. The suite was not rerun merely to write these documents. Earlier reports quoting 134 or 138 tests are historical snapshots.

The audit used Unslop's core contract, report-only cleanup flow and Crisp Human preset, plus the frontend-design-pro review checklist. Four corpora were scanned: rendered landing copy including expanded FAQ answers, rendered sign-in, rendered access request, and a research-template corpus populated with synthetic values. No hard banned-phrase matches were found. The structure and silhouette tools raised soft repetition/coda flags. Navigation/footer repetition, form labels, card labels and necessary qualifications are protected; those flags do not justify rewriting the interface by themselves. Readability scores are approximate because the tools concatenate interface fragments into sentences. They are not evidence of authorship.

Source paths below are relative to `workstreams/avinash/frontend`, unless explicitly identified as repository-root paths.

## Issues found: claims, copy and navigation

### A01 — Sign-in promises an unavailable guest experience

**Priority: P1. Confirmed clarity problem.** The rendered sign-in says: “try the demo dashboard.” Its visible guest action returns to the public website, and a fresh unauthenticated dashboard session is denied. Normal showcase and auto-login should remain disabled.

**Change:** describe only the public website and local plan preview in this helper sentence. If a separate demonstration is ever offered, give it a distinct, correctly isolated route and explicit sample-data status.

**Preserve:** the live CRM gate, assigned-workspace requirement, guest link destination and session validation. Do not solve this copy problem by turning on showcase or auto-login.

**Source/check:** `frontend-source/login.html`; `frontend-source/matrix360-login-handoff.js`. Inspect the rendered result, because the handoff script removes some obsolete raw-HTML notices. Verify a guest still cannot open client records.

### A02 — FAQ navigation points to pricing

**Priority: P1. Browser-confirmed routing defect.** The sign-in help link is `pricing.html#faq`; the pricing route redirects to `index.html#m360-new-plans`. Clicking “Frequently asked questions” during the audit opened the plans section.

**Change:** point this link directly to the existing landing-page FAQ anchor. This is a local link correction; the pricing redirect should continue to use the single canonical plans section.

**Preserve/check:** existing pricing routing, login handlers and FAQ disclosure behavior. Click the help link from both sign-in tabs and verify the final URL and visible FAQ heading.

### A03 — Access-request wording hides the activation step

**Priority: P1. Confirmed expectation mismatch.** The form title is “Set up your client workspace.” The helper promises an emailed sign-in link. `lib/m360-onboarding.js` sends acknowledgement and team notification emails; its email body explicitly states that the workspace must be activated before sign-in. It does not create credentials or assign a workspace.

**Change:** make the form an access request, state that activation is required, and keep acceptance distinct from account readiness. The success state should confirm the request, not imply that sign-in will immediately succeed.

**Preserve/check:** `/api/onboarding`, required fields, length validation, rate limiting, mail configuration failures and existing notification behavior. Do not add automatic account provisioning or submit a live request as a copy test. Use mocked success, missing-configuration and mail-failure checks.

### A04 — Control Center's no-send statement is too absolute

**Priority: P1. Confirmed internal contradiction.** `lib/m360-control-client.js` says “Nothing is published or sent externally from this page.” `emailReview()` in `lib/m360-research-client.js` can append an email-release interface to `m360-control-output` and submit an explicitly approved live email campaign.

**Change:** explain that drafting does not contact the audience and sending requires separate review and explicit approval. Distinguish audience outreach from calls to hosted AI and CRM services; the frontend is not an offline application.

**Preserve/check:** exact-version approval, consent filtering, role/provider/cap checks, confirmation, workspace/session guards, and the distinction between provider acceptance and confirmed inbox delivery. Never weaken these gates to make the wording true.

### A05 — Research title implies measured response

**Priority: P1. Confirmed certainty mismatch.** “Message strategy: what the market responds to” is stronger than the evidence shown. The adjacent notes say the guidance is a proposed interpretation, not measured campaign performance.

**Change:** label the material as message directions to test or messaging observed in the research. Use a performance heading only when actual campaign results support it.

**Preserve/check:** the observations, source references and qualifications. Report navigation currently finds headings by exact text. A heading change must update the matching title in the `reportNav` configuration as well, or the Messages jump button can silently stop working.

### A06 — Message explanations repeat their selection text

**Priority: P1. Browser- and source-confirmed explanation defect.** A selection's observation is repeated under “The idea” and again after “Start with this theme:”. The buyer-question and measurement paragraphs largely share one template across all four choices. The selector is functional; the distinct explanatory value is weak.

**Change:** keep the separate full-width detail panel, but organize each message around its specific buyer concern, supporting observation, approved proof required, proposed next step and test criterion. When evidence or an approved fact is absent, show that missing input rather than filling it with generic advice. The explanation must vary in substance, not only message number and observation text.

**Preserve/check:** `.m360-message-selector`, selected `aria-pressed` state, `.m360-message-detail`, safe text insertion, original observations and footnotes. Switching 1–4 must change the correct detail, preserve scroll position and work by keyboard. Deriving richer fields from a new AI response is a contract change and needs separate validation; rewriting static presentation text alone cannot create new research evidence.

### A07 — Audience rationale is reused as geography rationale

**Priority: P2. Confirmed source-level repetition.** “WHERE TO FOCUS” appends the same `audience_rationale` used for buyer fit. The “WHY THEY FIT” disclosure also incorporates the summary. These fields do not establish a separate geographic comparison.

**Change:** identify which statement is supported by buyer-fit evidence and which is a proposed search area. Add a distinct geographic rationale only when the report actually supplies one. Otherwise state that regional prioritization has not been established.

**Preserve/check:** the equal-height three-column template, mobile stacking, disclosure controls, and the actual `audience_industry`/`audience_location` values passed to discovery. Do not let a copy change silently expand search geography or imply measured regional demand.

### A08 — The comparison explanations need more specific implications

**Priority: P2. Confirmed repetition, with an important protection.** The four interpretation cards reuse variants of “Explain your own relevant capability with concrete evidence.” The overall synthesis adds a similar instruction. This limits the value of the four separate observations.

**Change:** keep the four observations and final synthesis, as requested. For each observation, state what is established, what is unanswered and what approved evidence the client should obtain. The final bubble should identify the common decision and remaining uncertainty rather than restating all four cards.

**Preserve/check:** “not stated” must never become “competitor fails.” Public positioning does not prove service quality. The existing caution and final synthesis are useful and should remain. This is interpretation of a reviewed sample, not a market-wide score.

### A09 — Action details should identify the specific deliverable

**Priority: P2. Improvement, not a renewed switching bug.** The current action buttons switch correctly. Source code specializes several action types, but the fallback and some classifications still share broad implementation advice.

**Change:** make the expanded panel answer: what to produce, what approved information it needs, who reviews it, what the client does next, and what will be measured. Use the selected recommendation as the anchor. Do not invent a deadline, owner, spend level, discount or outcome.

**Preserve/check:** the working selector, full-width panel and selected state. Test two actions classified into the same broad stage; their useful details must still reflect the selected action. Preserve the existing real guidance that distinguishes tours, articles, outreach and events.

### A10 — Several labels describe the implementation instead of the task

**Priority: P2. Confirmed clarity issues, with different risk levels.** Examples observed include “Generate actual creative assets,” “Validate test CSV,” and the Control Center subtitle “AI assistant configuration” despite no corresponding configuration controls on its main screen.

**Change:** name the output or user action precisely. Distinguish a draft image, caption, saved version, CSV validation and CRM import. Remove “actual” where the format itself explains the output. Keep “staging” if that is genuinely the destination; verify the endpoint before relabeling it as a normal CRM import.

**Preserve/check:** button IDs, routes, submit types and dry-run/import separation. Tests may locate visible labels, so update only the affected expectations. A label change must not promote a staging action into production.

### A11 — Planning assumptions expose field keys

**Priority: P2. Confirmed source-level usability issue.** The missing-input state joins `forecast.missing` directly, which can expose names such as `investment_budget` and `expected_conversion_rate` to the client.

**Change:** map these existing keys to readable field labels and link to the matching Company Details inputs. Keep the field names in the request and calculation contract unchanged.

**Preserve/check:** missing-input handling, explicit currency and lead count, expected fractional customer values, exact scenario table, supplied assumptions and hypothetical disclaimer. Do not convert missing inputs into zeros, guaranteed returns or fabricated sliders.

## Issues found: research interpretation and information design

### B01 — Keep the competitor template; make dimensions appropriate to the client

**Priority: P1. Confirmed source limitation.** `strategyVisuals()` fixes the columns to “Land / plots,” “Warehousing,” “Infrastructure” and “Services / support.” It marks cells through keyword matching on observation strings. These headings suit the current industrial report but are not a general template for every Matrix360 client.

**Change:** preserve the visual table contract, company labels, evidence disclosures and distinction between Reported and Not stated. Introduce client-appropriate dimensions through an explicitly validated report structure, with a safe rendering fallback for existing saved reports.

**Risk:** medium; this reaches the response schema, parser, stored reports and renderer. Do not ship it as an untested CSS change. A phrase such as “no warehousing stated” can contain a matching keyword without supporting a positive capability claim. Validate negation, unknowns, duplicate competitors and evidence attribution.

**Preserve/check:** five verified competitors are a research target, not a quota to satisfy with invented names. The existing report already displayed five rows. Older reports with fewer supported competitors must still render.

### B02 — Bring source evidence closer to each conclusion

**Priority: P2. Confirmed information-placement issue.** Competitor rows expose observation text through “View evidence,” while the complete report source list lives in the full-text disclosure. The schema still accepts arrays of strings rather than source-bound structured findings.

**Change:** where a finding includes a source, show an accessible source link with the finding and its relevant date/context. Distinguish source text, report interpretation and proposed campaign action. Do not label a generic report source as proof of a specific cell unless the association exists.

**Preserve/check:** HTTPS and safe-link handling, `noopener noreferrer`, safe text rendering, existing complete source list and older saved-report compatibility. Never render arbitrary provider HTML or untrusted markdown without the existing safety boundary.

### B03 — Reduce repeated report layers

**Priority: P2. Confirmed source duplication.** `render()` adds strategy visuals, another four-card executive/audience summary, four lists of findings and recommendations, forecasts, then the complete text disclosure. A client can read the same audience, recommendation and uncertainty several times.

**Change:** keep one visible decision summary, the useful comparison and action views, and the full report in its existing disclosure. Make supporting lists optional where they merely repeat the same facts. Keep important limitations visible near the decision they qualify.

**Preserve/check:** original text remains available, sources remain reachable, report anchors still work, editable prompts remain separate, and the report is shown before discovery approval. Do not remove the raw report or approval step to shorten the page.

### B04 — Choose charts from available evidence, not from a visual quota

**Priority: P2. Design recommendation.** The industrial-size chart appears only when at least two comparable acre values are found. The saved report inspected during this audit had no scale rows. This is a valid missing-data state, not proof that the chart is broken.

**Change:** show a meaningful empty explanation when a requested comparison lacks comparable numbers. For future reports, allow appropriate sourced quantities and dimensions rather than requiring industrial acreage. Use sliders only for clearly marked, user-supplied planning assumptions. A negative financial result is clearer on a diverging axis than as an absolute-length bar distinguished mainly by its label and color.

**Preserve/check:** qualifiers such as “over” and “approximately,” units, non-conversion of bighas into acres, signed values, original observations and exact data alternatives. Do not fabricate market share, demand, ROI or conversion rates from counts of findings.

### B05 — Show research freshness in relation to the saved profile

**Priority: P2. Proposed state improvement.** Reports already show creation time and company-profile version. They should explain when a newer saved profile changes the assumptions under the report.

**Change:** compare report profile version with the current approved profile and show a clear review-needed state when appropriate. Offer an explicit refresh action with its existing permission/spend requirements; do not regenerate automatically.

**Preserve/check:** the old report remains available after a refresh failure. Do not overwrite its timestamp, evidence or version to make it look current. Test profile updates, reloads and workspace switches.

## Issues found: visual consistency, accessibility and responsive behavior

### C01 — Resolve native theme and extension conflicts deliberately

**Priority: P1. Browser-confirmed integration issue.** The landing page has its own authored theme and Dark Reader opt-out. Sign-in and the workspace do not share that treatment. The workspace's native switch was off while the extension displayed a dark page.

**Change:** first verify both native workspace palettes independently. Then apply a consistent policy for browser recoloring on pages that supply their own complete palettes. Sign-in is currently designed as a dark page; adding a day/night switch there requires a complete light palette, not simply changing the background.

**Preserve/check:** `m360-public-theme` and `m360-theme` are separate preference keys by design today. Do not silently merge them without a deliberate preference decision. Preserve system defaults, stored choices, readable status colors and logo treatment. Test native light/dark and extension coexistence separately.

### C02 — Increase small workspace touch targets

**Priority: P1. Measured in browser.** At 390 pixels wide, Sign out was about 31 pixels high, Dark mode about 39, several Outreach controls 38, the preview action about 41, and the floating return control about 39.

**Change:** extend hit areas to at least 44 pixels, with sufficient space around adjacent actions. Keep ordinary table text compact where useful, but do not make primary touch actions depend on small labels.

**Preserve/check:** button behavior, native disabled semantics and destructive-action separation. Confirm that larger targets do not collide, cover inputs or push important approvals behind a fixed element.

### C03 — Fix nested Outreach overflow without flattening tables

**Priority: P1. Measured in browser.** The document fitted 390 pixels, but a nested `.m360-grid-2` was 263 pixels wide with 320 pixels of scroll content. `m360-channels-section` and its parent also exceeded their own content widths.

**Change:** target the affected grid's minimum sizes, `min-width:0`, wrapping controls and narrow-screen column layout. Keep comparison/data-table scrolling inside its named, focusable region.

**Preserve/check:** all draft fields, previews, channel selection and approval controls. Research's 720-pixel comparison table inside a roughly 267-pixel mobile scroller is intentional; retain horizontal access and the sticky company column rather than shrinking the text until unreadable.

### C04 — Complete sign-in tab semantics and the visible heading hierarchy

**Priority: P2. Browser-confirmed accessibility omissions.** Account tabs expose selected state and support arrow navigation, but no `aria-controls` or tabpanel relationship was present. At 390 pixels the promotional h1 is hidden and the visible sign-in title remains h2. The public landing page has no skip link; the workspace already has one.

**Change:** label the sign-in action as the page's main heading, connect each tab to its panel, and use a standard roving tab index. Add a visible-on-focus skip link to the landing page and sign-in.

**Preserve/check:** existing `form-title`, `signin`, `signup`, `tab-login`, `tab-signup`, `switchTab()`, password visibility, autofill and POST-only credential submission. Test keyboard order, arrow/Home/End behavior, validation focus and a screen-reader pass. Do not replace working native inputs with decorative custom fields.

### C05 — Make saved-content controls distinguishable

**Priority: P2. Browser-confirmed label repetition.** Content Creation exposes many controls called “Reopen.” A screen-reader or keyboard user cannot tell which saved version a standalone control opens from its name alone.

**Change:** retain the visible short label if desired, but provide an accessible name containing the associated asset title/version/date and group it with its preview. Separate active-editing actions from archived-version actions.

**Preserve/check:** exact saved asset/version references, retry-save versus regeneration, undo/redo, archive retrieval and workspace checks. A labeling change must never generate a replacement image or load another workspace's asset.

### C06 — Use explicit data and operation states

**Priority: P2. Workflow presentation proposal.** The product has multiple legitimate states: configured, reachable, generating, generated, saved, draft, approved, submitted and delivered. The interface should not collapse them into a general green “ready” state.

**Change:** pair a short operation state with its next safe action. Keep errors beside the relevant result and let the user retry that operation. Use counts for known discovery progress and a phase indicator for unknown duration; do not invent percentages. Put long technical diagnostics in an optional detail area.

**Preserve/check:** no actual delivery claim from SMTP authentication or provider acceptance; no buyer-intent claim from website matches; no save success before durable storage; no automatic retry that repeats a paid generation or send. Current service availability was not probed by starting jobs in this audit.

### C07 — Consolidate styling and navigation ownership in a separate cleanup

**Priority: P2. Source-level maintenance risk.** Base HTML, `matrix360-ui-theme.css`, workspace-theme CSS, injected styles, polish CSS and motion CSS overlap. The public theme is an additional landing-only layer. Control Center removes older navigation while polish creates a navigation view from existing route controls.

**Change:** establish one owner for navigation and a scoped token/component layer for appearance. Migrate one component at a time after its current behavior is covered. Removing arbitrary `!important` rules or deleting a route-control source can restore retired blocks or break navigation.

**Preserve/check:** canonical route/query/hash behavior, the six destinations, browser back/forward, retired-section suppression and asynchronous mounting. Keep this refactor separate from copy corrections so a merge can isolate regressions.

## Judgment calls and optional polish

These are design choices rather than confirmed functional failures. They should not displace the P1 fixes.

1. **Reduce repeated marketing abstraction.** The landing copy repeatedly uses “growth,” “intelligence,” “coordinated,” “commercial objectives” and similar language. Prefer concrete examples where a paragraph adds no new mechanism or decision. Keep the approved hero slogan; repetition alone is not proof of poor or AI-written copy.
2. **Make the landing-page explanation shorter without deleting the experience.** With all FAQ answers open, the page measured about 9,983 pixels high at 1280 pixels wide. Retain the sticky story and capability/trust sections the user likes. Combine overlapping explanations and prioritize the existing goal preview rather than adding more sections or fake testimonials.
3. **Clarify calls to action.** “Explore your growth plan,” “Describe your growth goal” and “Preview my growth plan” describe different points in one flow. A more consistent action vocabulary can reduce hesitation. Keep distinctions between scrolling to the brief, generating a local illustrative preview, requesting access and opening an authenticated workspace.
4. **Keep dashboard motion restrained.** The landing-page video and pointer scenery are appropriate for the brand page. More parallax around client tables, form fields or approvals would reduce scanning stability. Keep decorative movement outside control geometry and preserve the fixed chapter-selection logic.
5. **Remember an explicit Pause choice.** Pause works in the current page, but motion starts from an unpaused state on a fresh load. A separate non-sensitive preference could retain a user's choice. System reduced-motion must continue to take precedence. Do not store this in session-token fields.
6. **Make examples relevant to the current task.** Control Center's dentist placeholder is unrelated to the industrial workspace reviewed. A neutral example or approved profile-based example would fit better. The word “verified” in a requested search is not itself an achieved-result claim and is not automatically a copy defect.
7. **Improve visual hierarchy in long details.** A short conclusion followed by compact evidence, required input and next-step sections would scan better than several similarly weighted paragraphs. Keep the separate expanded message panel and action detail that now work.
8. **Profile motion before optimizing it.** Multiple atmospheric layers, video and scroll handlers may justify a performance trace, especially on slower devices. No frame-rate, Core Web Vitals, battery or low-end hardware measurement was performed here, so this audit does not label the site slow.

## Language to protect

Unslop is not a reason to remove meaningful qualifications or turn every heading into terse fragments. Retain the following distinctions:

| Current distinction | Why it is useful |
| --- | --- |
| “Hypothetical” planning and supplied assumptions | Prevents forecasts being presented as actual results or guaranteed returns. |
| “Not stated” rather than “not available” | Missing public evidence does not prove a competitor lacks a service. |
| “Nothing sent” after draft preparation | Accurate at that stage; keep its scope tied to the actual operation. |
| “SMTP authentication verified” versus inbox delivery | Connection success does not establish campaign delivery. |
| Approved company facts versus competitor observations | Research does not authorize new claims about the client's own offer. |
| Source-supported industry/location versus purchase intent | A website match does not identify a ready buyer or verify all contact details. |
| Local illustrative plan versus sourced research | The public preview is generated locally and is not a live market survey. |
| Five competitors when supported, fewer otherwise | A target must not cause invented or irrelevant competitors to be displayed. |
| Password visibility, reduced motion, native forms and error states | These improve access and recovery; they are not decorative clutter. |

## Safe implementation sequence

| Phase | Work | Risk and required check |
| --- | --- | --- |
| 1 | A01–A05, A10–A11: copy, FAQ destination, clearer labels and readable assumption names | Low to medium. Update exact-heading report navigation and affected label-based tests; keep request keys and handlers. |
| 2 | C02–C05: target sizes, targeted overflow repair, tab/heading semantics, accessible saved-version names | Low to medium. Browser keyboard/mobile checks plus the affected regressions. No changes to routes, forms' business behavior or asset IDs. |
| 3 | A06–A09 and B03: improve explanations and remove redundant visible report layers | Medium. Test each selector with distinct and same-category items; original report and prompts remain accessible. No invented facts. |
| 4 | B01–B02 and B05: richer source-bound research fields and freshness state | Medium/high relative to styling. Schema validation, older-report fallback and tenant/session lifecycle tests are necessary. Do not replace the existing report schema wholesale. |
| 5 | C01 and C07: complete cross-page theming and consolidate CSS/navigation | Medium. Separate commits/components; verify native themes, extension behavior and every route before removing old rules. |
| 6 | Optional copy compression, performance work and remembered Pause preference | Separate, reviewable changes. Preserve the visual direction and existing motion safeguards. |

## Functionality-preservation checklist

Before accepting any implementation or merging it into Romit's build:

- Preserve all login and workspace authorization checks. Keep `signin` POST behavior, password clearing, expiry validation and the assigned-workspace requirement.
- Preserve existing service contracts and integration destinations. Do not deploy the recovery CRM backend or enable showcase, auto-login, paid generation or sending as a styling fix.
- Retain Control Center prompt editing, one-essential-clarification behavior, cancellation, report-first reading order and explicit handoff approval before Leads, Content AI and Outreach.
- Keep report text, source links, selected action/message state and older saved reports. Never turn text into unsanitized provider HTML.
- Preserve qualification, source evidence, deduplication behavior, tenant-bound checkpoints and partial/fewer-than-requested discovery results.
- Retain exact saved creative references, version history, retry-save semantics, undo/redo and private asset authorization.
- Preserve draft/approval hashes, consent and suppression checks, operator confirmation and the distinction between test email, live email and provider acceptance.
- Preserve Company Details values, asset roles, profile versions and file validation. Do not reset forms or overwrite saved fields while reformatting them.
- Verify all six route destinations, deep links, back/forward, selected navigation state, retired-block suppression and refresh behavior.
- Test 390-pixel mobile, tablet, normal desktop, native light/dark, reduced motion, keyboard focus, long labels and long reports. Keep horizontal scrolling local to appropriate data regions.
- Run relevant tests after each phase, then the full suite. Do not mark the known deployment-route test as passed or delete its assertion to make the suite green.

## Merge caveat

The current checkout is dirty on `work/mayur` at HEAD `2194ba78a2112051db22f4dfad9b678c0013f80f`. This report does not authorize a commit or push to that branch. Avinash's actual Git transport identity and the destination branch/deployment behavior still need verification before publishing changes. Romit's current build was not supplied for a three-way comparison. Use the companion functionality handoff for the local change inventory; do not copy the whole sensitive archive or assume every untracked file is part of this work.
