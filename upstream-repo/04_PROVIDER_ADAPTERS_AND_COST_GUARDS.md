# Provider adapters and cost guards

Implemented in `lib/m360-provider-adapters.js`; email uses the native SMTP transport in `lib/m360-smtp-client.js`, and the remaining providers use injected HTTP transport:

| Provider | Verification/request shape | Current state |
|---|---|---|
| Brevo email | SMTP AUTH LOGIN over STARTTLS/implicit TLS; separate authentication verification; SMTP `250` acknowledgement and Message-ID | LIVE AUTH VERIFIED; one local execution records provider acceptance, but inbox delivery and webhook evidence remain unverified |
| WhatsApp Cloud | versioned Graph phone verification and `/messages`; template + consent required | MOCK_TESTED; manual click-to-chat remains non-send |
| Facebook/Instagram | versioned Graph destination/tasks and publish request | MOCK_TESTED; Page/professional account required |
| LinkedIn | user verification and versioned REST Posts request | MOCK_TESTED; vetted organization access required |

All adapters default blocked. `mode=mock` returns a response explicitly tagged `mock`; it cannot create delivered CRM state. Live email additionally requires `MARKETING_LIVE_SEND_ENABLED=true`, a consent-eligible allowlisted audience, a positive message cap, an exact approved draft hash, operator approval and the phrase `SEND_APPROVED_EMAIL_CAMPAIGN`. The showcase UI has a narrower controlled-test path: one explicitly entered server-allowlisted address, an approved Email draft, verified SMTP, operator approval from the Send button and the same positive cap; it does not ask the user to type the bulk approval phrase. Wildcard recipients and zero/unlimited message caps are rejected. Each accepted SMTP response is recorded as `provider_accepted`, never as delivered. A Brevo bearer-authenticated webhook route can persist later provider events when the durable store is active.

WhatsApp, Facebook/Instagram and LinkedIn remain draft/mock interfaces: their live execution paths are intentionally disabled until their provider identities, permissions, destinations and durable acknowledgement storage are verified.

No pricing entitlement is asserted. Confirm provider/account-specific pricing and policy immediately before controlled testing. Paid-message and paid-ad defaults remain zero/false.
