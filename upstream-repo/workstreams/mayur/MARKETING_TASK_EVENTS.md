# Matrix360 Marketing AI Task Events & SSE Specification

## 1. Overview
This document defines the real-time event streaming protocol, state transitions, and step progression for the **Matrix360 Marketing AI Master Engine**. The protocol ensures that both **Overview AI** and the **Marketing Centre** observe identical, live, server-persisted task progression without artificial UI delay or fabricated status.

## 2. Event Progression Lifecycle
The canonical multi-engine task progression follows 6 distinct operational milestones:

```text
[01 accepted] 
       │
       ▼
[02 requesting_leads] ─────► Query Leads & Pipeline AI for verified CRM snapshot
       │
       ▼
[03 audience_received] ────► 24 verified CRM leads mapped with opt-in status telemetry
       │
       ▼
[04 requesting_content] ───► Connect to Creative Studio for visuals and motion storyboards
       │
       ▼
[05 assets_ready] ─────────► Key visual (1200x630) and 15s motion reel storyboard attached
       │
       ▼
[06 draft_ready] ──────────► 10-channel drafts assembled with 3-gate readiness checks
```

## 3. Server-Sent Events (SSE) Interface

### Endpoint
`GET /api/marketing/events?correlation_id=<uuid>&workspace_id=<workspace>`

### Headers
- `Content-Type: text/event-stream; charset=utf-8`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

### Initial Connection Event
```http
event: connected
data: {"correlation_id":"d3b07384-d113-46fb-9b2d-94c6f376cf45","status":"listening"}
```

### Step Progress Event
```http
event: step
data: {
  "correlation_id": "d3b07384-d113-46fb-9b2d-94c6f376cf45",
  "workspace_id": "shree_heights",
  "step": "audience_received",
  "detail": "Received 24 verified contacts with consent telemetry.",
  "timestamp": "2026-10-30T01:15:00.000Z"
}
```

## 4. Reconnect & Polling Fallback
If SSE streaming is interrupted due to proxy timeouts or browser suspension:
1. The client immediately queries `GET /api/marketing/tasks?workspace_id=<ws>&correlation_id=<id>`.
2. The server returns the authoritative task object with `step_history` containing all previous timestamps.
3. The UI seamlessly synchronizes without resetting draft state or mutating unsaved user revisions.
