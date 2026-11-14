# LinkedIn administrator setup

Updated November 14, 2026. The implementation lives in this handoff; this document does not claim it has been deployed or accepted by LinkedIn.

## Configuration already prepared locally

File: `workstreams/avinash/frontend/.env.local`.

- `LINKEDIN_SAFETY_GUARDRAILS=false` — the user's chosen default. Authorized users can schedule saved content directly. Exact approval and the media-rights checkbox become optional.
- `LINKEDIN_TOKEN_ENCRYPTION_KEY` and `LINKEDIN_WORKER_SECRET` — generated locally without displaying their values. Preserve the encryption key when restarting/deploying; changing it requires reconnecting existing grants. Keep both server-side.
- `LINKEDIN_API_VERSION=202610`.
- `LINKEDIN_STORE_BACKEND=sqlite` for this local preview.
- `LINKEDIN_SCOPES="openid profile w_member_social"` for the initial personal-profile path.
- `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` remain empty. Supply the actual developer application's values.

No existing WhatsApp/email environment values were changed. No global LinkedIn access token is used by this service.

## LinkedIn developer application

1. Create/select the Matrix360 application in the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps). Configure its real company Page, verified organization details, website and privacy policy. Commercial Community Management access requires LinkedIn's applicable review; a client ID does not grant every product.
2. Enable Sign In with LinkedIn using OpenID Connect and the actual approved publishing product. Ask only for scopes the app has been granted.
3. Register the callback **exactly**, including path/query and port:
   - Current local value: `http://127.0.0.1:8000/client-dashboard.html?linkedin_callback=1`
   - Hosted value: `https://YOUR-MATRIX360-HOST/client-dashboard.html?linkedin_callback=1`
4. Set `LINKEDIN_REDIRECT_URI` to that registered callback. If LinkedIn does not allow the chosen local callback for your app, use an authorized HTTPS preview and register its exact URL.
5. Set `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and enabled `LINKEDIN_SCOPES` on the server. Do not paste customer access tokens into the UI. Restart the local server/worker after changes.
6. A real client signs into Matrix360, selects their workspace, opens Marketing → LinkedIn Campaigns & Publishing → Accounts → Connect LinkedIn, and completes LinkedIn's consent screen.

OAuth state is single-use, expires after ten minutes and is bound to the initiating Matrix360 session/workspace. Reconnect after expiry. Tokens refresh only if LinkedIn actually supplies usable refresh credentials; otherwise the UI requests reconnection.

## Capability and permissions matrix

| Operation | Required provider access | Current implementation |
| --- | --- | --- |
| Identify connected member | `openid profile` | OAuth + actual OIDC identity |
| Personal-profile publishing | `w_member_social` | Text, link, image, MP4, PDF |
| Page discovery/organic publishing | `rw_organization_admin`, `w_organization_social`, actual Page organic-create authority | Eligible Pages discovered and operation authority rechecked |
| Personal post read-back | `r_member_social` | Separate verified state; posting alone does not grant read access |
| Page post read-back | `r_organization_social` and Page authority | Separate verified state |
| Personal post analytics | `r_member_postAnalytics` | Actual available impressions/reach/reactions/comments/reshares |
| Page post analytics | `rw_organization_admin` and eligible Page authority | Actual organic share statistics |
| Invitations, unattended DMs/InMail | Restricted partner access/operation rules | Unavailable; no browser/private-API fallback |
| Comments/reactions management | Separate operation access | Scope information only; no automatic engagement tool |
| Lead Sync | Separate product/permission | Not implemented by this publishing adapter |
| Ads/spend | Advertising access and ad-account authority | Not implemented by this publishing adapter |

Read access/analytics failures are shown as unavailable, never zero or fabricated success. A successful publish response records the provider ID. Read-back additionally requires the same ID, author and `PUBLISHED` lifecycle.

## Local execution

Use Node 24 (verified locally with 24.22.1). From the handoff directory:

```powershell
npm start
```

In a separate process:

```powershell
npm run linkedin:worker
```

The worker polls every five seconds and handles one job per pass. `node tools/linkedin-worker.cjs --once` handles at most one due job; it is a real dispatch command, not a dry run. Do not run it with queued real posts unless publication is intended.

SQLite creates its schema automatically in `data/linkedin.sqlite`, outside the public frontend directory. Back up that database and the encryption key together. Do not use an ephemeral filesystem for production persistence.

## Hosted execution

The API is served through the existing Marketing function: `/api/linkedin` rewrites to `/api/marketing?action=linkedin`. This preserves the existing twelve-function deployment limit.

For Vercel/serverless API deployment:

1. Apply `workstreams/avinash/frontend/migrations/20261114_linkedin.sql` to the intended Supabase database using the administrator migration route. It creates only LinkedIn tables/functions. Existing campaign tables are not altered.
2. Set `LINKEDIN_STORE_BACKEND=supabase` on both API and worker.
3. Set `LINKEDIN_SUPABASE_URL` and `LINKEDIN_SUPABASE_SERVICE_KEY`, or reuse the existing `M360_MARKETING_SUPABASE_URL` / `M360_AI_TRIAL_SUPABASE_SERVICE_KEY` server settings. Never expose the service key in the browser.
4. Deploy a persistent Node worker running `node tools/linkedin-worker.cjs` with the **same** database, encryption key, app credentials and API version. Larger videos belong on this worker rather than a short-lived function.
5. An authenticated scheduler may alternatively POST `/api/linkedin?op=worker` using `Authorization: Bearer <LINKEDIN_WORKER_SECRET>`. Each invocation processes one job and must fit the host's execution/memory limits. Do not configure two competing social schedulers for the same campaign.
6. Verify actual worker heartbeat in Accounts and perform the acceptance sequence below. Merely setting environment values is not deployment evidence.

## AI, Brand Profile and Content Studio

AI uses the already configured `OPENAI_API_KEY`, `M360_OPENAI_TEXT_MODEL`/`M360_CONTROL_CENTER_MODEL`, and existing `M360_OPENAI_SPEND_APPROVED=yes|true` setting. This setting controls provider spending and is separate from LinkedIn review rules. No paid generation was invoked during implementation.

Save the workspace Brand Profile before AI drafting. Only the supplied objective, selected current draft and saved brand material are sent; the integration does not send CRM contact lists or third-party LinkedIn comments. Alternatives and missing-information notes are returned; drafts and publication remain separate outcomes.

Existing saved poster versions can be attached directly. Content Studio generation requests reuse `api/creative-media.js` and its existing provider configuration. A request stays queued/processing until that service returns a real completed job and a tenant-owned downloadable asset. The bridge stores the actual bytes as an immutable LinkedIn asset. It does not bypass that service's provider-cost settings, invent a video, or treat a job ID as completion.

Manual uploads support JPEG/PNG up to 20 MB, PDF up to 100 MB and MP4 up to **200 MB (Matrix360 resource limit)**. Uploads use 1 MB chunks; preview reads the same saved bytes. Provider processing enforces additional format, duration, dimension and document-page constraints. One media attachment or one link attachment per post is supported.

Results can link an existing CRM enquiry to a saved campaign. The server verifies that the lead ID belongs to the current workspace; it stores the ID, source, stage snapshot and optional evidence link, with a team-recorded attribution label. It does not create a prospect from engagement, copy contact fields into AI, or claim causation from a like/view. Existing first-party CRM intake remains the source of the enquiry.

## Guardrail inventory

| Control | Classification | Effect of `LINKEDIN_SAFETY_GUARDRAILS=false` |
| --- | --- | --- |
| Approval bound to exact text, author, media and schedule | Optional product workflow | No separate approval required before authorized scheduling |
| Media-rights acknowledgement checkbox | Optional product workflow | Not required |
| Recipient marketing opt-in list | Not applicable to organic publishing | No list/opt-in gate added |
| Matrix360 login and workspace membership/role | Required SaaS access control | Remains active |
| LinkedIn's OAuth consent screen | Provider authorization | Remains required by LinkedIn |
| Actual granted scopes and current Page/member authority | Provider authorization | Remains required by LinkedIn |
| Token encryption, expiry/revocation handling, one-use OAuth state | Credential/session correctness | Remains active |
| Tenant-owned immutable media and bounded file uploads | Data ownership/resource correctness | Remains active |
| Version conflicts, atomic claims, cancellation race handling | Execution correctness | Remains active |
| Unknown outcomes never blindly reposted | Duplicate/data-loss prevention | Remains active |
| Actual provider IDs and honest unavailable analytics | Evidence correctness | Remains active |
| Provider restrictions on APIs/data retention/AI inputs | Access contract | Not overridden by a product toggle |
| Existing AI/Content Studio cost configuration | Existing provider-spend settings | Unchanged |

Organic publishing does not deliver to a named CRM recipient list. Engagement is not imported as prospect data. No new WhatsApp/email consent or safety rules were added.

## Precise live acceptance

1. Configure the actual app and deploy the migration/API/worker; confirm the same persistent database and encryption key.
2. Sign in as a real workspace administrator and connect one authorized member. Inspect returned scopes and exact author. Connect a Page only if the app and member have its required access.
3. Save a real text post and, separately, a small real image/MP4/PDF. Review exact destination/content/date in the UI. Choose a finite explicit public test destination and content.
4. Queue the intended post; inspect the genuine provider ID. Where entitled, run read-back and retrieve analytics. An unavailable read scope is not publication failure.
5. Restart the worker with a future scheduled post; confirm one publication. Connect a second independent client and verify neither client sees the other's campaigns/assets/grants.
6. Test partial destination rejection and retry only the failed job. An unknown outcome requires checking the account and entering its actual post URN for matching read-back; without read permission it remains unresolved and is not blindly retried.

No live public test was performed or pre-authorized for arbitrary content by this implementation. Supplying credentials alone cannot substitute for LinkedIn product approval or the account holder's OAuth authorization.
