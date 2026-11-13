-- Migration: 20261109_agent_messages.sql
-- Multi-Agent Coordination Spine & Durable Message Bus for Matrix360 Phase 2 Stage 10

-- Ensure workspace_memberships and is_workspace_member exist
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

-- RLS Policy: Workspace members can view agent messages
drop policy if exists "agent_messages_select" on public.agent_messages;
create policy "agent_messages_select" on public.agent_messages
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

-- RLS Policy: Workspace members/agents can insert and manage agent messages
drop policy if exists "agent_messages_write" on public.agent_messages;
create policy "agent_messages_write" on public.agent_messages
  for all
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));
