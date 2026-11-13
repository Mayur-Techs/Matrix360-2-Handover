-- ============================================================================
-- Matrix360 Phase 6: Clean Wipe / Reset Script for Supabase Marketing Schema
-- ============================================================================
-- Run this in the Supabase SQL Editor if you ever need to reset the marketing
-- schema to a completely clean state before reapplying migrations.
--
-- This drops all 22 Matrix360 marketing tables, workspace memberships,
-- and security functions using CASCADE.
-- ============================================================================

-- Drop all 22 marketing tables in reverse-dependency order
drop table if exists public.email_sender_onboarding cascade;
drop table if exists public.whatsapp_onboarding cascade;
drop table if exists public.agent_messages cascade;
drop table if exists public.campaign_outbox cascade;
drop table if exists public.suppressions cascade;
drop table if exists public.consents cascade;
drop table if exists public.campaign_journey_rules cascade;
drop table if exists public.campaign_result_metrics cascade;
drop table if exists public.campaign_calendar_events cascade;
drop table if exists public.provider_delivery_events cascade;
drop table if exists public.campaign_executions cascade;
drop table if exists public.provider_connections cascade;
drop table if exists public.channel_approvals cascade;
drop table if exists public.channel_draft_versions cascade;
drop table if exists public.campaign_artifact_refs cascade;
drop table if exists public.audience_snapshots cascade;
drop table if exists public.handover_envelopes cascade;
drop table if exists public.marketing_conversation_messages cascade;
drop table if exists public.marketing_conversations cascade;
drop table if exists public.marketing_task_events cascade;
drop table if exists public.marketing_tasks cascade;
drop table if exists public.marketing_campaigns cascade;
drop table if exists public.workspace_memberships cascade;

-- Drop security helper functions
drop function if exists public.is_workspace_member(text, uuid) cascade;
drop function if exists public.is_workspace_member(text) cascade;

-- Output confirmation
select 'Marketing schema wiped successfully. Ready for clean migration.' as status;
