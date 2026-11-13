# Avinash SaaS Frontend Integration Guide
## Connecting Mayur's Autonomous Lead Engine to `client-dashboard.html`

### 1. Overview
Mayur's Autonomous Lead Discovery & Verification Engine runs as a high-performance FastAPI + Playwright service on port `8765` (or cloud-hosted on Render).

It is now integrated with Avinash's SaaS Frontend and CRM backend:
- Exposes CORS headers for `client-dashboard.html`
- Provides health status at `GET /api/health`
- Provides real-time metrics at `GET /api/status`
- Provides direct CRM injection at `POST /api/leads/push-to-crm`

---

### 2. Frontend Integration (Zero-Friction Script Tag)

Add one line to `workstreams/avinash/frontend/client-dashboard.html` before `</body>`:

```html
<script src="../../mayur/frontend-integration/matrix360-audience-bridge.js"></script>
```

When added:
1. It automatically pings `http://localhost:8765/api/health` (or `window.MATRIX360_AUDIENCE_ENGINE_URL`).
2. Switches the Audience Intelligence card in `client-dashboard.html` from:
   `INTEGRATION PENDING` -> `ENGINE CONNECTED` (Green live badge).
3. Displays the count of verified leads available in SQLite (`leads.db`).
4. Updates the action link to open Mayur's Lead Dashboard with one click.

---

### 3. CRM Lead Push API Contract

To push verified leads from Mayur's engine into an authorized Avinash CRM workspace:

**Endpoint:** `POST /api/leads/push-to-crm`  
**Request Payload:**
```json
{
  "workspace_id": "lakhotia",
  "auth_token": "<user-session-bearer-token>",
  "crm_api_base": "http://localhost:8000",
  "stage": "qualified",
  "limit": 100
}
```

**Response:**
```json
{
  "status": "completed",
  "pushed": 100,
  "failed": 0,
  "total_attempted": 100,
  "workspace_id": "lakhotia",
  "errors": []
}
```
Each lead is inserted into Avinash's `m360_leads` table under the specified workspace with name, executive contact, verified phone, verified email, and niche details.
