-- REVIEW-ONLY migration. Do not apply to a hosted project without owner authorization.
create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(), workspace_id text not null,
  correlation_id uuid not null, idempotency_key text not null, objective text not null,
  status text not null check (status in ('accepted','clarification_required','requesting_leads','audience_empty','audience_received','requesting_content','content_blocked','assets_ready','running','partial','completed','failed','blocked','draft_ready')),
  context jsonb not null default '{}', version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, correlation_id), unique(workspace_id, idempotency_key)
);
create table if not exists public.marketing_tasks (
  id uuid primary key default gen_random_uuid(), workspace_id text not null,
  correlation_id uuid not null, parent_task_id uuid, task_type text not null,
  status text not null, idempotency_key text not null, input jsonb not null default '{}',
  result jsonb not null default '{}', version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);
create table if not exists public.marketing_task_events (
  id bigint generated always as identity primary key, workspace_id text not null,
  correlation_id uuid not null, sequence integer not null, event_type text not null,
  detail jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(workspace_id, correlation_id, sequence)
);
create table if not exists public.marketing_conversations (
  id uuid primary key, workspace_id text not null, correlation_id uuid not null,
  parent_task_id uuid, status text not null, execution_mode text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, correlation_id)
);
create table if not exists public.marketing_conversation_messages (
  id uuid primary key, conversation_id uuid not null references public.marketing_conversations(id) on delete cascade,
  workspace_id text not null, role text not null check(role in ('user','assistant','system')),
  content text not null, sequence integer not null, created_at timestamptz not null default now(),
  unique(conversation_id, sequence)
);
create table if not exists public.handover_envelopes (
  envelope_id uuid primary key, workspace_id text not null, correlation_id uuid not null,
  schema_version text not null, origin_module text not null, target_engine text not null,
  status text not null, payload jsonb not null default '{}', artifact_refs jsonb not null default '[]',
  idempotency_key text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, idempotency_key)
);
create table if not exists public.audience_snapshots (
  id uuid primary key default gen_random_uuid(), workspace_id text not null, correlation_id uuid not null,
  source_task_id text, source_type text not null, requested_count integer not null default 0,
  discovered_count integer not null default 0, eligible_count integer not null default 0,
  lead_ids jsonb not null default '[]', policy_version text not null, test_data boolean not null default false,
  captured_at timestamptz not null default now()
);
create table if not exists public.campaign_artifact_refs (
  id uuid primary key default gen_random_uuid(), workspace_id text not null, correlation_id uuid not null,
  artifact_type text not null, artifact_id text not null, source_task_id text,
  approval_state text not null, test_data boolean not null default false, created_at timestamptz not null default now(),
  unique(workspace_id, correlation_id, artifact_type, artifact_id)
);
create table if not exists public.channel_draft_versions (
  id uuid primary key default gen_random_uuid(), workspace_id text not null, correlation_id uuid not null,
  channel text not null, version integer not null, parent_version_id uuid references public.channel_draft_versions(id),
  subject text not null default '', body text not null, structured_fields jsonb not null default '{}',
  content_hash text not null, status text not null check(status in ('draft_for_review','approved','superseded')),
  author_type text not null, actor_id text, provenance jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(workspace_id, correlation_id, channel, version), unique(workspace_id, correlation_id, channel, content_hash)
);
create table if not exists public.channel_approvals (
  id uuid primary key default gen_random_uuid(), workspace_id text not null,
  draft_version_id uuid not null references public.channel_draft_versions(id), content_hash text not null,
  actor_id text not null, actor_role text not null, approved_at timestamptz not null default now(),
  unique(workspace_id, draft_version_id, content_hash)
);
create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(), workspace_id text not null, provider text not null,
  account_reference text, verification_status text not null, capabilities jsonb not null default '[]',
  verified_at timestamptz, updated_at timestamptz not null default now(), unique(workspace_id, provider)
);
create table if not exists public.campaign_executions (
  id uuid primary key default gen_random_uuid(), workspace_id text not null, correlation_id uuid not null,
  channel text not null, draft_version_id uuid not null references public.channel_draft_versions(id),
  audience_snapshot_id uuid references public.audience_snapshots(id), idempotency_key text not null,
  status text not null, provider_ack_id text, policy_version text not null,
  created_at timestamptz not null default now(), unique(workspace_id, idempotency_key)
);
create table if not exists public.provider_delivery_events (
  id bigint generated always as identity primary key, workspace_id text not null,
  execution_id uuid not null references public.campaign_executions(id), provider_event_id text not null,
  event_type text not null, verified boolean not null default false, occurred_at timestamptz not null,
  payload jsonb not null default '{}', unique(workspace_id, provider_event_id)
);
create table if not exists public.campaign_calendar_events (
  id uuid primary key default gen_random_uuid(), workspace_id text not null, correlation_id uuid not null,
  title text not null, channel text not null, scheduled_for timestamptz not null, timezone text not null,
  status text not null, draft_version_id uuid references public.channel_draft_versions(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, correlation_id, channel, scheduled_for)
);
create table if not exists public.campaign_result_metrics (
  id uuid primary key default gen_random_uuid(), workspace_id text not null,
  correlation_id uuid not null, execution_id uuid references public.campaign_executions(id),
  metric_name text not null, metric_value numeric not null, source_event_id bigint references public.provider_delivery_events(id),
  attribution_confidence numeric check(attribution_confidence between 0 and 1),
  observed_at timestamptz not null, unique(workspace_id, execution_id, metric_name, observed_at)
);
create table if not exists public.campaign_journey_rules (
  id uuid primary key, workspace_id text not null, correlation_id uuid not null,
  name text not null, trigger_event text not null, action text not null,
  delay_hours integer not null default 0, max_executions integer not null default 1,
  execution_count integer not null default 0, stop_on_reply boolean not null default true,
  status text not null check(status in ('draft','active','paused')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, correlation_id, name)
);

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

-- Policies intentionally depend on the owner's reviewed membership helper.
-- Example only: using (public.is_workspace_member(workspace_id, auth.uid())).
-- Rollback: drop these tables in reverse dependency order after a reviewed backup.
