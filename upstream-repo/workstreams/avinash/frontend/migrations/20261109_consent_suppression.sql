-- REVIEW-ONLY migration. Do not apply to a hosted project without owner authorization.
-- Phase 2 Trust Rails: Consents and Suppressions as First-Class Audit Data

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

-- Enable Row Level Security (RLS)
alter table public.consents enable row level security;
alter table public.suppressions enable row level security;

-- RLS Policies: Team-shared access within workspace using is_workspace_member
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
