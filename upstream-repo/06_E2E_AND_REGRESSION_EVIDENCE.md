# E2E and regression evidence

Baseline command: `npm test` -> 91 passed, 0 failed.
Final command on 2026-11-01: `npm test` -> 109 passed, 0 failed.

Keyless integration covers:

1. CSV mapping, validation, dedupe, leading zeroes and synthetic send block.
2. Overview envelope → Marketing task with approved context and correlation ID.
3. Isolated audience/content fixtures → ten channel drafts.
4. Real ISO monthly dates/timezone and pending statuses.
5. Exact-hash approval and non-sending preview.
6. Brevo SMTP verification plus a controlled showcase execution to one explicit allowlisted address through an injected adapter; response state is only `provider_accepted`, and the message cap blocks repetition.
7. WhatsApp, Meta and LinkedIn mocked HTTP response shapes; live calls fail closed.
8. Company Details reuse and a six-question maximum for the standalone Marketing conversation.
9. Calendar create/update/remove, journey-rule validation, real-date navigation, today marker and truthful counts.
10. Durable normalized writes with mocked responses; readiness remains disabled by default and sanitizes credential failures.
11. Authenticated specialist and CRM staging contracts with mocked responses.
12. Standalone showcase campaign creation and full CRM/Content/Overview coordination without an external CRM call.
13. Grounded active-channel AI revision with all untargeted channel versions preserved byte-for-byte; live provider/model calls remain separately authorized.
14. Draft preview before approval, simplified controlled-test authorization, and browser source checks that remove the typed approval phrase.

Mocks are test evidence only. No authenticated client login, hosted database migration, real Leads/Content job, webhook receipt or inbox delivery was verified. SMTP authentication now succeeds. The local state contains one earlier Brevo `provider_accepted` execution; acceptance is not delivery.

Credential check: the configured Brevo SMTP host authenticates successfully over TLS. The local live-send switch is enabled with a one-address allowlist, one-recipient limit and one-message cap. Brevo IP authorization, a domain-aligned sender and durable delivery evidence remain operational gates.

The final updated real Node site was started at `http://127.0.0.1:8050/client-dashboard.html#marketing`. The guided Marketing flow rendered in Chrome, WhatsApp draft preview returned `Draft preview prepared. Nothing was sent.`, Brevo showed `Verified connected`, and the browser console reported no errors.
