# Local build review — 2026-11-01

## What changed

- Added loopback-only auto-login through the existing CRM login endpoint. The account password stays in the ignored frontend `.env.local`; hosted authentication and workspace permissions remain enforced.
- Auto-login disables the fictional showcase on the main local server. Opening the dashboard obtains a real session automatically; the normal sign-in URL redirects to the workspace after successful authentication.
- Moved the Control Center return button outside the navigation header. It stays on screen, supports pointer/touch dragging and Alt + arrow keys, and remains within the viewport after resizing.
- Repaired shared palette overrides for Control Center, Leads, Content, Company Details and Marketing, including campaign steps, channel previews, badges, service cards, pipeline removal controls, inputs and primary buttons.

## Evidence

| Status | Check | Evidence / remaining owner |
|---|---|---|
| VERIFIED | Regression | Node 24.22.1, `npm test`: 116 passed, 0 failed. |
| VERIFIED | Local auto-login contract | Mocked real CRM login flow, server-only password, cookie creation, redirect and cross-site denial. |
| VERIFIED | CRM reachable | Hosted `/docs`: HTTP 200; `/health`: healthy `supabase-dev`; published version `0.7-dev`. |
| VERIFIED | Real auto-login | After the owner updated the private password, the dashboard returned HTTP 200 with a genuine automatic session. CRM workspace membership, stages and leads each returned HTTP 200. Browser navigation to `/login.html` opened the dashboard without a sign-in form; one authorized workspace and 40 CRM leads loaded. No credential values recorded here. |
| NOT RUN | New discovery and Content generation | Login and existing data access verified. No new lead job, billable generation or import was run during the access recheck. |
| PARTIAL | Content and Marketing permissions | Content Studio reports AI-post generation available and lists saved posters. Separate Social Manager text/reel controls report staging operator access not configured. The browser also reports that the current role cannot approve Marketing work. These remain separate configuration/permission issues. |
| VERIFIED | Light appearance | Browser computed-style scan found zero normal/large text contrast failures across the rendered Control Center, Leads, Content, Marketing and Company Details showcase pages after fixes. This is a local UI scan, not full accessibility certification or live-data testing. |
| VERIFIED | Floating navigation | Browser pointer drag changed position without navigation; Alt + arrow keys repositioned it; clicking returned to Control Center. |
| PARTIAL | Live email | Existing Brevo SMTP implementation is the only live send implementation. No new email or delivery check performed in this review. |

The isolated UI verification server uses port 8051. It shows fictional data and does not prove discovery or content services are online. The main auto-login preview uses port 8050 and now opens the authorized CRM workspace automatically.

## Marketing, in simple words

Marketing is a planning desk with an email sender attached.

- Tell it what you want to promote. It prepares a campaign using your company information.
- It writes drafts for Email, WhatsApp, Facebook, Instagram, LinkedIn, X, YouTube, Google Business Profile, SMS and Website.
- Ask it to improve one draft. It keeps the other drafts and earlier versions.
- Review and approve the exact message, and preview it before sending.
- Use the calendar to organize campaign dates. Calendar entries do not trigger automatic sending.
- Review audience contacts, CSV validation/import, and Content references. Real CRM and saved asset integration still needs live verification.
- Budget and A/B test figures are planning estimates, not measured results.
- Journey rules are drafts; no worker executes them yet.

**Email is the only live sending implementation.** Other channel drafts do not mean their send/publish integrations are connected. A provider accepting an email does not prove inbox delivery. Verified delivery, open and click analytics require durable provider events.

## Existing email discrepancy

Current email execution code allows `MARKETING_ALLOW_ANY_RECIPIENT`, treats nonpositive message caps as unlimited, and adds timestamp/random entropy to idempotency keys. This differs from the strict controls described by the handoff brief. These existing email behaviors were not changed during the Leads/UI task. Resolve them before broader outbound use.

## Local setup

Private `workstreams/avinash/frontend/.env.local`:

```dotenv
M360_LOCAL_AUTO_LOGIN_ENABLED=true
M360_LOCAL_AUTO_LOGIN_USERNAME=<existing authorized CRM account>
M360_LOCAL_AUTO_LOGIN_PASSWORD=<private CRM password>
```

Use Node 24 and `PORT=8050` when starting `npm start`. Keep the preview bound to `127.0.0.1`; auto-login gives users of this machine access to the configured account. Do not expose it through a network bind or public tunnel.

No password reset, user creation, identity change, database migration, publication or campaign send was performed.

## Control Center authentication recovery

The reported `Could not contact CRM authentication service` message came from the exception path of a single 10-second membership lookup. Subsequent read-only checks succeeded (HTTP 200), so a persistent credential rejection was not reproduced.

Control Center now retries only the read-only membership lookup once for network exceptions or HTTP 502/503/504, with a 15-second limit per attempt. HTTP 401/403 are never retried into permission success, and every successful response still verifies the requested workspace. AI calls and discovery jobs are not retried by this change. The browser request deadline is 90 seconds to accommodate the bounded authentication recovery, profile lookup and existing AI deadline.

After the user explicitly approved one live replay, `POST /api/control-center` with `Find 10 prospects for my business.` returned HTTP 200 in 8,987 ms. Category: `clarification_required`. Question: `Type of prospects or industry focus`. Handover required: false. No discovery job was started by this API check.

## Outreach rename and Brevo connection check

- Renamed the workspace heading, navigation, Control Center handoff labels and assistant copy to Outreach. Existing `marketing` routing keys, URLs, APIs and saved campaign contracts remain compatible.
- Reproduced the reported issue: the account's `sales_operator` membership received HTTP 403 with `Your role cannot approve Marketing work.` before SMTP authentication ran. The browser incorrectly described every connection error as an SMTP-key rejection.
- Non-sending provider verification now requires workspace write access. Viewers and other workspaces remain denied; approval and execution still require an approver role.
- The browser shows actual permission/network errors, identifies SMTP-key rejection only from its explicit provider error code, prevents concurrent verification clicks, and ignores results after switching workspace.
- Outreach now initializes saved-task state when asynchronous CRM workspace loading completes.
- Live verification after the fix: `POST /api/marketing/providers/verify` returned HTTP 200, `verified: true`, `status: verified_connected`, transport `smtp_tls`. The browser button displayed `Verified connected`.
- No email was sent. No provider credential or account permission was changed. This verification does not prove sender-domain readiness or inbox delivery.
