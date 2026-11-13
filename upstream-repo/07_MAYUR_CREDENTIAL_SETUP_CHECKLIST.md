# Mayur credentials-later checklist

Do not paste values into chat or Git. Put authorized values in `workstreams/avinash/frontend/.env.local` only.

## Shared application

- [ ] Avinash/Romit approve the staging Supabase project, migration and membership RLS helper.
- [ ] Configure existing CRM/Supabase variable names already listed in `.env.example`.
- [ ] Set `M360_KEYLESS_TEST_MODE=false` outside isolated testing.
- [ ] Keep `MARKETING_LIVE_SEND_ENABLED=false`, paid send false, max live messages `0` until written self-test approval.

## Email (Brevo selected first)

- [ ] Create/authorize Brevo account; verify sending domain and sender.
- [ ] Confirm marketing/transactional product rules, unsubscribe and suppression handling.
- [ ] Put the Brevo SMTP login and SMTP key (not the Brevo website password) into `BREVO_SMTP_LOGIN` and `BREVO_SMTP_KEY`.
- [ ] Confirm `BREVO_SMTP_HOST`, `BREVO_SMTP_PORT`, `BREVO_SENDER_EMAIL` and optional `BREVO_SMTP_CLIENT_NAME`.
- [ ] Generate a strong `BREVO_WEBHOOK_BEARER_TOKEN`; register the HTTPS callback only after the durable store and public deployment are ready.
- [ ] Use `BREVO_API_KEY` only for separately authorized Brevo API/webhook administration; SMTP sending does not require it.
- [ ] Allowlist one private self-test email; approve exactly one message.

## WhatsApp Cloud

- [ ] Meta Business verification as required; WABA and phone number ownership.
- [ ] Approved marketing/service template and correct category/language.
- [ ] App permissions/token with least privilege; webhook verify token/signature secret.
- [ ] Supply `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_GRAPH_VERSION`.
- [ ] Store explicit opt-in evidence for the one self-test number; review current rate card; approve any charge separately.

## Facebook / Instagram

- [ ] Authorized Facebook Page and eligible Instagram professional account linked to it.
- [ ] App review/permissions needed for Page/profile discovery and content publishing.
- [ ] Supply `META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_INSTAGRAM_ACCOUNT_ID`, `META_GRAPH_VERSION`.
- [ ] Allowlist test destinations; keep ads disabled; verify media URL/format accessibility.

## LinkedIn

- [ ] Community Management API access approval and organization admin/content role.
- [ ] Approved organization posting scope and callback URL.
- [ ] Supply `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_ORGANIZATION_URN`, `LINKEDIN_API_VERSION`.
- [ ] If access review is denied/pending, use draft/export/manual posting and label it so.

## Optional model AI

- [ ] Select approved model/budget; supply `OPENAI_API_KEY`, model variable, `M360_MARKETING_AI_ENABLED=true`, and explicit spend approval.
- [ ] Confirm telemetry/retention policy. Deterministic drafts remain labelled when disabled.

Email activation sequence:

1. Add the SMTP variables above while `MARKETING_LIVE_SEND_ENABLED=false` and `MARKETING_MAX_LIVE_MESSAGES=0`.
2. Sign in, select the authorized workspace and use **Verify Brevo connection**. This authenticates but does not send.
3. Put one consented private self-test address in `MARKETING_ALLOWED_EMAILS`; set `MARKETING_MAX_LIVE_RECIPIENTS=1` and `MARKETING_MAX_LIVE_MESSAGES=1`.
4. Review and approve the exact Email draft version. Set `MARKETING_LIVE_SEND_ENABLED=true` only for the controlled test.
5. In the controlled showcase, clicking **Send one test email** is approval for the single allowlisted address; the normal signed-in bulk path still requires `SEND_APPROVED_EMAIL_CAMPAIGN`. Treat the immediate result only as provider acceptance.
6. Independently confirm the provider event/webhook, then disable live send or increase caps only after written authorization.

Never paste credentials into chat or Git and never bulk-enable during verification.
