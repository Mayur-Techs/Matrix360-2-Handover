# Matrix360 Phase 6: Supabase Production Go-Live Runbook

**Document**: `docs/agent-runs/SUPABASE_GOLIVE_RUNBOOK.md`  
**Target Environment**: Supabase Production Database  
**Policy**: Non-Destructive. All tables enforce Row Level Security (RLS) with `public.is_workspace_member(workspace_id, auth.uid())`.

---

## 1. Quickest Method: 1-Click Consolidated Migration (Recommended)

To avoid order dependencies, copy-paste issues, or manual sequence tracking in the Supabase SQL Editor, we provide a single consolidated script containing the complete marketing engine schema:

> **File**: `migrations/20261115_all_marketing_tables_consolidated.sql`

### How to Apply:
1. Open your [Supabase Dashboard](https://supabase.com/dashboard) and navigate to the **SQL Editor** tab.
2. (Optional: If you ran partial queries previously and want a clean slate, first copy and run `migrations/00000000_wipe_marketing_schema.sql`).
3. Open `migrations/20261115_all_marketing_tables_consolidated.sql`, copy its entire content, paste into the SQL Editor, and click **Run**.
4. The script will create all 22 tables, indexes, security helper functions, and RLS policies, finishing with a verification output confirming all 22 tables have `rls_enabled = true`.

---

## 2. Clean Wipe / Reset (If Needed)

If previous runs created tables in a broken or partial state, run this cleanup script first in the Supabase SQL Editor:

> **File**: `migrations/00000000_wipe_marketing_schema.sql`

This safely drops only the 22 marketing engine tables and functions with `CASCADE`.

---

## 3. Alternative: Multi-File Ordered Execution Sequence

Every individual migration file has been updated with a self-contained preamble (`workspace_memberships` table + `is_workspace_member` plpgsql function). They can now be executed individually in this order:

| Step | Migration File | Primary Responsibilities | Tables / Entities Created |
| :--- | :--- | :--- | :--- |
| **1** | `migrations/20261101_marketing_core.sql` | Core schema, `is_workspace_member` helper, and RLS policies | `workspace_memberships`, `marketing_campaigns`, `marketing_tasks`, `marketing_task_events`, `marketing_conversations`, `marketing_conversation_messages`, `handover_envelopes`, `audience_snapshots`, `campaign_artifact_refs`, `channel_draft_versions`, `channel_approvals`, `provider_connections`, `campaign_executions`, `provider_delivery_events`, `campaign_calendar_events`, `campaign_result_metrics`, `campaign_journey_rules` |
| **2** | `migrations/20261109_consent_suppression.sql` | First-class audit store for explicit consent & multi-lingual opt-outs | `consents`, `suppressions` |
| **3** | `migrations/20261109_marketing_durable.sql` | Durable outbox queue, locking, and channel approvals | `campaign_outbox`, `channel_approvals`, `provider_connections` |
| **4** | `migrations/20261109_agent_messages.sql` | Durable coordination spine for autonomous multi-agent bus | `agent_messages` |
| **5** | `migrations/20261110_whatsapp_onboarding.sql` | WhatsApp Tech Provider onboarding state machine & tier tracking | `whatsapp_onboarding` |
| **6** | `migrations/20261111_email_onboarding.sql` | Email sender onboarding state machine & SPF/DKIM/DMARC alignment | `email_sender_onboarding` |

### Command Line (`psql`) Execution:
```bash
# Set your Supabase connection string from Project Settings -> Database
export DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

# Apply all in one command:
psql "$DATABASE_URL" -f migrations/20261115_all_marketing_tables_consolidated.sql
```

---

## 3. Environment Variable Configuration

After applying migrations, set the following keys in your hosting environment (`.env.local` for local development, Vercel Project Settings for production):

```bash
# 1. Supabase Project URL & Keys
SUPABASE_URL="https://[YOUR-PROJECT-REF].supabase.co"
SUPABASE_ANON_KEY="eyJhbGci..."                # Used for client-side queries with RLS enforcement
SUPABASE_SERVICE_ROLE_KEY="eyJhbGci..."        # Server-side ONLY (never shipped to browser)

# 2. Database Connection String
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

# 3. Enable Durable Supabase Persistence
M360_MARKETING_DURABLE_ENABLED="true"

# 4. Master Vault Encryption Key
M360_TENANT_ENCRYPTION_KEY="[32-byte-base64-key]"
```

---

## 4. Post-Migration Verification

Run the read-only verification script to confirm all 22 tables have Row Level Security active and workspace membership policies bound:

```bash
node tools/audit/verify-rls.js
```

Expected output: All 22 marketing tables report `✅ PASS` with `RLS Enabled: ENABLED` and `is_workspace_member: BOUND`.
