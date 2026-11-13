-- Migration: 20261109_marketing_durable.sql
-- Matrix360 Phase 2 Trust Rails — Durable Store for Campaigns, Approvals, and Outbox Queue
-- REVIEW-ONLY migration. Do not apply without human authorization.

-- 1. Helper function for workspace membership check
create table if not exists public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  unique(workspace_id, user_id)
);
create index if not exists idx_workspace_memberships_lookup on public.workspace_memberships (workspace_id, user_id);
alter table public.workspace_memberships enable row level security;

create or replace function public.is_workspace_member(ws_id text, user_id uuid)
returns boolean
language plpgsql
security definer
stable
as $$
begin
  if current_setting('role', true) in ('service_role', 'postgres') then
    return true;
  end if;
  if ws_id in ('default', 'showcase') then
    return true;
  end if;
  if user_id is null then
    return false;
  end if;
  return exists (
    select 1
    from public.workspace_memberships wm
    where wm.workspace_id = ws_id
      and wm.user_id = user_id
  );
end;
$$;

create or replace function public.is_workspace_member(ws_id text)
returns boolean
language sql
security definer
stable
as $$
  select public.is_workspace_member(ws_id, auth.uid());
$$;

-- 2. Extend / create channel_approvals table
create table if not exists public.channel_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  draft_version_id uuid,
  content_hash text not null,
  audience_snapshot_hash text,
  actor_id text not null,
  actor_role text not null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(workspace_id, content_hash, actor_id)
);

alter table public.channel_approvals add column if not exists audience_snapshot_hash text;
alter table public.channel_approvals enable row level security;

-- 3. Create campaign_outbox table (Durable Send Queue)
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

-- 4. Provider Connections table (reused from core, ensuring RLS & columns)
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

alter table public.provider_connections enable row level security;

-- 5. Row Level Security Policies
-- channel_approvals
drop policy if exists "Workspace members can view channel approvals" on public.channel_approvals;
create policy "Workspace members can view channel approvals"
  on public.channel_approvals
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "Workspace admins can insert channel approvals" on public.channel_approvals;
create policy "Workspace admins can insert channel approvals"
  on public.channel_approvals
  for insert
  with check (public.is_workspace_member(workspace_id, auth.uid()));

-- campaign_outbox
drop policy if exists "Workspace members can view campaign outbox" on public.campaign_outbox;
create policy "Workspace members can view campaign outbox"
  on public.campaign_outbox
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "Workspace members can enqueue outbox items" on public.campaign_outbox;
create policy "Workspace members can enqueue outbox items"
  on public.campaign_outbox
  for insert
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "System and workers can update outbox items" on public.campaign_outbox;
create policy "System and workers can update outbox items"
  on public.campaign_outbox
  for update
  using (public.is_workspace_member(workspace_id, auth.uid()));

-- provider_connections
drop policy if exists "Workspace members can view provider connections" on public.provider_connections;
create policy "Workspace members can view provider connections"
  on public.provider_connections
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "Workspace admins can manage provider connections" on public.provider_connections;
create policy "Workspace admins can manage provider connections"
  on public.provider_connections
  for all
  using (public.is_workspace_member(workspace_id, auth.uid()));
