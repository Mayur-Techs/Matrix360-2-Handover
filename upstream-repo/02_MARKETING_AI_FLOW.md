# Marketing AI flow and contracts

```text
Company Details approved facts
        ↓
Overview request → HandoverEnvelope v1 → Marketing task/correlation ID
        ↓                              ↘ durable event contract
CRM/Leads snapshot ───────────────────→ campaign assembly ← Content task/assets
                                              ↓
ten channel versions → targeted revision → hash approval → dated calendar
                                              ↓
draft gate + audience gate + provider gate + human launch approval
                                              ↓
provider adapter (blocked unless separately authorized)
```

Authoritative envelope schema: `workstreams/avinash/frontend/contracts/handover-envelope.v1.schema.json`.

Routes:

- `POST /api/marketing/dispatch`: authenticated request; server binds workspace/business context.
- `POST /api/marketing/conversations` and `POST /api/marketing/conversations/:id/messages`: one essential question at a time, no more than six, then dispatch with the same correlation ID.
- `GET /api/marketing/tasks`: tenant-scoped task/list.
- `GET /api/marketing/campaigns/:id`, `/versions` and `/results`: tenant-scoped campaign review.
- `GET /api/marketing/events`: authenticated SSE replay from current task history.
- `POST /api/marketing/revise`: targeted channels only; preserved channel hashes stay unchanged.
- `POST /api/marketing/approve`: exact current content hash required.
- `POST /api/marketing/handoff`: production requires owning-engine verification; isolated keyless fixtures only when `M360_KEYLESS_TEST_MODE=true` and outbound-blocked.
- `POST /api/marketing/csv-preview`: isolated keyless validation only.
- `POST /api/marketing/csv-import`: authenticated forwarding to the configured CRM staging endpoint.
- `POST /api/marketing/coordination`: refreshes the active task from authorized CRM Leads, saved Content Studio versions and/or prepares Overview telemetry.
- `POST /api/marketing/estimate`: shared reach and A/B feasibility estimate.
- `POST/PATCH/DELETE /api/marketing/journeys`: bounded journey-rule drafts; these do not imply execution.
- `POST /api/marketing/providers/verify`: Brevo SMTP authentication check without sending.
- `POST /api/marketing/execute`: non-sending preview or tightly gated Brevo SMTP email; other live channels fail closed.
- `POST /api/marketing/webhooks/brevo`: bearer-authenticated provider events; durable storage is required.

No browser-supplied tenant identity, contact list, asset ID or provider state is treated as verified production evidence. Provider acceptance is not delivery.
