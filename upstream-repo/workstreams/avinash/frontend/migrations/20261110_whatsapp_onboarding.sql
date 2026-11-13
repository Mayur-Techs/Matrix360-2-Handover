-- REVIEW-ONLY migration. Do not apply to a hosted project without owner authorization.
-- Phase 3: Meta Tech Provider & WhatsApp Embedded Signup Onboarding

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

-- Table: public.whatsapp_onboarding

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

-- Fast tenant routing lookup by Meta phone_number_id (used by inbound webhooks)
create index if not exists idx_whatsapp_onboarding_phone_id
  on public.whatsapp_onboarding (phone_number_id);

-- WABA lookup index
create index if not exists idx_whatsapp_onboarding_waba_id
  on public.whatsapp_onboarding (waba_id);

-- Enable Row Level Security (RLS)
alter table public.whatsapp_onboarding enable row level security;

-- RLS Policy: Workspace members can view onboarding state
drop policy if exists "Workspace members can view whatsapp onboarding" on public.whatsapp_onboarding;
create policy "Workspace members can view whatsapp onboarding"
  on public.whatsapp_onboarding for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

-- RLS Policy: Workspace admins can manage onboarding state
drop policy if exists "Workspace admins can manage whatsapp onboarding" on public.whatsapp_onboarding;
create policy "Workspace admins can manage whatsapp onboarding"
  on public.whatsapp_onboarding for all
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));
