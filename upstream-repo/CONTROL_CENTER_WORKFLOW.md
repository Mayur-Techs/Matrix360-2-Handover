# Control Center workflow — first implementation

## Implemented

Control Center remains the client's entry point. Campaign, research, prospect and content requests can now use the Research coordinator before specialist execution. General questions retain the existing Control Center AI path.

1. Company Details collects company identity, industry, description, products, audience, service areas, expansion goals, research constraints and optional economic assumptions. An incomplete saved profile opens Company Details during workspace startup. Existing saved complete profiles do not trigger onboarding.
2. Market Research uses the configured `OPENAI_API_KEY` and Control Center model with web search. It returns public sources, research time, profile version, proposed buyer industry/location, competitor observations, content trends, creative brief, regional hypotheses and limitations. A report without sources or usable audience filters cannot launch discovery or content generation.
3. The master sends the research filters to the existing `M360LeadsSubAgent.executeFromMasterAgent`. The working lead engine was not edited. A prospect-only request stops after discovery.
4. The master passes the research creative brief to the existing Content generator through `M360ContentAgent.create`. It creates one Email visual. Existing workspace checks, two-logo requirement, generation availability and budget checks remain. Initial prompting is handled by Control Center; Content Creation retains generated results and refinement controls. A content-only request skips discovery and stops after creation.
5. Campaign preparation verifies a generated poster ID against authenticated saved history before dispatching Outreach preparation. Control Center shows the generated image and caption. Existing Outreach dispatch reloads authenticated CRM contacts and saved content references; it does not accept a browser-forged contact list.
6. Control Center displays Email review, connection verification, exact-version approval and explicit confirmed-send controls using the existing authenticated Outreach API. Outreach retains its review screen for optional inspection. Planning, budget, calendar and draft journey controls move into Market Research. Other channel drafts remain in the underlying contracts but their tabs are hidden in Outreach.

## Economics

The scenario table requires explicitly supplied initial investment, revenue per converted client, delivery cost per converted client and assumed conversion percentage. It shows lower/base/higher conversion scenarios. Net profit is expected revenue minus delivery cost minus initial investment. Fractional expected customers are probability-weighted illustrative values. Missing costs, taxes, financing, development delays, title/zoning and land values are not silently invented. A report is not an appraisal, a guaranteed forecast, or authorization to buy land.

## Verification

- Mocked tests exercise role and cross-workspace denial, sourced-report validation, persistence/reload, missing company details, forecast arithmetic including zero values, and the research → leads → content → saved-history → Outreach sequence without any send endpoint.
- The first user-approved live research attempt stopped with HTTP 409 before an OpenAI call because industry and service areas were missing. With explicit user approval, only those two saved fields were filled from existing company information: Industrial land development; West Bengal and Odisha. All other profile fields were retained using the expected saved version.
- The approved follow-up research-only request returned HTTP 201, `research_ready`, with 12 public sources. Financial scenarios correctly remained `inputs_required` because no investment, revenue, delivery-cost or conversion assumptions were supplied. No discovery, image generation or email was started by that check.
- Research reports are stored in ignored local `frontend/data/market-research.json`, keyed by authorized workspace. This is local recovery, not shared hosted durability. All 124 regression tests pass under Node 24; mocked integrations are distinct from live research evidence.
- Review of the live model output found a conflicting land quantity and a suggestion to portray unbuilt development as site photography. The creative handoff now reconstructs its brief from audience/trend direction with explicit saved-approved-facts constraints, rather than forwarding the model's unreviewed factual copy or image directions. Existing saved reports receive the same safeguard when read. This constrains the handoff; it is not a claim that AI output can never contain an error, and factual review is still required before release.

## Live campaign verification — 2026-11-02

The user authorized a real Control Center campaign test using the configured OpenAI key, stopping before email sending. The final browser replay requested research for approved industrial land services, three prospects using research filters, and one Email creative.

- Research returned a sourced report using saved company profile version 9. Its proposed audience was manufacturing, warehousing, logistics and distribution in West Bengal and Odisha.
- The existing lead agent displayed `3 / 3 found`, with three result rows. Results were imported through its existing CRM flow. Discovery results still require relevance and contact review; this test does not certify buyer intent or lead quality.
- Content generated one real Email image and caption, saved its private editable version and branded final image, and displayed the image in Control Center.
- Outreach task `98db10d8-0e6d-4c97-863b-a96aacf24389` generated review drafts. The coordinator attached authenticated saved Content references and verified the generated poster ID was present. Final status: `Research, leads, saved creative and Outreach drafts ready for review. Nothing was sent.`
- The review card showed zero consent-eligible Email contacts and a disabled send button. No approval, test-email, execution or publishing action was taken. Financial estimates remained unavailable because the required investment and conversion assumptions were not supplied.

Failures found and fixed during replay:

1. CRM refresh after lead imports invalidated active Content state. Same-workspace refresh now preserves ready or running creative generation.
2. Research URLs entered the creative brief and triggered the existing non-sensitive brief validator. The handoff removes URLs and emails before truncating research direction; original report citations remain available.
3. Transient CRM 502/503/504 responses interrupted local auto-login. It now retries once; credential and permission failures remain failures.
4. Control Center checked saved history before the asynchronous creative archive completed. Content now awaits the real archive promise and reports save failures.
5. Outreach classification ignored the authenticated saved company industry and products. The classifier now receives those fields without inferring business type from the company name.
6. Control Center reported handoff success before checking the Outreach task. It now waits for draft readiness, surfaces failed task details, attaches saved creative references, and synchronizes the Outreach view with the prepared Email task.

## Remaining integration work

- Email delivery was intentionally not tested. Current discovery results and generated claims still need review before any release.
- Initial generation results and final Email approval/send controls are available in Control Center. Persistent step-level workflow resumption remains to be built; the current coordinator runs in the active browser session.
- Research web search identifies accessible public evidence; it cannot prove a complete regional survey or competitors' private performance.
- Current account role cannot approve or send campaigns. No role or hosted identity permission was changed.
- Restored strict recipient allowlists, positive message caps and deterministic recipient/version idempotency keys before adding the Control Center send controls. Wildcard recipients and zero/unlimited caps are blocked even if an old unrestricted-recipient flag is present. Concurrent-send and partial-batch recovery still require a durable execution worker before unattended release.
- No deployment, database migration or external publication was performed.
