'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createStore } = require('../lib/m360-linkedin-store');
function local(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm360-linkedin-test-'));
  const filename = path.join(dir, 'test.sqlite');
  const stores = [];
  const open = () => { const store = createStore({ path: filename, backend: 'sqlite', env: {} }); stores.push(store); return store; };
  t.after(() => { for (const store of stores) try { store.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  return { open, filename };
}
const job = (id = 'post-one') => ({ id, scheduled_for: new Date(Date.now() - 1000).toISOString(), campaign_id: 'campaign-one', destination_id: 'destination-one' });

test('LinkedIn SQLite preserves tenant isolation and revisions across restart', async t => {
  const fixture = local(t), first = fixture.open();
  const a = await first.put('tenant-a', 'campaigns', 'same-id', { title: 'A' }, { expectedRevision: 0 });
  await first.put('tenant-b', 'campaigns', 'same-id', { title: 'B' });
  await assert.rejects(first.put('tenant-a', 'campaigns', 'same-id', { title: 'stale' }, { expectedRevision: 0 }), { code: 'REVISION_CONFLICT' });
  assert.equal(a.revision, 1); first.close();
  const second = fixture.open();
  assert.equal((await second.get('tenant-a', 'campaigns', 'same-id')).title, 'A');
  assert.equal((await second.get('tenant-b', 'campaigns', 'same-id')).title, 'B');
  assert.equal(await second.get('tenant-c', 'campaigns', 'same-id'), null);
  assert.equal((await second.put('tenant-a', 'campaigns', 'same-id', { title: 'A2', workspace_id: 'tenant-b' }, { expectedRevision: 1 })).workspace_id, 'tenant-a');
  assert.equal(await second.remove('tenant-b', 'campaigns', 'same-id'), true);
  assert.equal((await second.list('tenant-a', 'campaigns')).length, 1);
  assert.deepEqual(await second.list('tenant-b', 'campaigns'), []);
});

test('OAuth state is consumed once across independent store handles', async t => {
  const fixture = local(t), a = fixture.open(), b = fixture.open(), hash = 'a'.repeat(64);
  await a.putState(hash, { workspace_id: 'tenant-a', actor_id: 'actor-a' });
  const results = await Promise.all([a.consumeState(hash), b.consumeState(hash)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await a.consumeState(hash), null);
});

test('two worker processes atomically claim a job once', async t => {
  const fixture = local(t), store = fixture.open();
  await store.enqueue('tenant-a', job());
  await store.enqueue('tenant-a', { ...job(), campaign_id: 'must-not-overwrite' });
  const script = `const {createStore}=require(process.argv[1]);const s=createStore({path:process.argv[2],backend:'sqlite',env:{}});s.claim().then(r=>{console.log(JSON.stringify(r));s.close()})`;
  const args = ['-e', script, require.resolve('../lib/m360-linkedin-store'), fixture.filename];
  const outputs = await Promise.all([promisify(execFile)(process.execPath, args), promisify(execFile)(process.execPath, args)]);
  const claimed = outputs.map(out => JSON.parse(out.stdout)).filter(Boolean);
  assert.equal(claimed.length, 1); assert.equal(claimed[0].campaign_id, 'campaign-one');
  assert.equal((await store.listJobs('tenant-a')).length, 1);
  assert.deepEqual(await store.listJobs('tenant-b'), []);
});

test('expired preparation leases recover; expired dispatches become unknown without reposting', async t => {
  const fixture = local(t), store = fixture.open(), now = Date.now();
  await store.enqueue('tenant-a', job());
  const first = await store.claim({ now, leaseMs: 1000 });
  const second = await store.claim({ now: now + 1001, leaseMs: 120000 });
  assert.notEqual(first.lease_token, second.lease_token); assert.equal(second.attempts, 2);
  await assert.rejects(store.updateJob('tenant-a', first.id, { status: 'dispatching' }, { leaseToken: first.lease_token }), { code: 'LEASE_CONFLICT' });
  await store.updateJob('tenant-a', second.id, { status: 'dispatching' }, { leaseToken: second.lease_token });
  assert.equal(await store.claim({ now: now + 122000 }), null);
  assert.equal((await store.listJobs('tenant-a'))[0].status, 'unknown');
  await assert.rejects(store.updateJob('tenant-a', second.id, { status: 'queued' }), { code: 'JOB_CONFLICT' });
});

test('cancellation wins before dispatch; dispatching blocks cancellation and stale completion', async t => {
  const fixture = local(t), store = fixture.open();
  await store.enqueue('tenant-a', job('cancel'));
  const leased = await store.claim();
  assert.equal((await store.updateJob('tenant-a', leased.id, { status: 'cancelled' })).status, 'cancelled');
  await assert.rejects(store.updateJob('tenant-a', leased.id, { status: 'dispatching' }, { leaseToken: leased.lease_token }), { code: 'LEASE_CONFLICT' });
  await store.enqueue('tenant-a', job('send'));
  const send = await store.claim();
  await store.updateJob('tenant-a', send.id, { status: 'dispatching' }, { leaseToken: send.lease_token });
  await assert.rejects(store.updateJob('tenant-a', send.id, { status: 'cancelled' }, { leaseToken: send.lease_token }), { code: 'JOB_CONFLICT' });
  const sent = await store.updateJob('tenant-a', send.id, { status: 'published', provider_post_id: 'fixture-provider-id' }, { leaseToken: send.lease_token });
  assert.equal(sent.lease_token, null);
  await assert.rejects(store.updateJob('tenant-a', send.id, { status: 'failed' }, { leaseToken: send.lease_token }), { code: 'LEASE_CONFLICT' });
  assert.equal(await store.updateJob('tenant-b', send.id, { status: 'cancelled' }), null);
});

test('queued retry timing persists across restarts without changing completed destinations', async t => {
  const fixture = local(t), first = fixture.open(), now = Date.now();
  await first.enqueue('tenant-a', job('a'));
  await first.enqueue('tenant-a', job('b'));
  const a = await first.claim();
  await first.updateJob('tenant-a', a.id, { status: 'published' }, { leaseToken: a.lease_token });
  const b = await first.claim();
  await first.updateJob('tenant-a', b.id, { status: 'queued', next_attempt_at: new Date(now + 60000).toISOString() }, { leaseToken: b.lease_token });
  first.close(); const restarted = fixture.open();
  assert.equal(await restarted.claim({ now }), null);
  assert.equal((await restarted.claim({ now: now + 61000 })).id, b.id);
  assert.equal((await restarted.listJobs('tenant-a')).find(item => item.id === a.id).status, 'published');
});

test('Vercel defaults to Supabase and rejects ephemeral SQLite', () => {
  assert.throws(() => createStore({ backend: 'sqlite', env: { VERCEL: '1' } }), { code: 'STORE_NOT_CONFIGURED' });
  assert.throws(() => createStore({ env: { VERCEL: '1' } }), { code: 'STORE_NOT_CONFIGURED' });
});

test('only explicit provider rejection permits a dispatch retry with the active lease', async t => {
  const store = local(t).open();
  await store.enqueue('tenant-a', job());
  const claimed = await store.claim();
  const lease = { leaseToken: claimed.lease_token };
  await store.updateJob('tenant-a', claimed.id, { status: 'dispatching' }, lease);
  await assert.rejects(store.updateJob('tenant-a', claimed.id, { status: 'queued' }, lease), { code: 'JOB_CONFLICT' });
  await assert.rejects(store.updateJob('tenant-a', claimed.id, { status: 'queued' }, { providerRejected: true }), { code: 'LEASE_CONFLICT' });
  assert.equal((await store.updateJob('tenant-a', claimed.id, { status: 'queued' }, { ...lease, providerRejected: true })).status, 'queued');
});

test('Supabase adapter scopes reads and passes CAS/lease arguments (mock network)', async () => {
  const calls = [], env = { LINKEDIN_SUPABASE_URL: 'https://example.supabase.co', LINKEDIN_SUPABASE_SERVICE_KEY: 'test-only-key-'.repeat(4) };
  const store = createStore({ backend: 'supabase', env, fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => url.includes('/rpc/') ? null : [{ data: { id: 'one' } }] }; } });
  assert.deepEqual(await store.get('tenant-a', 'connections', 'one'), { id: 'one' });
  await store.put('tenant-a', 'campaigns', 'one', {}, { expectedRevision: 4 });
  await store.updateJob('tenant-a', 'one', { status: 'dispatching' }, { leaseToken: 'test-lease' });
  assert.match(calls[0].url, /workspace_id=eq.tenant-a/);
  assert.equal(JSON.parse(calls[1].options.body).p_expected, 4);
  assert.equal(JSON.parse(calls[2].options.body).p_lease, 'test-lease');
});

test('retention cleanup removes expired temporary records only in the selected tenant', async t => {
  const store = local(t).open(), now = Date.now(), expired = new Date(now - 1000).toISOString();
  for (const [workspace, hash] of [['tenant-a', 'a'], ['tenant-b', 'b']]) {
    await store.putState(hash.repeat(64), { workspace_id: workspace, expires_at: expired });
    await store.put(workspace, 'uploads', 'expired-upload', { expires_at: expired });
    await store.put(workspace, 'chunks', 'expired-upload:0', { upload_id: 'expired-upload', base64: 'test' });
    await store.put(workspace, 'assets', 'saved', { size: 16 });
    await store.put(workspace, 'chunks', 'saved:0', { upload_id: 'saved', base64: 'preserved' });
  }
  await store.put('tenant-a', 'uploads', 'active-upload', { expires_at: new Date(now + 10000).toISOString() });
  await store.put('tenant-a', 'chunks', 'active-upload:0', { upload_id: 'active-upload', base64: 'in-progress' });
  assert.deepEqual(await store.cleanup({ now, workspace: 'tenant-a' }), { states: 1, uploads: 1, chunks: 1, profiles: 0, performance: 0 });
  assert.equal(await store.consumeState('a'.repeat(64)), null);
  assert.ok(await store.consumeState('b'.repeat(64)));
  assert.ok(await store.get('tenant-b', 'chunks', 'expired-upload:0'));
  assert.ok(await store.get('tenant-a', 'chunks', 'saved:0'));
  assert.ok(await store.get('tenant-a', 'chunks', 'active-upload:0'));
});

test('retention clears old Page names and analytics but preserves publication evidence', async t => {
  const store = local(t).open(), now = Date.now();
  for (const workspace of ['tenant-a', 'tenant-b']) {
    await store.put(workspace, 'destinations', 'page', { urn: 'urn:li:organization:123', name: 'Old Page Name', authority_checked_at: new Date(now - 57 * 86400000).toISOString() });
    await store.enqueue(workspace, job('published'));
    await store.updateJob(workspace, 'published', { status: 'published', provider_post_id: 'urn:li:share:123', performance: { metrics: { likes: 10 }, retrieved_at: new Date(now - 366 * 86400000).toISOString() } });
  }
  const result = await store.cleanup({ now, workspace: 'tenant-a' });
  assert.equal(result.profiles, 1); assert.equal(result.performance, 1);
  const page = await store.get('tenant-a', 'destinations', 'page');
  assert.equal(page.name, page.urn); assert.equal(page.profile_expired, true); assert.equal(page.revision, 2);
  const publication = (await store.listJobs('tenant-a'))[0];
  assert.equal(publication.performance, undefined); assert.equal(publication.provider_post_id, 'urn:li:share:123');
  assert.equal((await store.get('tenant-b', 'destinations', 'page')).name, 'Old Page Name');
  assert.ok((await store.listJobs('tenant-b'))[0].performance);
});

test('Supabase list methods fetch every page even when the server uses a smaller page cap (mock network)', async () => {
  const offsets = [], env = { LINKEDIN_SUPABASE_URL: 'https://example.supabase.co', LINKEDIN_SUPABASE_SERVICE_KEY: 'test-only-key-'.repeat(4) };
  const store = createStore({ backend: 'supabase', env, fetchImpl: async url => {
    const offset = Number(new URL(url).searchParams.get('offset')); offsets.push(offset);
    return { ok: true, status: 200, json: async () => offset < 3 ? [{ data: { id: 'row-' + offset } }] : [] };
  } });
  assert.equal((await store.list('tenant-a', 'campaigns')).length, 3);
  assert.deepEqual(offsets, [0, 1, 2, 3]); offsets.length = 0;
  assert.equal((await store.listJobs('tenant-a')).length, 3);
  assert.deepEqual(offsets, [0, 1, 2, 3]);
});

test('operator recovery updates require the state originally reviewed', async t => {
  const store = local(t).open(); await store.enqueue('tenant-a', job());
  await store.updateJob('tenant-a', 'post-one', { status: 'failed' }, { expectedStatus: 'queued' });
  await store.updateJob('tenant-a', 'post-one', { status: 'queued' }, { expectedStatus: 'failed' });
  await assert.rejects(store.updateJob('tenant-a', 'post-one', { status: 'published', provider_post_id: 'stale' }, { expectedStatus: 'failed' }), { code: 'JOB_CONFLICT' });
  assert.equal((await store.listJobs('tenant-a'))[0].provider_post_id, undefined);
});
