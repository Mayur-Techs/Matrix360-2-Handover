# Matrix360 Marketing AI Engine Contracts & API Specification

## 1. Introduction
This document outlines the API contracts, schemas, authorization rules, and endpoints implemented for the **Marketing AI Master Engine**.

## 2. API Endpoints

### 2.1 Dispatch Campaign Task
- **Route:** `POST /api/marketing/dispatch`
- **Purpose:** Initiates a new marketing campaign task using a canonical `HandoverEnvelope`.
- **Request Body:**
  ```json
  {
    "workspace_id": "shree_heights",
    "origin_module": "overview",
    "prompt": "Market Shree Heights to qualified Chandannagar diaspora across WhatsApp and Email",
    "selected_channels": ["WhatsApp", "Email", "LinkedIn", "Instagram"]
  }
  ```
- **Response (`202 Accepted`):**
  ```json
  {
    "status": "accepted",
    "correlation_id": "uuid-...",
    "task": {
      "campaign_id": "cmp_shree_heights_...",
      "status": "draft_ready",
      "step_history": [...]
    }
  }
  ```

### 2.2 Query Task Status
- **Route:** `GET /api/marketing/tasks?workspace_id=<id>&correlation_id=<id>`
- **Purpose:** Returns the complete task state, active channel draft versions, and readiness gates.
- **Response (`200 OK`):**
  ```json
  {
    "status": "ok",
    "task": {
      "campaign_id": "cmp_...",
      "correlation_id": "...",
      "workspace_id": "shree_heights",
      "status": "draft_ready",
      "strategy": { ... },
      "channel_draft_versions": { ... },
      "channel_readiness": { ... }
    }
  }
  ```

### 2.3 Live Progress SSE Stream
- **Route:** `GET /api/marketing/events?correlation_id=<id>`
- **Purpose:** Emits live Server-Sent Events as the task progresses through multi-engine steps.

### 2.4 Surgical Channel Revision
- **Route:** `POST /api/marketing/revise`
- **Request Body:**
  ```json
  {
    "workspace_id": "shree_heights",
    "correlation_id": "uuid-...",
    "revision_instruction": "Shorten WhatsApp and make LinkedIn more formal, keep Instagram unchanged",
    "target_channels": ["WhatsApp", "LinkedIn"]
  }
  ```
- **Response (`200 OK`):** Returns updated task where ONLY target channels have their version incremented.

### 2.5 Approve Channel Draft
- **Route:** `POST /api/marketing/approve`
- **Request Body:**
  ```json
  {
    "workspace_id": "shree_heights",
    "correlation_id": "uuid-...",
    "channel": "WhatsApp"
  }
  ```
- **Response (`200 OK`):** Updates Gate 1 to `approved`.

### 2.6 Reverse Handoffs (Leads / Content -> Marketing)
- **Route:** `POST /api/marketing/handoff`
- **Request Body:**
  ```json
  {
    "workspace_id": "shree_heights",
    "origin_module": "leads",
    "artifact_refs": [
      { "id": "snap_leads_24", "type": "lead_snapshot" }
    ]
  }
  ```
- **Response (`200 OK`):** Mounts audience into active campaign workspace.
