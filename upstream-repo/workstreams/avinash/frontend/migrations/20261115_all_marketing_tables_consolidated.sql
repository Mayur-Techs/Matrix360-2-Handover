-- ============================================================================
-- Matrix360: Consolidated Marketing & Trust Rails Supabase Schema
-- ============================================================================
-- Single-file, 1-click execution for Supabase SQL Editor.
-- Idempotent: safe to run multiple times (uses IF NOT EXISTS / CREATE OR REPLACE).
-- Fully enforces Row Level Security (RLS) across all 22 marketing tables.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Workspace Membership Infrastructure & Security Functions
-- ----------------------------------------------------------------------------

create table if not exists public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  unique(workspace_id, user_id)
);

create index if not exists idx_workspace_memberships_lookup
  on public.workspace_memberships (workspace_id, user_id);

alter table public.workspace_memberships enable row level security;

drop policy if exists "workspace_memberships_select" on public.workspace_memberships;
create policy "workspace_memberships_select" on public.workspace_memberships
  for select
  using (
    user_id = auth.uid() 
    or current_setting('role', true) in ('service_role', 'postgres')
  );

drop policy if exists "workspace_memberships_write" on public.workspace_memberships;
create policy "workspace_memberships_write" on public.workspace_memberships
  for all
  using (
    user_id = auth.uid() 
    or current_setting('role', true) in ('service_role', 'postgres')
  )
  with check (
    user_id = auth.uid() 
    or current_setting('role', true) in ('service_role', 'postgres')
  );

-- Primary security helper function: is_workspace_member(ws_id, user_id)
create or replace function public.is_workspace_member(ws_id text, user_id uuid)
returns boolean
language plpgsql
security definer
stable
as $$
begin
  -- 1. Service role and postgres superuser bypass
  if current_setting('role', true) in ('service_role', 'postgres') then
    return true;
  end if;

  -- 2. System default & showcase workspaces bypass
  if ws_id in ('default', 'showcase') then
    return true;
  end if;

  -- 3. Anonymous / unauthenticated callers denied
  if user_id is null then
    return false;
  end if;

  -- 4. Check workspace memberships table
  return exists (
    select 1
    from public.workspace_memberships wm
    where wm.workspace_id = ws_id
      and wm.user_id = user_id
  );
end;
$$;

-- Overload: is_workspace_member(ws_id) defaults user_id to auth.uid()
create or replace function public.is_workspace_member(ws_id text)
returns boolean
language sql
security definer
stable
as $$
  select public.is_workspace_member(ws_id, auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- 1. Core Marketing Schema (16 Tables)
-- ----------------------------------------------------------------------------

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  correlation_id uuid not null,
  idempotency_key text not null,
  objective text not null,
  status text not null check (status in ('accepted','clarification_required','requesting_leads','audience_empty','audience_received','requesting_content','content_blocked','assets_ready','running','partial','completed','failed','blocked','draft_ready')),
  context jsonb not null default '{}',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, correlation_id),
  unique(workspace_id, idempotency_key)
);

create table if not exists public.marketing_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  correlation_id uuid not null,
  parent_task_id uuid,
  task_type text not null,
  status text not null,
  idempotency_key text not null,
  input jsonb not null default '{}',
  result jsonb not null default '{}',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);

create table if not exists public.marketing_task_events (
  id bigint generated always as identity primary key,
  workspace_id text not null,
  correlation_id uuid not null,
  sequence integer not null,
  event_type text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(workspace_id, correlation_id, sequence)
);

create table if not exists public.marketing_conversations (
  id uuid primary key,
  workspace_id text not null,
  correlation_id uuid not null,
  parent_task_id uuid,
  status text not null,
  execution_mode text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, correlation_id)
);

create table if not exists public.marketing_conversation_messages (
  id uuid primary key,
  conversation_id uuid not null references public.marketing_conversations(id) on delete cascade,
  workspace_id text not null,
  role text not null check(role in ('user','assistant','system')),
  content text not null,
  sequence integer not null,
  created_at timestamptz not null default now(),
  unique(conversation_id, sequence)
);

create table if not exists public.handover_envelopes (
  envelope_id uuid primary key,
  workspace_id text not null,
  correlation_id uuid not null,
  schema_version text not null,
  origin_module text not null,
  target_engine text not null,
  status text not null,
  payload jsonb not null default '{}',
  artifact_refs jsonb not null default '[]',
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);

create table if not exists public.audience_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  correlation_id uuid not null,
  source_task_id text,
  source_type text not null,
  requested_count integer not null default 0,
  discovered_count integer not null default 0,
  eligible_count integer not null default 0,
  lead_ids jsonb not null default '[]',
  policy_version text not null,
  test_data boolean not null default false,
  captured_at timestamptz not null default now()
);

create table if not exists public.campaign_artifact_refs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  correlation_id uuid not null,
  artifact_type text not null,
  artifact_id text not null,
  source_task_id text,
  approval_state text not null,
  test_data boolean not null default false,
  created_at timestamptz not null default now(),
  unique(workspace_id, correlation_id, artifact_type, artifact_id)
);

create table if not exists public.channel_draft_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  correlation_id uuid not null,
  channel text not null,
  version integer not null,
  parent_version_id uuid references public.channel_draft_versions(id),
  subject text not null default '',
  body text not null,
  structured_fields jsonb not null default '{}',
  content_hash text not null,
  status text not null check(status in ('draft_for_review','approved','superseded')),
  author_type text not null,
  actor_id text,
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(workspace_id, correlation_id, channel, version),
  unique(workspace_id, correlation_id, channel, content_hash)
);

create table if not exists public.channel_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  draft_version_id uuid references public.channel_draft_versions(id),
  content_hash text not null,
  audience_snapshot_hash text,
  actor_id text not null,
  actor_role text not null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(workspace_id, draft_version_id, content_hash)
);

alter table public.channel_approvals add column if not exists audience_snapshot_hash text;

create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  provider text not null,
  account_reference text,
  verification_status text not null default 'unverified',
  capabilities jsonb not null default '[]',
  encrypted_token text,
  metadata jsonb not null default '{}',
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(workspace_id, provider)
);

create table if not exists public.campaign_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  correlation_id uuid not null,
  channel text not null,
  draft_version_id uuid not null references public.channel_draft_versions(id),
  audience_snapshot_id uuid references public.audience_snapshots(id),
  idempotency_key text not null,
  status text not null,
  provider_ack_id text,
  policy_version text not null,
  created_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);

create table if not exists public.provider_delivery_events (
  id bigint generated always as identity primary key,
  workspace_id text not null,
  execution_id uuid not null references public.campaign_executions(id),
  provider_event_id text not null,
  event_type text not null,
  verified boolean not null default false,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}',
  unique(workspace_id, provider_event_id)
);

create table if not exists public.campaign_calendar_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  correlation_id uuid not null,
  title text not null,
  channel text not null,
  scheduled_for timestamptz not null,
  timezone text not null,
  status text not null,
  draft_version_id uuid references public.channel_draft_versions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, correlation_id, channel, scheduled_for)
);

create table if not exists public.campaign_result_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  correlation_id uuid not null,
  execution_id uuid references public.campaign_executions(id),
  metric_name text not null,
  metric_value numeric not null,
  source_event_id bigint references public.provider_delivery_events(id),
  attribution_confidence numeric check(attribution_confidence between 0 and 1),
  observed_at timestamptz not null,
  unique(workspace_id, execution_id, metric_name, observed_at)
);

create table if not exists public.campaign_journey_rules (
  id uuid primary key,
  workspace_id text not null,
  correlation_id uuid not null,
  name text not null,
  trigger_event text not null,
  action text not null,
  delay_hours integer not null default 0,
  max_executions integer not null default 1,
  execution_count integer not null default 0,
  stop_on_reply boolean not null default true,
  status text not null check(status in ('draft','active','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, correlation_id, name)
);

-- Enable RLS on all 16 core tables
alter table public.marketing_campaigns enable row level security;
alter table public.marketing_tasks enable row level security;
alter table public.marketing_task_events enable row level security;
alter table public.marketing_conversations enable row level security;
alter table public.marketing_conversation_messages enable row level security;
alter table public.handover_envelopes enable row level security;
alter table public.audience_snapshots enable row level security;
alter table public.campaign_artifact_refs enable row level security;
alter table public.channel_draft_versions enable row level security;
alter table public.channel_approvals enable row level security;
alter table public.provider_connections enable row level security;
alter table public.campaign_executions enable row level security;
alter table public.provider_delivery_events enable row level security;
alter table public.campaign_calendar_events enable row level security;
alter table public.campaign_result_metrics enable row level security;
alter table public.campaign_journey_rules enable row level security;

-- Policies for Core Tables
drop policy if exists "marketing_campaigns_select" on public.marketing_campaigns;
create policy "marketing_campaigns_select" on public.marketing_campaigns
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "marketing_campaigns_write" on public.marketing_campaigns;
create policy "marketing_campaigns_write" on public.marketing_campaigns
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "marketing_tasks_select" on public.marketing_tasks;
create policy "marketing_tasks_select" on public.marketing_tasks
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "marketing_tasks_write" on public.marketing_tasks;
create policy "marketing_tasks_write" on public.marketing_tasks
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "marketing_task_events_select" on public.marketing_task_events;
create policy "marketing_task_events_select" on public.marketing_task_events
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "marketing_task_events_write" on public.marketing_task_events;
create policy "marketing_task_events_write" on public.marketing_task_events
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "marketing_conversations_select" on public.marketing_conversations;
create policy "marketing_conversations_select" on public.marketing_conversations
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "marketing_conversations_write" on public.marketing_conversations;
create policy "marketing_conversations_write" on public.marketing_conversations
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "marketing_conversation_messages_select" on public.marketing_conversation_messages;
create policy "marketing_conversation_messages_select" on public.marketing_conversation_messages
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "marketing_conversation_messages_write" on public.marketing_conversation_messages;
create policy "marketing_conversation_messages_write" on public.marketing_conversation_messages
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "handover_envelopes_select" on public.handover_envelopes;
create policy "handover_envelopes_select" on public.handover_envelopes
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "handover_envelopes_write" on public.handover_envelopes;
create policy "handover_envelopes_write" on public.handover_envelopes
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "audience_snapshots_select" on public.audience_snapshots;
create policy "audience_snapshots_select" on public.audience_snapshots
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "audience_snapshots_write" on public.audience_snapshots;
create policy "audience_snapshots_write" on public.audience_snapshots
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "campaign_artifact_refs_select" on public.campaign_artifact_refs;
create policy "campaign_artifact_refs_select" on public.campaign_artifact_refs
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "campaign_artifact_refs_write" on public.campaign_artifact_refs;
create policy "campaign_artifact_refs_write" on public.campaign_artifact_refs
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "channel_draft_versions_select" on public.channel_draft_versions;
create policy "channel_draft_versions_select" on public.channel_draft_versions
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "channel_draft_versions_write" on public.channel_draft_versions;
create policy "channel_draft_versions_write" on public.channel_draft_versions
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "channel_approvals_select" on public.channel_approvals;
drop policy if exists "Workspace members can view channel approvals" on public.channel_approvals;
create policy "channel_approvals_select" on public.channel_approvals
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "channel_approvals_write" on public.channel_approvals;
drop policy if exists "Workspace admins can insert channel approvals" on public.channel_approvals;
create policy "channel_approvals_write" on public.channel_approvals
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "provider_connections_select" on public.provider_connections;
create policy "provider_connections_select" on public.provider_connections
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "provider_connections_write" on public.provider_connections;
create policy "provider_connections_write" on public.provider_connections
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "campaign_executions_select" on public.campaign_executions;
create policy "campaign_executions_select" on public.campaign_executions
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "campaign_executions_write" on public.campaign_executions;
create policy "campaign_executions_write" on public.campaign_executions
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "provider_delivery_events_select" on public.provider_delivery_events;
create policy "provider_delivery_events_select" on public.provider_delivery_events
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "provider_delivery_events_write" on public.provider_delivery_events;
create policy "provider_delivery_events_write" on public.provider_delivery_events
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "campaign_calendar_events_select" on public.campaign_calendar_events;
create policy "campaign_calendar_events_select" on public.campaign_calendar_events
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "campaign_calendar_events_write" on public.campaign_calendar_events;
create policy "campaign_calendar_events_write" on public.campaign_calendar_events
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "campaign_result_metrics_select" on public.campaign_result_metrics;
create policy "campaign_result_metrics_select" on public.campaign_result_metrics
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "campaign_result_metrics_write" on public.campaign_result_metrics;
create policy "campaign_result_metrics_write" on public.campaign_result_metrics
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "campaign_journey_rules_select" on public.campaign_journey_rules;
create policy "campaign_journey_rules_select" on public.campaign_journey_rules
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
drop policy if exists "campaign_journey_rules_write" on public.campaign_journey_rules;
create policy "campaign_journey_rules_write" on public.campaign_journey_rules
  for all using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- 2. Consents & Suppressions (2 Tables)
-- ----------------------------------------------------------------------------

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  contact_id text not null,
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'all')),
  status text not null check (status in ('granted', 'withdrawn')),
  source text not null,
  captured_at timestamptz not null default now(),
  wording_version text not null default 'v1.0',
  business_name text not null,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_consents_workspace_contact
  on public.consents (workspace_id, contact_id, channel, status);

create table if not exists public.suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  channel text not null default 'all',
  value_normalized text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique(workspace_id, channel, value_normalized)
);

create index if not exists idx_suppressions_lookup
  on public.suppressions (workspace_id, value_normalized);

alter table public.consents enable row level security;
alter table public.suppressions enable row level security;

drop policy if exists "Team members can view workspace consents" on public.consents;
create policy "Team members can view workspace consents"
  on public.consents for select
  using (
    auth.role() = 'authenticated'
    and (
      workspace_id = 'default'
      or public.is_workspace_member(workspace_id, auth.uid())
    )
  );

drop policy if exists "Team members can insert workspace consents" on public.consents;
create policy "Team members can insert workspace consents"
  on public.consents for insert
  with check (
    auth.role() = 'authenticated'
    and (
      workspace_id = 'default'
      or public.is_workspace_member(workspace_id, auth.uid())
    )
  );

drop policy if exists "Team members can view workspace suppressions" on public.suppressions;
create policy "Team members can view workspace suppressions"
  on public.suppressions for select
  using (
    auth.role() = 'authenticated'
    and (
      workspace_id = 'default'
      or public.is_workspace_member(workspace_id, auth.uid())
    )
  );

drop policy if exists "Team members can insert workspace suppressions" on public.suppressions;
create policy "Team members can insert workspace suppressions"
  on public.suppressions for insert
  with check (
    auth.role() = 'authenticated'
    and (
      workspace_id = 'default'
      or public.is_workspace_member(workspace_id, auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Durable Outbox (1 Table)
-- ----------------------------------------------------------------------------

create table if not exists public.campaign_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  campaign_id text not null,
  correlation_id text,
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'meta', 'linkedin', 'web')),
  contact_id text not null,
  content_hash text not null,
  idempotency_key text not null,
  status text not null check (status in ('queued', 'sending', 'provider_accepted', 'failed', 'skipped')),
  provider_message_id text,
  attempts integer not null default 0,
  last_error text,
  locked_until timestamptz,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);

create index if not exists idx_campaign_outbox_queue on public.campaign_outbox (status, locked_until)
  where status in ('queued', 'sending');
create index if not exists idx_campaign_outbox_campaign on public.campaign_outbox (workspace_id, campaign_id);

alter table public.campaign_outbox enable row level security;

drop policy if exists "Workspace members can view campaign outbox" on public.campaign_outbox;
create policy "Workspace members can view campaign outbox"
  on public.campaign_outbox
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "Workspace admins can manage campaign outbox" on public.campaign_outbox;
create policy "Workspace admins can manage campaign outbox"
  on public.campaign_outbox
  for all
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- 4. Multi-Agent Message Bus (1 Table)
-- ----------------------------------------------------------------------------

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  correlation_id text not null,
  from_agent text not null,
  to_agent text not null,
  intent text not null,
  payload jsonb not null default '{}',
  status text not null check (status in ('pending', 'delivered', 'processing', 'completed', 'blocked', 'failed')),
  sequence integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_messages_bus on public.agent_messages (workspace_id, correlation_id, sequence);
alter table public.agent_messages enable row level security;

drop policy if exists "agent_messages_select" on public.agent_messages;
create policy "agent_messages_select" on public.agent_messages
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "agent_messages_write" on public.agent_messages;
create policy "agent_messages_write" on public.agent_messages
  for all
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- 5. WhatsApp Tech Provider Onboarding (1 Table)
-- ----------------------------------------------------------------------------

create table if not exists public.whatsapp_onboarding (
  workspace_id text primary key,
  waba_id text,
  phone_number_id text,
  display_phone_number text,
  verified_name text,
  state text not null check (
    state in (
      'not_started',
      'awaiting_client_login',
      'number_registering',
      'templates_in_review',
      'ready_limited',
      'verified',
      'needs_attention'
    )
  ) default 'not_started',
  tier text not null check (
    tier in (
      'tier_unverified',
      'tier_250',
      'tier_1k',
      'tier_10k',
      'tier_100k',
      'tier_unlimited'
    )
  ) default 'tier_250',
  last_meta_error jsonb,
  templates jsonb not null default '[]'::jsonb,
  test_delivery_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_onboarding_phone_id
  on public.whatsapp_onboarding (phone_number_id);
create index if not exists idx_whatsapp_onboarding_waba_id
  on public.whatsapp_onboarding (waba_id);

alter table public.whatsapp_onboarding enable row level security;

drop policy if exists "Workspace members can view whatsapp onboarding" on public.whatsapp_onboarding;
create policy "Workspace members can view whatsapp onboarding"
  on public.whatsapp_onboarding for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "Workspace admins can manage whatsapp onboarding" on public.whatsapp_onboarding;
create policy "Workspace admins can manage whatsapp onboarding"
  on public.whatsapp_onboarding for all
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- 6. Email Sender Onboarding (1 Table)
-- ----------------------------------------------------------------------------

create table if not exists public.email_sender_onboarding (
  workspace_id text primary key,
  sender_domain text,
  from_address text,
  from_name text,
  state text not null check (
    state in (
      'not_started',
      'domain_pending',
      'dns_verifying',
      'ready_limited',
      'verified',
      'needs_attention'
    )
  ) default 'not_started',
  spf_ok boolean not null default false,
  dkim_ok boolean not null default false,
  dmarc_ok boolean not null default false,
  last_provider_error jsonb,
  test_delivery_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_onboarding_domain
  on public.email_sender_onboarding (sender_domain);
create index if not exists idx_email_onboarding_from
  on public.email_sender_onboarding (from_address);

alter table public.email_sender_onboarding enable row level security;

drop policy if exists "Workspace members can view email sender onboarding" on public.email_sender_onboarding;
create policy "Workspace members can view email sender onboarding"
  on public.email_sender_onboarding for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "Workspace admins can manage email sender onboarding" on public.email_sender_onboarding;
create policy "Workspace admins can manage email sender onboarding"
  on public.email_sender_onboarding for all
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

-- ----------------------------------------------------------------------------
-- 7. Verification Summary Query
-- ----------------------------------------------------------------------------
select 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in (
    'marketing_campaigns',
    'marketing_tasks',
    'marketing_task_events',
    'marketing_conversations',
    'marketing_conversation_messages',
    'handover_envelopes',
    'audience_snapshots',
    'campaign_artifact_refs',
    'channel_draft_versions',
    'channel_approvals',
    'provider_connections',
    'campaign_executions',
    'provider_delivery_events',
    'campaign_calendar_events',
    'campaign_result_metrics',
    'campaign_journey_rules',
    'consents',
    'suppressions',
    'campaign_outbox',
    'agent_messages',
    'whatsapp_onboarding',
    'email_sender_onboarding'
  )
order by tablename;
