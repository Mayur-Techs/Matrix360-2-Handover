'use strict';

const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const KINDS = new Set(['connections', 'destinations', 'campaigns', 'assets', 'uploads', 'chunks', 'content_requests', 'handovers', 'attributions']);
const TERMINAL = new Set(['published', 'failed', 'cancelled', 'unknown']);
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function scope(workspace, kind, id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(workspace || '')) fail('INVALID_WORKSPACE', 'Select a valid workspace.');
  if (kind && !KINDS.has(kind)) fail('INVALID_RECORD_KIND', 'Unsupported LinkedIn record.');
  if (id !== undefined && (typeof id !== 'string' || !id || id.length > 256)) fail('INVALID_ID', 'Invalid LinkedIn record identifier.');
}
function stateKey(hash) { if (!/^[a-f0-9]{64}$/.test(hash || '')) fail('INVALID_STATE', 'Invalid authorization state.'); }
function time(value = Date.now()) { const n = new Date(value).getTime(); if (!Number.isFinite(n)) fail('INVALID_DATE', 'Invalid publication date.'); return n; }
function jobRecord(workspace, job) {
  scope(workspace, null, job.id);
  const due = time(job.next_attempt_at || job.scheduled_for || Date.now());
  return { ...job, id: job.id, workspace_id: workspace, status: 'queued', scheduled_for: new Date(time(job.scheduled_for || due)).toISOString(), next_attempt_at: new Date(due).toISOString(), attempts: 0, lease_token: null, lease_until: null };
}

function sqliteStore(filename) {
  const { DatabaseSync } = require('node:sqlite');
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') fs.chmodSync(filename, 0o600);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS linkedin_records(workspace TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(workspace,kind,id));
    CREATE TABLE IF NOT EXISTS linkedin_states(hash TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS linkedin_jobs(workspace TEXT NOT NULL,id TEXT NOT NULL,status TEXT NOT NULL,due INTEGER NOT NULL,lease_until INTEGER,data TEXT NOT NULL,PRIMARY KEY(workspace,id));
    CREATE INDEX IF NOT EXISTS linkedin_jobs_due ON linkedin_jobs(status,due);`);
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } }
  const decode = row => row ? JSON.parse(row.data) : null;
  const getJob = (workspace, id) => decode(db.prepare('SELECT data FROM linkedin_jobs WHERE workspace=? AND id=?').get(workspace, id));
  function writeJob(job) { db.prepare('UPDATE linkedin_jobs SET status=?,due=?,lease_until=?,data=? WHERE workspace=? AND id=?').run(job.status, time(job.next_attempt_at || job.scheduled_for), job.lease_until ? time(job.lease_until) : null, JSON.stringify(job), job.workspace_id, job.id); }
  return {
    backend: 'sqlite',
    async get(workspace, kind, id) { scope(workspace, kind, id); return decode(db.prepare('SELECT data FROM linkedin_records WHERE workspace=? AND kind=? AND id=?').get(workspace, kind, id)); },
    async list(workspace, kind) { scope(workspace, kind); return db.prepare('SELECT data FROM linkedin_records WHERE workspace=? AND kind=? ORDER BY id').all(workspace, kind).map(decode); },
    async put(workspace, kind, id, data, options = {}) {
      scope(workspace, kind, id);
      return transaction(() => {
        const current = db.prepare('SELECT revision FROM linkedin_records WHERE workspace=? AND kind=? AND id=?').get(workspace, kind, id);
        if (options.expectedRevision !== undefined && options.expectedRevision !== (current?.revision || 0)) fail('REVISION_CONFLICT', 'This item changed. Reload it before saving.');
        const record = { ...data, id, workspace_id: workspace, revision: (current?.revision || 0) + 1 };
        db.prepare('INSERT INTO linkedin_records VALUES(?,?,?,?,?) ON CONFLICT(workspace,kind,id) DO UPDATE SET revision=excluded.revision,data=excluded.data').run(workspace, kind, id, record.revision, JSON.stringify(record));
        return record;
      });
    },
    async remove(workspace, kind, id) { scope(workspace, kind, id); return Boolean(db.prepare('DELETE FROM linkedin_records WHERE workspace=? AND kind=? AND id=?').run(workspace, kind, id).changes); },
    async putState(hash, data) { stateKey(hash); db.prepare('INSERT INTO linkedin_states VALUES(?,?)').run(hash, JSON.stringify(data)); return data; },
    async consumeState(hash) { stateKey(hash); return transaction(() => { const data = decode(db.prepare('SELECT data FROM linkedin_states WHERE hash=?').get(hash)); db.prepare('DELETE FROM linkedin_states WHERE hash=?').run(hash); return data; }); },
    async enqueue(workspace, input) {
      const job = jobRecord(workspace, input);
      return transaction(() => { const existing = getJob(workspace, job.id); if (existing) return existing; db.prepare('INSERT INTO linkedin_jobs VALUES(?,?,?,?,?,?)').run(workspace, job.id, job.status, time(job.next_attempt_at), null, JSON.stringify(job)); return job; });
    },
    async claim({ now = Date.now(), leaseMs = 120000 } = {}) {
      const clock = time(now); if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 3600000) fail('INVALID_LEASE', 'Invalid worker lease.');
      return transaction(() => {
        for (const row of db.prepare("SELECT data FROM linkedin_jobs WHERE status='dispatching' AND lease_until<=?").all(clock)) {
          const job = decode(row); writeJob({ ...job, status: 'unknown', error_code: 'DISPATCH_LEASE_EXPIRED', lease_token: null, lease_until: null });
        }
        const job = decode(db.prepare("SELECT data FROM linkedin_jobs WHERE (status='queued' AND due<=?) OR (status='leased' AND lease_until<=?) ORDER BY due,id LIMIT 1").get(clock, clock));
        if (!job) return null;
        const claimed = { ...job, status: 'leased', attempts: (job.attempts || 0) + 1, lease_token: randomUUID(), lease_until: new Date(clock + leaseMs).toISOString() };
        writeJob(claimed); return claimed;
      });
    },
    async updateJob(workspace, id, patch, options = {}) {
      scope(workspace, null, id);
      return transaction(() => {
        const current = getJob(workspace, id); if (!current) return null;
        if (options.expectedStatus !== undefined && current.status !== options.expectedStatus) fail('JOB_CONFLICT', 'The publication state changed. Reload before continuing.');
        const cancelling = patch.status === 'cancelled' && ['queued', 'leased'].includes(current.status);
        if (!cancelling && ((current.lease_token && current.lease_token !== options.leaseToken) || (options.leaseToken && current.lease_token !== options.leaseToken))) fail('LEASE_CONFLICT', 'The publication is owned by another worker or already completed.');
        if (patch.status === 'cancelled' && !cancelling) fail('JOB_CONFLICT', 'Publication has already started and cannot be cancelled.');
        const rejected = current.status === 'dispatching' && options.providerRejected === true && options.leaseToken === current.lease_token;
        if (patch.status === 'queued' && ['dispatching', 'unknown', 'published'].includes(current.status) && !rejected) fail('JOB_CONFLICT', 'A possibly published post cannot be retried automatically.');
        if (patch.status === 'dispatching' && (current.status !== 'leased' || time(current.lease_until) <= Date.now())) fail('LEASE_CONFLICT', 'The publication worker lease expired.');
        const job = { ...current, ...patch, id, workspace_id: workspace, lease_token: current.lease_token, lease_until: current.lease_until };
        if (TERMINAL.has(job.status) || job.status === 'queued') { job.lease_token = null; job.lease_until = null; }
        writeJob(job); return job;
      });
    },
    async listJobs(workspace) { scope(workspace); return db.prepare('SELECT data FROM linkedin_jobs WHERE workspace=? ORDER BY due,id').all(workspace).map(decode); },
    async cleanup({ now = Date.now(), workspace } = {}) {
      if (workspace !== undefined) scope(workspace);
      const clock = time(now);
      return transaction(() => {
        let states = 0, uploads = 0, chunks = 0, profiles = 0, performance = 0;
        for (const row of db.prepare('SELECT hash,data FROM linkedin_states').all()) {
          const data = JSON.parse(row.data);
          if ((!workspace || data.workspace_id === workspace) && Date.parse(data.expires_at) <= clock) states += Number(db.prepare('DELETE FROM linkedin_states WHERE hash=?').run(row.hash).changes);
        }
        const uploadRows = workspace ? db.prepare("SELECT workspace,id,data FROM linkedin_records WHERE kind='uploads' AND workspace=?").all(workspace) : db.prepare("SELECT workspace,id,data FROM linkedin_records WHERE kind='uploads'").all();
        for (const row of uploadRows) if (Date.parse(JSON.parse(row.data).expires_at) <= clock) uploads += Number(db.prepare("DELETE FROM linkedin_records WHERE workspace=? AND kind='uploads' AND id=?").run(row.workspace, row.id).changes);
        const chunkRows = workspace ? db.prepare("SELECT workspace,id,json_extract(data,'$.upload_id') AS upload_id FROM linkedin_records WHERE kind='chunks' AND workspace=?").all(workspace) : db.prepare("SELECT workspace,id,json_extract(data,'$.upload_id') AS upload_id FROM linkedin_records WHERE kind='chunks'").all();
        for (const row of chunkRows) {
          const uploadId = row.upload_id;
          if (uploadId && !db.prepare("SELECT 1 FROM linkedin_records WHERE workspace=? AND kind IN ('uploads','assets') AND id=? LIMIT 1").get(row.workspace, uploadId)) chunks += Number(db.prepare("DELETE FROM linkedin_records WHERE workspace=? AND kind='chunks' AND id=?").run(row.workspace, row.id).changes);
        }
        const destinationRows = workspace ? db.prepare("SELECT workspace,id,revision,data FROM linkedin_records WHERE kind='destinations' AND workspace=?").all(workspace) : db.prepare("SELECT workspace,id,revision,data FROM linkedin_records WHERE kind='destinations'").all();
        for (const row of destinationRows) {
          const data = JSON.parse(row.data);
          if (String(data.urn).startsWith('urn:li:organization:') && !data.profile_expired && Date.parse(data.authority_checked_at) <= clock - 56 * 86400000) {
            const revision = row.revision + 1;
            profiles += Number(db.prepare("UPDATE linkedin_records SET revision=?,data=? WHERE workspace=? AND kind='destinations' AND id=?").run(revision, JSON.stringify({ ...data, revision, name: data.urn, profile_expired: true }), row.workspace, row.id).changes);
          }
        }
        const jobRows = workspace ? db.prepare('SELECT data FROM linkedin_jobs WHERE workspace=?').all(workspace) : db.prepare('SELECT data FROM linkedin_jobs').all();
        for (const row of jobRows) {
          const data = JSON.parse(row.data);
          if (data.performance && Date.parse(data.performance.retrieved_at) <= clock - 365 * 86400000) { delete data.performance; writeJob(data); performance++; }
        }
        return { states, uploads, chunks, profiles, performance };
      });
    },
    close() { db.close(); }
  };
}

function supabaseStore(env, fetchImpl) {
  const base = String(env.LINKEDIN_SUPABASE_URL || env.M360_MARKETING_SUPABASE_URL || 'https://pmlacujsnnvbrimxbhpu.supabase.co').replace(/\/$/, '');
  const key = env.LINKEDIN_SUPABASE_SERVICE_KEY || env.M360_AI_TRIAL_SUPABASE_SERVICE_KEY || '';
  if (key.length < 30) fail('STORE_NOT_CONFIGURED', 'LinkedIn database credentials are not configured.');
  if (new URL(base).protocol !== 'https:') fail('STORE_NOT_CONFIGURED', 'LinkedIn database requires HTTPS.');
  async function request(route, body, method = 'POST') {
    let response;
    try { response = await fetchImpl(base + '/rest/v1/' + route, { method, headers: { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: 'Bearer ' + key }), Accept: 'application/json', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { fail('STORE_UNAVAILABLE', 'LinkedIn database is unavailable.'); }
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) { const code = ['REVISION_CONFLICT', 'LEASE_CONFLICT', 'JOB_CONFLICT'].find(value => data?.message?.includes(value)); fail(code || 'STORE_UNAVAILABLE', code ? 'LinkedIn record changed; refresh and retry.' : 'LinkedIn database operation failed. Check the LinkedIn migration and database configuration.'); }
    return data;
  }
  const rpc = (name, args) => request('rpc/m360_linkedin_' + name, args);
  async function listData(route) {
    const result = [];
    for (let offset = 0; ; ) {
      const rows = await request(route + `&offset=${offset}&limit=500`, undefined, 'GET');
      if (!Array.isArray(rows)) fail('STORE_UNAVAILABLE', 'LinkedIn database returned an invalid list.');
      if (!rows.length) return result;
      result.push(...rows.map(row => row.data)); offset += rows.length;
    }
  }
  return {
    backend: 'supabase',
    async get(workspace, kind, id) { scope(workspace, kind, id); const rows = await request(`m360_linkedin_records?workspace_id=eq.${encodeURIComponent(workspace)}&kind=eq.${kind}&id=eq.${encodeURIComponent(id)}&select=data`, undefined, 'GET'); return rows?.[0]?.data || null; },
    async list(workspace, kind) { scope(workspace, kind); return listData(`m360_linkedin_records?workspace_id=eq.${encodeURIComponent(workspace)}&kind=eq.${kind}&select=data&order=id`); },
    async put(workspace, kind, id, data, options = {}) { scope(workspace, kind, id); return rpc('put', { p_workspace: workspace, p_kind: kind, p_id: id, p_data: data, p_expected: options.expectedRevision ?? null }); },
    async remove(workspace, kind, id) { scope(workspace, kind, id); return rpc('remove', { p_workspace: workspace, p_kind: kind, p_id: id }); },
    async putState(hash, data) { stateKey(hash); return rpc('state', { p_hash: hash, p_data: data }); },
    async consumeState(hash) { stateKey(hash); return rpc('state', { p_hash: hash, p_data: null }); },
    async enqueue(workspace, input) { const job = jobRecord(workspace, input); return rpc('enqueue', { p_workspace: workspace, p_job: job }); },
    async claim({ now = Date.now(), leaseMs = 120000 } = {}) { if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 3600000) fail('INVALID_LEASE', 'Invalid worker lease.'); return rpc('claim', { p_now: new Date(time(now)).toISOString(), p_lease_ms: leaseMs }); },
    async updateJob(workspace, id, patch, options = {}) { scope(workspace, null, id); return rpc('update_job', { p_workspace: workspace, p_id: id, p_patch: patch, p_lease: options.leaseToken || null, p_rejected: options.providerRejected === true, p_expected_status: options.expectedStatus ?? null }); },
    async listJobs(workspace) { scope(workspace); return listData(`m360_linkedin_jobs?workspace_id=eq.${encodeURIComponent(workspace)}&select=data&order=due_at,id`); },
    async cleanup({ now = Date.now(), workspace } = {}) { if (workspace !== undefined) scope(workspace); return rpc('cleanup', { p_now: new Date(time(now)).toISOString(), p_workspace: workspace || null }); },
    close() {}
  };
}

function createStore({ path: filename, backend, fetchImpl = global.fetch, env = process.env } = {}) {
  const selected = backend || env.LINKEDIN_STORE_BACKEND || (env.VERCEL ? 'supabase' : 'sqlite');
  if (selected === 'supabase') return supabaseStore(env, fetchImpl);
  if (selected !== 'sqlite') fail('STORE_NOT_CONFIGURED', 'Unsupported LinkedIn database backend.');
  if (env.VERCEL && env.LINKEDIN_DURABLE_SQLITE_RUNTIME !== 'true') fail('STORE_NOT_CONFIGURED', 'Use Supabase for LinkedIn persistence on Vercel.');
  return sqliteStore(filename || env.LINKEDIN_SQLITE_PATH || path.resolve(__dirname, '../../../../data/linkedin.sqlite'));
}
let singleton;
const exportsObject = { createStore };
for (const name of ['get', 'list', 'put', 'remove', 'putState', 'consumeState', 'enqueue', 'claim', 'updateJob', 'listJobs', 'cleanup']) exportsObject[name] = (...args) => (singleton ||= createStore())[name](...args);
exportsObject.close = () => { singleton?.close(); singleton = null; };
module.exports = exportsObject;
