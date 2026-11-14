'use strict';
// Dev-only PostgreSQL/WASM check. No application dependency, network, or hosted database.
// Install @electric-sql/pglite@0.5.16 in the temp prefix documented in LINKEDIN_STORAGE_SETUP.md.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const packagePath = process.env.PGLITE_PACKAGE_PATH || path.join(os.tmpdir(), 'matrix360-linkedin-pglite-0.5.16/node_modules/@electric-sql/pglite');
const { PGlite } = require(packagePath);
const metadata = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'));
const migrationPath = path.resolve(__dirname, '../workstreams/avinash/frontend/migrations/20261114_linkedin.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const db = new PGlite();
const passed = [];
const iso = value => new Date(value).toISOString();
async function check(name, fn) { await fn(); passed.push(name); }
async function rpc(name, args, types) {
  const placeholders = args.map((_, i) => '$' + (i + 1) + '::' + types[i]).join(',');
  const result = await db.query(`SELECT public.m360_linkedin_${name}(${placeholders}) AS result`, args);
  return result.rows[0].result;
}
const put = (workspace, kind, id, data, expected = null) => rpc('put', [workspace, kind, id, JSON.stringify(data), expected], ['text', 'text', 'text', 'jsonb', 'bigint']);
const remove = (workspace, kind, id) => rpc('remove', [workspace, kind, id], ['text', 'text', 'text']);
const state = (hash, data = null) => rpc('state', [hash, data === null ? null : JSON.stringify(data)], ['text', 'jsonb']);
const claim = (now = Date.now(), leaseMs = 120000) => rpc('claim', [iso(now), leaseMs], ['timestamptz', 'integer']);
const cleanup = (now, workspace = null) => rpc('cleanup', [iso(now), workspace], ['timestamptz', 'text']);
const update = (workspace, id, patch, { leaseToken = null, providerRejected = false, expectedStatus = null } = {}) => rpc('update_job', [workspace, id, JSON.stringify(patch), leaseToken, providerRejected, expectedStatus], ['text', 'text', 'jsonb', 'text', 'boolean', 'text']);
const enqueue = (workspace, id, overrides = {}) => {
  const job = { id, workspace_id: workspace, status: 'queued', scheduled_for: iso(Date.now() - 1000), next_attempt_at: iso(Date.now() - 1000), lease_token: null, lease_until: null, attempts: 0, ...overrides };
  return rpc('enqueue', [workspace, JSON.stringify(job)], ['text', 'jsonb']);
};
async function record(workspace, kind, id) { return (await db.query('SELECT data FROM public.m360_linkedin_records WHERE workspace_id=$1 AND kind=$2 AND id=$3', [workspace, kind, id])).rows[0]?.data || null; }
async function job(workspace, id) { return (await db.query('SELECT data FROM public.m360_linkedin_jobs WHERE workspace_id=$1 AND id=$2', [workspace, id])).rows[0]?.data || null; }
async function rejectsCode(promise, expected) { await assert.rejects(promise, error => error.message.includes(expected)); }

(async () => {
  assert.equal(metadata.version, '0.5.16'); assert.equal(metadata.license, 'Apache-2.0');
  const version = (await db.query('SELECT version() AS version')).rows[0].version;
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await check('actual migration applies and is repeatable', async () => { await db.exec(migration); await db.exec(migration); });
  await db.exec('SET ROLE service_role');
  await check('tenant record keys, optimistic revisions, canonical identity, removal', async () => {
    assert.equal((await put('tenant-a', 'campaigns', 'shared', { title: 'A', workspace_id: 'tenant-b' }, 0)).workspace_id, 'tenant-a');
    await put('tenant-b', 'campaigns', 'shared', { title: 'B' }, 0);
    await rejectsCode(put('tenant-a', 'campaigns', 'shared', { title: 'stale' }, 0), 'REVISION_CONFLICT');
    assert.equal((await put('tenant-a', 'campaigns', 'shared', { title: 'A2' }, 1)).revision, 2);
    assert.equal((await record('tenant-b', 'campaigns', 'shared')).title, 'B');
    assert.equal(await remove('tenant-b', 'campaigns', 'shared'), true);
    assert.equal((await record('tenant-a', 'campaigns', 'shared')).title, 'A2');
    assert.equal(await record('tenant-b', 'campaigns', 'shared'), null);
    for (const kind of ['connections', 'destinations', 'assets', 'uploads', 'chunks', 'content_requests', 'handovers', 'attributions']) await put('tenant-a', kind, 'kind-' + kind, {}, 0);
  });
  await check('OAuth state consumption is one-time', async () => {
    const value = { workspace_id: 'tenant-a', actor: 'fixture', expires_at: iso(Date.now() + 10000) };
    await state('a'.repeat(64), value); assert.deepEqual(await state('a'.repeat(64)), value); assert.equal(await state('a'.repeat(64)), null);
  });
  let active;
  await check('enqueue idempotence and due/lease claims', async () => {
    await enqueue('tenant-a', 'job-a', { marker: 'first' });
    assert.equal((await enqueue('tenant-a', 'job-a', { marker: 'second' })).marker, 'first');
    await enqueue('tenant-a', 'future', { next_attempt_at: iso(Date.now() + 3600000) });
    active = await claim(Date.now(), 1000); assert.equal(active.id, 'job-a'); assert.equal(active.status, 'leased'); assert.equal(active.attempts, 1);
    assert.equal(await claim(), null);
    const previous = active; active = await claim(Date.now() + 1100, 120000);
    assert.equal(active.attempts, 2); assert.notEqual(active.lease_token, previous.lease_token);
    await rejectsCode(update('tenant-a', active.id, { status: 'dispatching' }, { leaseToken: previous.lease_token }), 'LEASE_CONFLICT');
  });
  await check('dispatch uncertainty and explicit rejection retry boundaries', async () => {
    const lease = { leaseToken: active.lease_token };
    await update('tenant-a', active.id, { status: 'dispatching' }, lease);
    await rejectsCode(update('tenant-a', active.id, { status: 'cancelled' }, lease), 'JOB_CONFLICT');
    await rejectsCode(update('tenant-a', active.id, { status: 'queued' }, lease), 'JOB_CONFLICT');
    await rejectsCode(update('tenant-a', active.id, { status: 'queued' }, { providerRejected: true }), 'LEASE_CONFLICT');
    assert.equal((await update('tenant-a', active.id, { status: 'queued' }, { ...lease, providerRejected: true })).status, 'queued');
    active = await claim();
    await update('tenant-a', active.id, { status: 'dispatching' }, { leaseToken: active.lease_token });
    assert.equal(await claim(Date.now() + 121000), null);
    assert.equal((await job('tenant-a', active.id)).status, 'unknown');
    await rejectsCode(update('tenant-a', active.id, { status: 'queued' }, { providerRejected: true }), 'JOB_CONFLICT');
    await update('tenant-a', active.id, { status: 'published', provider_post_id: 'urn:li:share:101' }, { expectedStatus: 'unknown' });
    await rejectsCode(update('tenant-a', active.id, { status: 'published', provider_post_id: 'urn:li:share:102' }, { expectedStatus: 'unknown' }), 'JOB_CONFLICT');
    assert.equal((await job('tenant-a', active.id)).provider_post_id, 'urn:li:share:101');
  });
  await check('tenant-scoped cancellation wins before dispatch and rejects stale worker', async () => {
    await enqueue('tenant-a', 'cancel-me'); const claimed = await claim(); assert.equal(claimed.id, 'cancel-me');
    assert.equal(await update('tenant-b', claimed.id, { status: 'cancelled' }), null);
    assert.equal((await update('tenant-a', claimed.id, { status: 'cancelled' })).status, 'cancelled');
    await rejectsCode(update('tenant-a', claimed.id, { status: 'dispatching' }, { leaseToken: claimed.lease_token }), 'LEASE_CONFLICT');
  });
  await check('manual failure retry uses expected status and preserves other destinations', async () => {
    await enqueue('tenant-b', 'retry-me');
    await update('tenant-b', 'retry-me', { status: 'failed' }, { expectedStatus: 'queued' });
    await update('tenant-b', 'retry-me', { status: 'queued' }, { expectedStatus: 'failed' });
    await rejectsCode(update('tenant-b', 'retry-me', { status: 'published' }, { expectedStatus: 'failed' }), 'JOB_CONFLICT');
    const claimed = await claim(); assert.equal(claimed.workspace_id, 'tenant-b');
    await update('tenant-b', claimed.id, { status: 'published', provider_post_id: 'urn:li:share:202' }, { leaseToken: claimed.lease_token });
    assert.equal((await job('tenant-a', 'job-a')).provider_post_id, 'urn:li:share:101');
  });
  await check('cleanup expires only requested temporary data and provider retention fields', async () => {
    const now = Date.now(), expired = iso(now - 1000);
    for (const [workspace, hash] of [['tenant-a', 'a'], ['tenant-b', 'b']]) {
      await state(hash.repeat(64), { workspace_id: workspace, expires_at: expired });
      await put(workspace, 'uploads', 'expired', { expires_at: expired });
      await put(workspace, 'chunks', 'expired:0', { upload_id: 'expired', base64: 'fixture' });
      await put(workspace, 'assets', 'saved', { size: 16 });
      await put(workspace, 'chunks', 'saved:0', { upload_id: 'saved', base64: 'preserved' });
      await put(workspace, 'destinations', 'page', { urn: 'urn:li:organization:123', name: 'Old Page', authority_checked_at: iso(now - 57 * 86400000) });
      await enqueue(workspace, 'metrics');
      await update(workspace, 'metrics', { status: 'published', provider_post_id: 'urn:li:share:303', performance: { metrics: { likes: 3 }, retrieved_at: iso(now - 366 * 86400000) } });
    }
    const result = await cleanup(now, 'tenant-a');
    assert.deepEqual(result, { states: 1, uploads: 1, chunks: 1, profiles: 1, performance: 1 });
    assert.equal(await state('a'.repeat(64)), null); assert.ok(await state('b'.repeat(64)));
    assert.ok(await record('tenant-a', 'chunks', 'saved:0')); assert.ok(await record('tenant-b', 'chunks', 'expired:0'));
    assert.equal((await record('tenant-a', 'destinations', 'page')).name, 'urn:li:organization:123');
    assert.equal((await record('tenant-a', 'destinations', 'page')).profile_expired, true);
    assert.equal((await record('tenant-b', 'destinations', 'page')).name, 'Old Page');
    assert.equal((await job('tenant-a', 'metrics')).performance, undefined); assert.ok((await job('tenant-b', 'metrics')).performance);
    assert.equal((await job('tenant-a', 'metrics')).provider_post_id, 'urn:li:share:303');
  });
  await db.exec('RESET ROLE');
  await check('all LinkedIn tables have RLS enabled and seven RPCs exist', async () => {
    const tables = (await db.query("SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('m360_linkedin_records','m360_linkedin_states','m360_linkedin_jobs')")).rows;
    assert.equal(tables.length, 3); assert.ok(tables.every(table => table.relrowsecurity));
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM pg_proc WHERE proname LIKE 'm360_linkedin_%'")).rows[0].n), 7);
  });
  const deniedRpcs = [
    () => put('tenant-a', 'campaigns', 'forbidden', {}, 0), () => remove('tenant-a', 'campaigns', 'shared'),
    () => state('c'.repeat(64)), () => enqueue('tenant-a', 'forbidden'), () => claim(),
    () => update('tenant-a', 'job-a', { status: 'failed' }), () => cleanup(Date.now())
  ];
  for (const role of ['anon', 'authenticated']) {
    await check(`${role} cannot read/write tables or invoke any LinkedIn RPC`, async () => {
      await db.exec('SET ROLE ' + role);
      for (const table of ['m360_linkedin_records', 'm360_linkedin_states', 'm360_linkedin_jobs']) await rejectsCode(db.query('SELECT * FROM public.' + table), 'permission denied');
      await rejectsCode(db.query("INSERT INTO public.m360_linkedin_states VALUES('forbidden','{}'::jsonb)"), 'permission denied');
      for (const operation of deniedRpcs) await rejectsCode(operation(), 'permission denied');
      await db.exec('RESET ROLE');
    });
    await check(`${role} is still isolated by RLS even with temporary table privileges`, async () => {
      await db.exec(`GRANT SELECT,INSERT ON public.m360_linkedin_records TO ${role}; SET ROLE ${role};`);
      assert.deepEqual((await db.query('SELECT * FROM public.m360_linkedin_records')).rows, []);
      await rejectsCode(db.query("INSERT INTO public.m360_linkedin_records VALUES('tenant-a','campaigns','forbidden',1,'{}'::jsonb)"), 'row-level security');
      await db.exec(`RESET ROLE; REVOKE SELECT,INSERT ON public.m360_linkedin_records FROM ${role};`);
    });
  }
  console.log(JSON.stringify({ status: 'passed', engine: version, package: metadata.name, package_version: metadata.version, license: metadata.license, migration: migrationPath, checks_passed: passed.length, checks: passed, limitations: ['Embedded single-process PostgreSQL does not prove multi-process lock contention.', 'Supabase PostgREST deployment and hosted migration remain unverified.'] }, null, 2));
})().catch(error => { console.error(JSON.stringify({ status: 'failed', checks_passed: passed.length, last_passed: passed.at(-1), code: error.code || null, message: error.message }, null, 2)); process.exitCode = 1; }).finally(() => db.close());
