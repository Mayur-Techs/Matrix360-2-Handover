# Prompt-Driven Lead Generation Agent

A client-agnostic, prompt-driven lead research and qualification platform for non-technical users. 

A client simply describes their target customers in plain English and picks the desired number of leads (1 to 500) using a slider. Autonomous AI agents dynamically formulate qualification rules, discover candidate businesses via Google Maps, web search engines (Bing/Yahoo/Web), and public LinkedIn company footprints, crawl official websites with stealth protection, qualify leads, estimate company size, and deliver a downloadable spreadsheet-ready results file.

---

## 🔑 Adding Your API Keys

All keys are managed locally in the `.env` file located at:
`workstreams/mayur/ssscraper/.env`

Copy `.env.example` to `.env` if not already present:

```text
# Primary AI Key (OpenAI, OpenRouter, or Gemini)
LEAD_AI_API_KEY=your_openai_or_compatible_api_key
LEAD_AI_MODEL=gpt-4o-mini

# (Optional) Google Cloud Places API (New) Key
# If left empty, the tool automatically uses multi-engine web & LinkedIn discovery!
GOOGLE_MAPS_API_KEY=
```

> **Note:** `.env` is ignored by Git and will never be committed.

---

## 🚀 Running with Virtual Environment (venv)

Automated scripts are included for quick one-command setup:

### Windows:
```cmd
# 1. Run automated setup (creates .venv, installs packages and Playwright Chromium)
setup_venv.bat

# 2. Start the dashboard
run.bat
```
*(Or in PowerShell: `.\setup_venv.ps1` followed by `.\run.ps1`)*

### Linux / macOS:
```bash
# 1. Run automated setup
chmod +x setup_venv.sh run.sh
./setup_venv.sh

# 2. Start the dashboard
./run.sh
```

---

## 🐳 Deployment Guide

The application is fully containerized and deployable across Docker, Kubernetes, Cloud Run, Render, Railway, AWS ECS, or any Linux VPS.

### Option 1: Docker Compose (Recommended for Local/Server Deployment)
```bash
docker compose up -d --build
```
This automatically mounts persistent storage for `./data` and `./output` and exposes the dashboard on port `8012`.

### Option 2: Dockerfile Direct
```bash
# Build the container
docker build -t lead-research-agent .

# Run container with persistent volumes
docker run -d -p 8012:8012 \
  -e LEAD_AI_API_KEY="your_api_key" \
  -e LEAD_AI_MODEL="gpt-4o-mini" \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/output:/app/output" \
  --name lead-agent lead-research-agent
```

### Option 3: Cloud PaaS (Render, Railway, Fly.io, Cloud Run)
- **Render:** Connect the repo and select **Blueprint (`render.yaml`)** or deploy as a Docker web service using the root [`Dockerfile`](file:///c:/Users/MAYUR/Documents/ChatGPT/SSScraper/Martix---360--wip/Matrix360WIP/workstreams/mayur/ssscraper/Dockerfile).
- **Railway / Fly.io / Heroku:** The included [`Procfile`](file:///c:/Users/MAYUR/Documents/ChatGPT/SSScraper/Martix---360--wip/Matrix360WIP/workstreams/mayur/ssscraper/Procfile) and [`Dockerfile`](file:///c:/Users/MAYUR/Documents/ChatGPT/SSScraper/Martix---360--wip/Matrix360WIP/workstreams/mayur/ssscraper/Dockerfile) bind dynamically to `0.0.0.0` and `${PORT:-8012}`.
- **Health Checks:** A dedicated `/health` endpoint is included for container orchestrators and load balancers.

---

## 🛠️ Architecture & Agent Pipeline

1. **AI Planning Agent:**
   - Translates the client's plain-English prompt into targeted search queries and plain-English qualification rules.
   - Fully client-agnostic (no hardcoded locations, industries, or technical jargon).

2. **Multi-Source Discovery Agent:**
   - **Google Places API (New):** Utilized when a Google Maps API key is configured.
   - **Multi-Engine Search Discovery:** Leverages Bing, Yahoo, and Web search query automation via Playwright to discover official websites when Google Maps API key is omitted or to expand reach.
   - **LinkedIn Footprint Discovery:** Discovers company websites and company presence via public LinkedIn company searches (`site:linkedin.com/company/ ...`).
   - Automatically filters out aggregators and marketplaces (IndiaMart, JustDial, Yelp, Wikipedia, etc.).

3. **Official Website Evidence Agent:**
   - Follows site guidelines and navigates official company homepages and key sub-pages (`/about`, `/contact`, `/team`, `/products`).
   - Employs anti-bot stealth configurations (removes webdriver flags, realistic user agent, human pacing).
   - Auto-dismisses standard cookie/GDPR consent overlays.
   - Handles security/verification challenges gracefully without blocking the job.
   - Captures real-time full-page screenshots rendered in the dashboard sidecar.

4. **AI Qualification & Company Size Agent:**
   - Analyzes scraped website content using the AI model (`gpt-4o-mini`).
   - Computes a **Fit Score** (0 to 100) and **Fit Status** (`QUALIFIED`, `REVIEW`, `EXCLUDE`).
   - Estimates **Company Size** (`Startup (1-10)`, `Small (11-50)`, `Medium (51-200)`, `Large (201-1000)`, `Enterprise (1000+)`) based on workforce, facilities, and scale indicators.
   - Writes a **Plain-English Qualification Summary** for each company.

5. **Contact Validation & Deduplication Agent:**
   - Identifies executive roles (Founders, Directors, CEOs, Managers) and verifies phone/email formatting and DNS/MX domain validity.
   - Removes duplicate contacts and enforces target lead quotas.

6. **Export & Delivery:**
   - Provides one-click downloads:
     - **Spreadsheet-Ready Leads File (`leads-{job_id}.csv`)** with Company Name, Website, Fit Score, Company Size, AI Summary, Decision Maker, Role, Email, Phone, and Address.
     - **Full Evidence Audit Report (`report.json`)**.

---

## 🧪 Verification

Run the test suite to verify all agents and APIs:

```powershell
$env:PYTHONPATH="workstreams/mayur/ssscraper"
python -m pytest workstreams\mayur\ssscraper\tests
python -m compileall workstreams\mayur\ssscraper\app
node --check workstreams\mayur\ssscraper\app\static\app.js
```
