# Engineering Handoff: Mayur (Marketing AI) to Avinash (Overview AI)

## 1. Executive Summary
This document establishes the binding integration contract between **Mayur's Marketing AI Master Engine** and **Avinash's Overview AI / Control Center**. Overview can now seamlessly dispatch marketing campaigns, monitor live multi-engine step progression, and receive structured campaign artifacts via stable REST and SSE endpoints.

## 2. Inbound Contract: Overview -> Marketing

### Endpoint
`POST /api/marketing/dispatch`

### Headers
- `Content-Type: application/json`
- `Authorization: Bearer <matrix360_pilot_token>`

### Request Payload (`HandoverEnvelope`)
```json
{
  "schema_version": "1.0",
  "envelope_id": "a823c45b-3f41-48e2-89ea-bc44081ef778",
  "correlation_id": "d3b07384-d113-46fb-9b2d-94c6f376cf45",
  "workspace_id": "shree_heights",
  "origin_module": "overview",
  "target_engine": "marketing",
  "prompt": "Market Shree Heights to qualified Chandannagar diaspora across WhatsApp and Email",
  "selected_channels": ["WhatsApp", "Email", "LinkedIn", "Instagram"],
  "idempotency_key": "idemp_overview_shree_20261030_01"
}
```

### Response (`202 Accepted`)
```json
{
  "status": "accepted",
  "correlation_id": "d3b07384-d113-46fb-9b2d-94c6f376cf45",
  "task": {
    "campaign_id": "cmp_shree_heights_...",
    "status": "draft_ready",
    "step_history": [
      { "step": "accepted", "detail": "Task accepted by Marketing Master Engine." },
      { "step": "requesting_leads", "detail": "Querying Leads AI for verified audience." },
      { "step": "audience_received", "detail": "24 verified leads mapped." },
      { "step": "requesting_content", "detail": "Requesting assets from Content AI." },
      { "step": "assets_ready", "detail": "Key visual and reel storyboard linked." },
      { "step": "draft_ready", "detail": "10-channel package initialized." }
    ]
  }
}
```

## 3. Query Contract: Overview -> Task Status

### Endpoint
`GET /api/marketing/tasks?workspace_id=shree_heights&correlation_id=d3b07384-d113-46fb-9b2d-94c6f376cf45`

### Response
Returns the full task state, current step history, 10-channel version tree, and 3-gate readiness metrics.

## 4. Live Progress Streaming: SSE

### Endpoint
`GET /api/marketing/events?correlation_id=d3b07384-d113-46fb-9b2d-94c6f376cf45`

Streams step-by-step updates as the task progresses from `accepted` to `draft_ready`.

## 5. Navigation & UI Integration
When Overview completes analysis or recommends continuing into Marketing:
- Overview renders button: `<button type="button" data-m360-goto="marketing">Review Campaign in Marketing Centre ->></button>`
- Clicking this pill automatically triggers `window.Matrix360Router.navigateToPage('marketing')`.
- Marketing Centre immediately mounts the synchronized campaign task matching the active `correlation_id`.
