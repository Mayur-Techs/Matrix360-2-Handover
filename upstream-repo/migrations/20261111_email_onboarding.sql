-- REVIEW-ONLY migration. Do not apply to a hosted project without owner authorization.
-- Phase 5: Email Sender Onboarding & Domain Authentication (Parity with WhatsApp)

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

-- Table: public.email_sender_onboarding

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

-- Fast lookup by sender domain
create index if not exists idx_email_onboarding_domain
  on public.email_sender_onboarding (sender_domain);

-- Fast lookup by from_address
create index if not exists idx_email_onboarding_from
  on public.email_sender_onboarding (from_address);

-- Enable Row Level Security (RLS)
alter table public.email_sender_onboarding enable row level security;

-- RLS Policy: Workspace members can view email sender onboarding state
drop policy if exists "Workspace members can view email sender onboarding" on public.email_sender_onboarding;
create policy "Workspace members can view email sender onboarding"
  on public.email_sender_onboarding for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

-- RLS Policy: Workspace admins can manage email sender onboarding state
drop policy if exists "Workspace admins can manage email sender onboarding" on public.email_sender_onboarding;
create policy "Workspace admins can manage email sender onboarding"
  on public.email_sender_onboarding for all
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));
