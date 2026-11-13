-- REVIEW DRAFT ONLY. Destructive rollback; never run without explicit approval and backup verification.

begin;
drop table if exists public.m360_marketing_audit;
drop table if exists public.m360_marketing_approvals;
drop table if exists public.m360_marketing_draft_versions;
drop table if exists public.m360_marketing_tasks;
commit;

