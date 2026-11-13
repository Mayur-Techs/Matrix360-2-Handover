# Matrix360 Phase 6: Supabase Go-Live, Cross-Channel Analytics Dashboard & Pilot Progress Tracker

**Branch**: `mayur/phase6-golive-dashboard`  
**Started**: 2026-11-10T10:48:32+05:30  
**Baseline Exploit Harness**: 24 / 24 NOT REPRODUCED (`tools/audit/exploits.js`)  
**Baseline Test Suite**: 361 / 361 PASS across 11 test suites (`npm test`) on Node `v24.22.1`  

---

## Stage 0 — Baseline + Full Environment Inventory

### 1. Verification Baseline
- **Node Version**: `v24.22.1`
- **Exploit Audit (`tools/audit/exploits.js`)**: All 24 checks `NOT REPRODUCED`
  - E1, E2, W1, W2, C1, C2, V1, P1, P2, X1, S1, R1, M1, WG1, WG2, WG3, WG4, WG5, EM1, EM2, EM3, AI1, AI2, AI3 verified.
- **Node 24 Automated Test Suite**:
  - `ℹ tests 361`
  - `ℹ suites 11`
  - `ℹ pass 361`
  - `ℹ fail 0`
  - `ℹ cancelled 0`
  - `ℹ skipped 0`
  - `ℹ todo 0`

### 2. Environment Readiness Table (Names Only — Zero Secrets)

| Group | Variable Name | Status | Purpose |
| :--- | :--- | :--- | :--- |
| **Supabase** | `SUPABASE_URL` | **MISSING** | Supabase project endpoint URL |
| | `SUPABASE_ANON_KEY` | **MISSING** | Supabase client/browser key with RLS enforcement |
| | `SUPABASE_SERVICE_ROLE_KEY` | **MISSING** | Server-side administrative key (never sent to browser) |
| | `DATABASE_URL` | **MISSING** | Direct PostgreSQL connection string |
| **Vault** | `M360_TENANT_ENCRYPTION_KEY` | **MISSING** | 32-byte master key for AES-256-GCM tenant credential encryption |
| **Meta WhatsApp** | `META_APP_ID` | **MISSING** | Meta Developer App ID |
| | `META_APP_SECRET` | **MISSING** | Meta Developer App Secret |
| | `META_SYSTEM_USER_TOKEN` | **MISSING** | Permanent System User Token for Graph API |
| | `META_EMBEDDED_SIGNUP_CONFIG_ID` | **MISSING** | Meta Embedded Signup Configuration ID |
| | `META_GRAPH_VERSION` | **MISSING** | Meta Graph API Version (defaults to `v22.0`) |
| | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | **MISSING** | Webhook verification challenge token |
| | `WHATSAPP_APP_SECRET` | **MISSING** | Meta webhook HMAC-SHA256 signature secret |
| **Brevo Email** | `BREVO_SMTP_LOGIN` | **SET** | Brevo SMTP relay login username |
| | `BREVO_SMTP_KEY` | **SET** | Brevo SMTP relay key / password |
| | `BREVO_WEBHOOK_SECRET` | **MISSING** | Brevo webhook HMAC-SHA256 signature secret |
| **LLM Provider** | `OPENAI_API_KEY` | **SET** | OpenAI API key for AI Campaign Assistant copy generation |
| **Mode & Safety** | `M360_MARKETING_MODE` | **MISSING** | Defaults to `draft_only` (options: `draft_only`, `team_test`, `live`) |
| | `M360_TEST_RECIPIENTS` | **MISSING** | Comma-separated allowlist for `team_test` mode |
| | `M360_TEST_WORKSPACES` | **MISSING** | Comma-separated workspace allowlist |
| | `M360_MARKETING_DURABLE_ENABLED`| **MISSING** | Flag to activate persistent Postgres/Supabase storage |

*Honest assessment*:
Brevo SMTP relay credentials and an OpenAI model key are available in `.env.local`. Direct Supabase database credentials, Meta WhatsApp credentials, tenant master encryption key, and test recipient allowlists are currently unset. The system operates locally in fail-closed, honest mode where missing providers return `NOT-CONFIGURED` or `NO_MODEL_CONFIGURED`, and no values are fabricated.

---

## Stage Tracker & Milestones

- [x] **Stage 0**: Baseline + full env inventory (`PHASE6_PROGRESS.md`)
- [x] **Stage 1**: Supabase go-live runbook (`SUPABASE_GOLIVE_RUNBOOK.md`) + RLS enforcement proof (`tools/audit/verify-rls.js`) + two-process persistence proof
- [x] **Stage 2**: Go-live preflight endpoint & CLI (`/api/marketing/preflight`) with PASS/FAIL/NOT-CONFIGURED table
- [x] **Stage 3**: Cross-channel analytics data layer (`lib/m360-analytics.js`) strictly from real events
- [x] **Stage 4**: Owner analytics dashboard UI with honest zeros, status indicators, and cross-channel spend
- [x] **Stage 5**: Guided one-client pilot flow (`/api/marketing/pilot` + pilot UI) with consent and approval gates
- [x] **Stage 6**: Behavioral harness extension (`tools/audit/exploits.js`) with DASH1–DASH3 and PIL1
- [x] **Stage 7**: Comprehensive verification report (`docs/agent-runs/PHASE6_REPORT.md`) & branch push
