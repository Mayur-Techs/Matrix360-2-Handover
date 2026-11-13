# Mayur — Dedicated Workstream: Matrix360 Audience & Industrial Lead Engine

**Directory:** `workstreams/mayur/`  
**Development Branch:** `work/mayur`  
**Scope:** Audience Engine V4, V5 safe capability bridge, Autonomous B2B Lead Engine, Industrial Web Extraction Sidecar, and Avinash CRM Integration Bridge.
**Boundaries:** Independent of Pratha's Campaign Console; retains zero secrets or hardcoded cloud credentials.

---

## 1. System Architecture

The Audience & Industrial Lead Engine is an autonomous multi-agent pipeline designed for high-quota (500 to 2,000+) lead generation with 100% verification guarantees.

```
workstreams/mayur/
├── Dockerfile                      <- Containerized production deployment
├── render.yaml                     <- Render cloud deployment manifest
├── requirements.txt                <- Pinned dependencies (FastAPI, Playwright, dnspython)
├── run.py                          <- Single-command local launcher
├── database.py                     <- SQLite leads.db + campaign suppression deduplication
├── v5_contract.py                  <- Local V5 schema/filter/strict-qualification contract (no cloud I/O)
├── frontend-integration/
│   ├── AVINASH_FRONTEND_INTEGRATION.md <- Bridge documentation for Avinash's SaaS frontend
│   └── matrix360-audience-bridge.js    <- Client-side script connecting to client-dashboard.html
├── scraper/
│   ├── __init__.py
│   ├── maps_agent.py               <- Google Maps crawler with West Bengal hub & zone expansion
│   ├── enrichment_agent.py         <- Decision Maker X-Ray, DNS MX verification & phone formatting
│   ├── crawler.py                  <- Playwright Chromium deep website & facility crawler
│   ├── domain_discovery.py         <- Search dorks & Lakhotia industrial pre-filter scoring
│   ├── exporter.py                 <- 26-column CSV builder & JSON reporting contract
│   ├── main.py                     <- FastAPI server + WebSockets + CRM push integration endpoint
│   └── templates/
│       └── dashboard.html          <- Dark-theme live dashboard with 500-lead quota controls
└── tests/
    └── test_engine.py              <- Unit & integration test suite (100% pass)
```

---

## 2. Integrated AI Agents

1. **Maps Discovery Agent (`scraper/maps_agent.py`)**:
   - Automated Google Maps feed scrolling via Playwright Chromium.
   - **State-to-Industrial-Hub Expansion**: Expands West Bengal into 18 manufacturing hubs (*Howrah, Kolkata, Dankuni, Durgapur, Asansol, Haldia, Siliguri, Kharagpur, Hooghly, Uluberia, Kalyani, Domjur, Falta SEZ*, etc.).
   - **Deep Zone Modifiers**: Combines niches with *"Industrial Area", "Industrial Estate", "Logistics Park", "Warehousing Complex", "SIDCO", "Phase 1/2"* to ensure continuous 500+ candidate throughput.

2. **Decision-Maker & LinkedIn X-Ray Agent (`scraper/enrichment_agent.py`)**:
   - Scrapes executive team/leadership cards on company websites.
   - Executes search dorks (`site:linkedin.com/in/ "{company}" {city} ({titles})`) to locate Founders, Owners, MDs, CEOs, and Plant Heads with verified profile URLs.
   - Filters out junior roles (*intern, trainee, assistant, clerk*).
   - Detects company employee size brackets (11–50, 51–200, 201–500, 1,001–5,000).

3. **DNS MX Email & Phone Verification Agent (`scraper/enrichment_agent.py`)**:
   - **Strict DNS MX Mail Server Verification**: Resolves domain MX records via `dnspython` + socket fallback. Rejects junk extensions and spam traps.
   - **Indian Phone Normalizer**: Normalizes mobile numbers and landlines (e.g. Kolkata `033`) to E.164 and rejects dummy entries.
   - **Off-Site Email Discovery**: Queries public web indexes if websites omit published emails.

4. **Lakhotia Pre-Filter & Facility Agent (`scraper/domain_discovery.py`)**:
   - Computes reproducible Lakhotia suitability scores (**PREPASS**, **REVIEW**, **EXCLUDE**) with confidence metrics.
   - Extracts physical facility evidence (*factory, plant, shed, godown, warehouse*).

5. **Campaign Suppression & Deduplication Database Agent (`database.py`)**:
   - SQLite persistent storage (`leads.db`) with full schema.
   - Deduplication across business names, domains, phones, emails, and Google Maps URLs.
   - Campaign suppression list table to prevent duplicate outreach or bounces.

6. **Autonomous Quota Pipeline Orchestrator (`scraper/main.py`)**:
   - Manages strict quota enforcement (`require_mode`: both verified email + valid phone).
   - Streams live progress over WebSockets.

---

## 3. Integration with Avinash's SaaS Frontend & CRM

### V5 safe capability bridge

The V5 contract is available locally at `/api/v5/*`. It is intentionally a
preview/integration surface: it does not alter existing lead records, use cloud
credentials, call an LLM, or infer interest from personal traits.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v5/engine/info` | Shows enabled V5 features and deliberately disabled modes. |
| `POST /api/v5/schema/resolve` | Resolves uploaded headers while preserving the original values. |
| `POST /api/v5/filters/company` | Produces reviewable filters from the imported schema. |
| `POST /api/v5/qualify/lead` | Produces an evidence-only `PREPASS`/`REVIEW`/`EXCLUDE` signal. |
| `POST /api/v5/dual-drive/manifest` | Produces a Drive hand-off plan only; it does not access Drive. |

`/api/v5/qualify/lead` is restricted to `strict_evidence` reasoning. It should
be used as a campaign-priority signal, never as proof of interest, consent,
identity, or deliverability. Raw phone values remain source values; any
normalised value must remain a separate field.

### Frontend Bridge
In `workstreams/avinash/frontend/client-dashboard.html`, add:
```html
<script src="../../mayur/frontend-integration/matrix360-audience-bridge.js"></script>
```
This automatically updates the **Audience Intelligence** feature card from *INTEGRATION PENDING* to **ENGINE CONNECTED** (live green badge) with verified lead counters and an interactive launch link.

### CRM Lead Push API
Mayur's backend provides `POST /api/leads/push-to-crm` to push verified leads directly into Avinash's CRM endpoint (`/workspaces/{workspace}/leads`).

```bash
curl -X POST http://localhost:8765/api/leads/push-to-crm \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "lakhotia",
    "auth_token": "<bearer-token>",
    "crm_api_base": "http://localhost:8000",
    "stage": "qualified",
    "limit": 100
  }'
```

---

## 4. Local Quick Start & Testing

```bash
# 1. Install dependencies
pip install -r requirements.txt
python -m playwright install chromium

# 2. Run test suite
python -m pytest tests/ -v

# 3. Launch Engine
python run.py
# -> Opens http://localhost:8765
```

### Reproducible Test Evidence
```
tests/test_engine.py::test_database_initialization PASSED        [ 16%]
tests/test_engine.py::test_phone_validation PASSED               [ 33%]
tests/test_engine.py::test_person_name_validation PASSED         [ 50%]
tests/test_engine.py::test_domain_mx_verification PASSED         [ 66%]
tests/test_engine.py::test_lakhotia_pre_filter_scoring PASSED    [ 83%]
tests/test_engine.py::test_suppression_and_deduplication PASSED  [100%]
============================== 6 passed in 3.48s ==============================
```

---

## 5. Deployment Options

- **Docker:**
  ```bash
  docker build -t matrix360-audience-engine .
  docker run -p 8765:8765 matrix360-audience-engine
  ```
- **Render:** Deploy directly using the included [`render.yaml`](./render.yaml).
