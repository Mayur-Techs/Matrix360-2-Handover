-- LinkedIn-only storage. Apply with a database administrator; no existing channel tables change.
BEGIN;
CREATE TABLE IF NOT EXISTS public.m360_linkedin_records (
  workspace_id text NOT NULL, kind text NOT NULL CHECK (kind IN ('connections','destinations','campaigns','assets','uploads','chunks','content_requests','handovers','attributions')),
  id text NOT NULL, revision bigint NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (workspace_id,kind,id)
);
CREATE TABLE IF NOT EXISTS public.m360_linkedin_states (hash text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS public.m360_linkedin_jobs (
  workspace_id text NOT NULL, id text NOT NULL, status text NOT NULL,
  due_at timestamptz NOT NULL, lease_until timestamptz, data jsonb NOT NULL,
  PRIMARY KEY (workspace_id,id)
);
CREATE INDEX IF NOT EXISTS m360_linkedin_jobs_due ON public.m360_linkedin_jobs(status,due_at);
ALTER TABLE public.m360_linkedin_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m360_linkedin_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.m360_linkedin_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m360_linkedin_records,public.m360_linkedin_states,public.m360_linkedin_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.m360_linkedin_records,public.m360_linkedin_states,public.m360_linkedin_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.m360_linkedin_put(p_workspace text,p_kind text,p_id text,p_data jsonb,p_expected bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE r bigint; result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace || ':' || p_kind || ':' || p_id,0));
  SELECT revision INTO r FROM m360_linkedin_records WHERE workspace_id=p_workspace AND kind=p_kind AND id=p_id FOR UPDATE;
  r:=coalesce(r,0);
  IF p_expected IS NOT NULL AND p_expected<>r THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
  result:=p_data || jsonb_build_object('id',p_id,'workspace_id',p_workspace,'revision',r+1);
  INSERT INTO m360_linkedin_records VALUES(p_workspace,p_kind,p_id,r+1,result)
    ON CONFLICT(workspace_id,kind,id) DO UPDATE SET revision=EXCLUDED.revision,data=EXCLUDED.data;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.m360_linkedin_remove(p_workspace text,p_kind text,p_id text)
RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
BEGIN DELETE FROM m360_linkedin_records WHERE workspace_id=p_workspace AND kind=p_kind AND id=p_id; RETURN FOUND; END $$;

CREATE OR REPLACE FUNCTION public.m360_linkedin_state(p_hash text,p_data jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF p_data IS NOT NULL THEN INSERT INTO m360_linkedin_states VALUES(p_hash,p_data); RETURN p_data; END IF;
  DELETE FROM m360_linkedin_states WHERE hash=p_hash RETURNING data INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.m360_linkedin_enqueue(p_workspace text,p_job jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  INSERT INTO m360_linkedin_jobs VALUES(p_workspace,p_job->>'id','queued',(p_job->>'next_attempt_at')::timestamptz,NULL,p_job)
    ON CONFLICT(workspace_id,id) DO NOTHING;
  SELECT data INTO result FROM m360_linkedin_jobs WHERE workspace_id=p_workspace AND id=p_job->>'id';
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.m360_linkedin_claim(p_now timestamptz,p_lease_ms integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE row m360_linkedin_jobs; result jsonb; token text; until_time timestamptz;
BEGIN
  IF p_lease_ms<1000 OR p_lease_ms>3600000 THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
  UPDATE m360_linkedin_jobs SET status='unknown',lease_until=NULL,
    data=data || jsonb_build_object('status','unknown','error_code','DISPATCH_LEASE_EXPIRED','lease_token',NULL,'lease_until',NULL)
    WHERE status='dispatching' AND lease_until<=p_now;
  SELECT * INTO row FROM m360_linkedin_jobs
    WHERE (status='queued' AND due_at<=p_now) OR (status='leased' AND lease_until<=p_now)
    ORDER BY due_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  token:=gen_random_uuid()::text; until_time:=p_now+make_interval(secs=>p_lease_ms/1000.0);
  result:=row.data || jsonb_build_object('status','leased','attempts',coalesce((row.data->>'attempts')::integer,0)+1,'lease_token',token,'lease_until',until_time);
  UPDATE m360_linkedin_jobs SET status='leased',lease_until=until_time,data=result WHERE workspace_id=row.workspace_id AND id=row.id;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.m360_linkedin_update_job(p_workspace text,p_id text,p_patch jsonb,p_lease text DEFAULT NULL,p_rejected boolean DEFAULT false,p_expected_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE row m360_linkedin_jobs; result jsonb; cancelling boolean; old_token text; new_status text;
BEGIN
  SELECT * INTO row FROM m360_linkedin_jobs WHERE workspace_id=p_workspace AND id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_expected_status IS NOT NULL AND row.status<>p_expected_status THEN RAISE EXCEPTION 'JOB_CONFLICT'; END IF;
  old_token:=row.data->>'lease_token';
  new_status:=coalesce(p_patch->>'status',row.status);
  cancelling:=new_status='cancelled' AND row.status IN ('queued','leased');
  IF NOT cancelling AND old_token IS DISTINCT FROM p_lease AND (old_token IS NOT NULL OR p_lease IS NOT NULL) THEN RAISE EXCEPTION 'LEASE_CONFLICT'; END IF;
  IF new_status='cancelled' AND NOT cancelling THEN RAISE EXCEPTION 'JOB_CONFLICT'; END IF;
  IF new_status='queued' AND row.status IN ('dispatching','unknown','published') AND NOT (row.status='dispatching' AND p_rejected AND old_token IS NOT NULL AND old_token=p_lease) THEN RAISE EXCEPTION 'JOB_CONFLICT'; END IF;
  IF new_status='dispatching' AND (row.status<>'leased' OR row.lease_until<=clock_timestamp()) THEN RAISE EXCEPTION 'LEASE_CONFLICT'; END IF;
  result:=row.data || p_patch || jsonb_build_object('id',p_id,'workspace_id',p_workspace,'lease_token',old_token,'lease_until',row.data->'lease_until');
  IF new_status IN ('published','failed','cancelled','unknown','queued') THEN result:=result || jsonb_build_object('lease_token',NULL,'lease_until',NULL); END IF;
  UPDATE m360_linkedin_jobs SET status=new_status,due_at=(result->>'next_attempt_at')::timestamptz,
    lease_until=(result->>'lease_until')::timestamptz,data=result WHERE workspace_id=p_workspace AND id=p_id;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.m360_linkedin_cleanup(p_now timestamptz,p_workspace text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE state_count integer; upload_count integer; chunk_count integer; profile_count integer; performance_count integer;
BEGIN
  DELETE FROM m360_linkedin_states WHERE (p_workspace IS NULL OR data->>'workspace_id'=p_workspace) AND (data->>'expires_at')::timestamptz<=p_now;
  GET DIAGNOSTICS state_count=ROW_COUNT;
  DELETE FROM m360_linkedin_records WHERE kind='uploads' AND (p_workspace IS NULL OR workspace_id=p_workspace) AND (data->>'expires_at')::timestamptz<=p_now;
  GET DIAGNOSTICS upload_count=ROW_COUNT;
  DELETE FROM m360_linkedin_records AS chunk WHERE chunk.kind='chunks' AND (p_workspace IS NULL OR chunk.workspace_id=p_workspace)
    AND chunk.data->>'upload_id' IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM m360_linkedin_records AS owner WHERE owner.workspace_id=chunk.workspace_id AND owner.kind IN ('uploads','assets') AND owner.id=chunk.data->>'upload_id');
  GET DIAGNOSTICS chunk_count=ROW_COUNT;
  UPDATE m360_linkedin_records SET revision=revision+1,
    data=data || jsonb_build_object('revision',revision+1,'name',data->>'urn','profile_expired',true)
    WHERE kind='destinations' AND (p_workspace IS NULL OR workspace_id=p_workspace)
    AND data->>'urn' LIKE 'urn:li:organization:%' AND coalesce((data->>'profile_expired')::boolean,false)=false
    AND (data->>'authority_checked_at')::timestamptz<=p_now-interval '56 days';
  GET DIAGNOSTICS profile_count=ROW_COUNT;
  UPDATE m360_linkedin_jobs SET data=data-'performance' WHERE (p_workspace IS NULL OR workspace_id=p_workspace)
    AND (data->'performance'->>'retrieved_at')::timestamptz<=p_now-interval '365 days';
  GET DIAGNOSTICS performance_count=ROW_COUNT;
  RETURN jsonb_build_object('states',state_count,'uploads',upload_count,'chunks',chunk_count,'profiles',profile_count,'performance',performance_count);
END $$;

REVOKE ALL ON FUNCTION public.m360_linkedin_put(text,text,text,jsonb,bigint),public.m360_linkedin_remove(text,text,text),public.m360_linkedin_state(text,jsonb),public.m360_linkedin_enqueue(text,jsonb),public.m360_linkedin_claim(timestamptz,integer),public.m360_linkedin_update_job(text,text,jsonb,text,boolean,text),public.m360_linkedin_cleanup(timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.m360_linkedin_put(text,text,text,jsonb,bigint),public.m360_linkedin_remove(text,text,text),public.m360_linkedin_state(text,jsonb),public.m360_linkedin_enqueue(text,jsonb),public.m360_linkedin_claim(timestamptz,integer),public.m360_linkedin_update_job(text,text,jsonb,text,boolean,text),public.m360_linkedin_cleanup(timestamptz,text) TO service_role;
COMMIT;
