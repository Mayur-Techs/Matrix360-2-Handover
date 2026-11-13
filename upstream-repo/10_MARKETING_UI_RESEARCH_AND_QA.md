# Marketing UI research and QA

## Design direction

Purpose: help a first-time business user turn Company Details into channel-ready campaign messages, review them and run one controlled email test.

Audience: non-technical owners and marketing operators. Tone: calm, guided and evidence-based. The primary workflow is now four visible steps; engineering coordination remains available under Advanced tools.

Research applied:

- GOV.UK recommends one focused question at a time so users can understand and answer it. Matrix360 now asks for one campaign goal and presents one missing essential at a time: https://design-system.service.gov.uk/patterns/question-pages/
- GOV.UK recommends specific plain-English errors that explain how to fix the problem. Brevo failures now say that the SMTP login/key was rejected and point to the exact Brevo settings page: https://design-system.service.gov.uk/components/error-message/
- Mailchimp structures campaign creation as a checklist covering recipients, sender, subject, schedule and content. Matrix360 exposes the comparable sequence as Describe, Review, Choose audience/test address and Approve/send: https://mailchimp.com/help/create-and-send-regular-email/
- Mailchimp separates preview/testing from sending and asks users to confirm audience permission. Matrix360 allows a non-sending draft preview while retaining consent gates for bulk sends: https://mailchimp.com/help/tips-for-sending-campaigns/
- Brevo documents that SMTP authentication requires the Login value plus an SMTP key, not the API key or account password. The current local pair is rejected before message submission: https://help.brevo.com/hc/en-us/articles/115000188150-Troubleshooting-Issues-with-Brevo-SMTP

## Verification

- `npm test`: 109 passed, 0 failed.
- Desktop Chrome: guided flow, channel draft, calendar and test-email panel rendered; no console errors.
- Mobile Chrome at 390x844: single-column content, readable controls and swipeable page navigation.
- WhatsApp preview: `Draft preview prepared. Nothing was sent.`
- Brevo no-send authentication: `SMTP_AUTHENTICATION_REJECTED`; no email was submitted.
- Evidence record: `qa/marketing-ui-2026-11-01/evidence.json` passed the frontend-design evidence checker.

## Remaining live boundary

The current saved campaign records live AI provenance (`gpt-4.1-mini`, 850 tokens) from its earlier generation. New grounded revision logic is mock-tested, but a new paid OpenAI smoke request was not run in this change because that call requires separate approval for the payload and cost.
