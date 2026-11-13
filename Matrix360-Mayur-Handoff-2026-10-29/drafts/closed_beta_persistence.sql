-- REVIEW DRAFT ONLY. Do not apply until the authoritative staging project is approved.
-- Server-only Marketing persistence. Browser roles receive no table privileges.

begin;

create table public.m360_marketing_tasks (
  workspace_id text not null references public.m360_workspaces(id),
  correlation_id uuid not null,
  idempotency_key text not null,
  status text not null check (status in ('accepted','requesting_leads','audience_received','requesting_content','assets_ready','draft_ready','blocked','failed')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, correlation_id),
  unique (workspace_id, idempotency_key)
);

create table public.m360_marketing_draft_versions (
  workspace_id text not null,
  correlation_id uuid not null,
  channel text not null,
  version integer not null check (version > 0),
  subject text not null default '',
  body text not null,
  content_hash text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (workspace_id, correlation_id, channel, version),
  unique (workspace_id, correlation_id, channel, content_hash),
  foreign key (workspace_id, correlation_id) references public.m360_marketing_tasks(workspace_id, correlation_id)
);

create table public.m360_marketing_approvals (
  workspace_id text not null,
  correlation_id uuid not null,
  channel text not null,
  version integer not null,
  content_hash text not null,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  primary key (workspace_id, correlation_id, channel, version),
  foreign key (workspace_id, correlation_id, channel, version)
    references public.m360_marketing_draft_versions(workspace_id, correlation_id, channel, version)
);

create table public.m360_marketing_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  workspace_id text not null,
  correlation_id uuid not null,
  actor_id uuid not null references auth.users(id),
  actor_role text not null,
  action text not null,
  channel text,
  draft_version integer,
  approval_state text not null,
  approval_hash text,
  outcome text not null,
  failure_code text,
  provider_mode text not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, correlation_id) references public.m360_marketing_tasks(workspace_id, correlation_id)
);

create index m360_marketing_audit_workspace_created
  on public.m360_marketing_audit(workspace_id, created_at desc);
create index m360_marketing_audit_correlation
  on public.m360_marketing_audit(workspace_id, correlation_id, created_at);

alter table public.m360_marketing_tasks enable row level security;
alter table public.m360_marketing_draft_versions enable row level security;
alter table public.m360_marketing_approvals enable row level security;
alter table public.m360_marketing_audit enable row level security;

revoke all on public.m360_marketing_tasks from anon, authenticated;
revoke all on public.m360_marketing_draft_versions from anon, authenticated;
revoke all on public.m360_marketing_approvals from anon, authenticated;
revoke all on public.m360_marketing_audit from anon, authenticated;

grant select, insert, update on public.m360_marketing_tasks to service_role;
grant select, insert on public.m360_marketing_draft_versions to service_role;
grant select, insert on public.m360_marketing_approvals to service_role;
grant select, insert on public.m360_marketing_audit to service_role;
grant usage, select on sequence public.m360_marketing_audit_id_seq to service_role;

commit;

