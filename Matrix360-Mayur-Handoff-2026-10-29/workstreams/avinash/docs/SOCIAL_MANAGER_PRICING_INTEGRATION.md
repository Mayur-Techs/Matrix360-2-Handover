# Matrix 360 — Pricing and Tanmayi Social Manager integration (21 October 2026)

## Pricing on the approved public website
- The original Director-approved `frontend/index.html` is **unchanged**. `frontend/matrix360-engagement.js` inserts an accessible pricing section before the growth-objective form, including a mobile navigation anchor.
- Reuses **indicative product-design amounts already in `pricing.html`**, not newly agreed commercial offers: Starter ₹4,999/month; Growth ₹19,999/month; Agency ₹49,999/month; Enterprise custom.
- These are **not contracted rates**. Payment, subscription activation, AI credits, third-party media usage and implementation fees are not wired. The page explicitly says so.
- `pricing.html` plan CTAs link to genuine `login.html`, not a simulation. Final rates require Director approval before public commercial launch.

## Real Tanmayi staging API contract inspected
- Separate staging service: `https://matrix360-socialmanager-recovery-staging.onrender.com`.
- Source: `workstreams/tanmayi/social-manager`, independently developed by Tanmayi on `work/tanmayi`.
- Tanmayi recovery is not a proven production SaaS. Internal staging uses a shared `X-Matrix360-Key`; it does **not** validate Supabase customer JWTs or enforce independent CRM tenant membership.
- Read-only integration: `GET /api/v2/clients`, `GET /api/capabilities`.
- Review-only plan: `POST /api/v2/creative-plan` with `client_id`, `prompt`, `platform`, 15-second concept and limited-fallback flag. This endpoint may invoke a paid semantic model if Tanmayi has one configured, so **provider/cost approval is required**.
- **Not connected by this patch:** cloud image generation, MP4 rendering, Pixabay, approvals, download, billing, social-platform posting or outbound outreach.

## Server-side security bridge
- `frontend/api/creative.js` is a Vercel Node function mounted at `/api/creative`. No Tanmayi secret is stored in HTML, browser JavaScript or the repository.
- It first verifies the CRM bearer access token against the **existing** Render `GET /me/workspaces`.
- It rejects all workspaces the authenticated user is not assigned to, then derives a deterministic internal client slug from the CRM workspace ID using SHA-256. **No static workspace mapping is needed for newly enrolled businesses.**
- After explicit staging authorization, it can **automatically provision** a missing client via Tanmayi's Director-protected `POST /api/v2/clients`; it provisions only the CRM-verified business name, an empty `approved_facts` list, no logo and the generic `Learn more` CTA. It does not transfer CRM leads or expose the operator/Director keys to browsers. GET capability checks never create records.
- POST prompts are manually submitted, 12–900 chars, checked for emails, phones and links; only bounded review-plan text is returned.
- Strict timeouts, JSON-only upstream responses, no redirects, no-store caching and a narrow fixed outbound host are required.
- `frontend/matrix360-creative.js` displays real capability/unavailable states, prompts and review-only output **only inside the authenticated CRM dashboard**; resets on workspace change or logout.

## Required Vercel Preview settings for automatic enrollment
Configure these on the **existing** Vercel `matrix360_frontend` Preview environment through authenticated project settings, then redeploy. **Never paste server keys in chat, tickets or GitHub.**

1. `M360_SOCIAL_OPERATOR_KEY`: Tanmayi staging's existing `MATRIX360_API_KEY` operator credential, securely transferred by its authorized owner. Used only for protected client listing and review-plan calls.
2. `M360_SOCIAL_DIRECTOR_KEY`: the **distinct** Tanmayi staging `MATRIX360_DIRECTOR_KEY` credential, supplied/authorized by the Director. Used **only** to enroll a verified, previously unknown tenant. Without this key, existing provisioned clients can still be read, but unknown businesses cannot auto-enroll.
3. `M360_SOCIAL_AUTO_PROVISION`: set to `yes` **only** after Director authorizes automatic recovery-staging client records. Never enabled by default.
4. `M360_SOCIAL_PLAN_APPROVED`: set to `yes` **only** after approving any potential AI/semantic-model provider charges. Without this, review-plan POSTs remain blocked.

**Obsolete for new businesses:** `M360_SOCIAL_WORKSPACE_MAP`. It is **optional**, supported only to preserve previously approved client IDs and their historical creative records. Malformed IDs and mapping to the shared `matrix360-demo` client are rejected. An unmapped CRM business is assigned `m360-` followed by the first 28 SHA-256 hex characters of `matrix360-crm-tenant-v1:<workspace ID>`, for a stable lowercase slug. For example, new CRM business accounts need no map entry.

**Runtime behavior:** a CRM-authenticated membership check happens on every API call; GET lists/probes without side effects; the first authorized POST checks a missing client, provisions if allowed, rereads on 409 race conflicts, then requests one *review-only* creative plan. Client-provisioning success does not imply completed posts or usable media. Separate paid media/render/publish controls remain disabled.

**Durability warning:** Tanmayi's current recovery registry uses `clients.sqlite` under an ephemeral Render Free filesystem. Enrollment can be lost on restart. This is only a controlled staging bridge, **not** durable production tenant provisioning. Before public SaaS, replace registry with shared durable storage and service-to-service tenant authorization, and coordinate engine-side changes with Tanmayi.

## Proof and remaining acceptance
- GitHub CI runs mocked `frontend/tests/test_social_bridge.cjs` and `frontend/tests/test_social_autotenant.cjs` including no-map tenant derivation, first-use enrollment, existing-client reuse, 409 concurrency, cross-tenant denial, unapproved-cost prevention, safe bridge secrets and legacy history compatibility; this is NOT a live end-to-end customer test.
- Preview API, Social Manager onboarding and model-provider availability are **unverified until Vercel preview environment variables are configured and a protected browser session performs staging tests**.
- Tanmayi must provision each selected client using her own credentials/Director approval on the separate engine. Avinash must not modify her source, override her approval controls or push to `work/tanmayi`.
- Even after review-only plan success, actual media generation, Director approval, persistent storage, playable reels and posting require a separate release gate and provider-budget authorization.

## Safe rollback
- Remove the `matrix360-creative.js` dashboard script reference and `api/creative.js` in a reviewed Avinash branch commit.
- Remove the appended pricing section from `matrix360-engagement.js` without editing the approved `index.html`.
- Existing Render CRM, Supabase data and Tanmayi service stay untouched throughout this change.
