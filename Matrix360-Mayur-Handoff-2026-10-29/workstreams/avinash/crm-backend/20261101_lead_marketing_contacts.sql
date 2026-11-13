-- Review and apply to the CRM Supabase project before deploying the batch-import route.
alter table public.m360_leads add column if not exists email text;
alter table public.m360_leads add column if not exists phone text;
alter table public.m360_leads add column if not exists email_opt_in_status text not null default 'unknown';
alter table public.m360_leads add column if not exists whatsapp_opt_in_status text not null default 'unknown';
alter table public.m360_leads add column if not exists sms_opt_in_status text not null default 'unknown';
alter table public.m360_leads add column if not exists consent_evidence jsonb not null default '{}';
alter table public.m360_leads add column if not exists suppressed boolean not null default false;
alter table public.m360_leads add column if not exists import_key text;
create unique index if not exists m360_leads_workspace_import_key on public.m360_leads(workspace_id,import_key) where import_key is not null;
