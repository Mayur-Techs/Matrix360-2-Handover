'use strict';
// Real SQLite state; every provider/CRM/AI request is a declared fake. No live publication.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../lib/m360-linkedin-store');
const { createService } = require('../lib/m360-linkedin-service');
const ctx = { workspace: 'tenant-a', actor: 'actor-a', role: 'client_admin', membership: { name: 'Client A' } };
const jpeg = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(40, 1)]);

function fixture(t, overrides = {}) {
  const store = createStore({ path: ':memory:', backend: 'sqlite', env: {} });
  t.after(() => store.close());
  const calls = [], clock = { value: Date.now() };
  const env = { LINKEDIN_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), LINKEDIN_SAFETY_GUARDRAILS: 'true', ...overrides.env };
  const provider = {
    authorizationUrl: state => 'https://www.linkedin.com/oauth/v2/authorization?state=' + state,
    exchangeCode: async () => ({ access_token: 'FAKE_PROVIDER_TOKEN', scopes: ['w_member_social'], expires_at: new Date(clock.value + 3600000).toISOString() }),
    identity: async () => ({ urn: 'urn:li:person:fixture', name: 'Fixture Member' }),
    destinations: async () => [{ urn: 'urn:li:person:fixture', name: 'Fixture Member', capabilities: { publish: true } }],
    checkAuthority: async () => {},
    uploadMedia: async (...args) => { calls.push({ operation: 'upload', args }); return { id: 'urn:li:image:fixture', kind: 'image', status: 'AVAILABLE' }; },
    mediaStatus: async (_token, media) => ({ ...media, status: 'AVAILABLE' }),
    publish: async (_token, post) => { calls.push({ operation: 'publish', post }); return { id: 'urn:li:share:fixture-' + calls.length }; },
    ...overrides.provider
  };
  const fetchImpl = overrides.fetchImpl || (async () => { throw Error('Unexpected network request in test'); });
  const service = createService({ store, provider, env, fetchImpl, now: () => clock.value });
  return { store, service, provider, env, clock, calls };
}
async function connected(f, destinations = ['destination-a']) {
  await f.store.put(ctx.workspace, 'connections', 'connection-a', { member_urn: 'urn:li:person:fixture', status: 'connected', scopes: ['w_member_social'], expires_at: new Date(f.clock.value + 3600000).toISOString(), encrypted_tokens: f.service.seal({ access_token: 'FAKE_PROVIDER_TOKEN' }, ctx.workspace) });
  for (const id of destinations) await f.store.put(ctx.workspace, 'destinations', id, { connection_id: 'connection-a', urn: 'urn:li:person:' + id, capabilities: { publish: true } });
}
async function campaign(f, input = {}, approve = true) {
  let { campaign: c } = await f.service.handle('save', ctx, { text: 'Client-authored post', destination_ids: ['destination-a'], ...input });
  if (approve) ({ campaign: c } = await f.service.handle('approve', ctx, { campaign_id: c.id, revision: c.revision }));
  return c;
}
const schedule = (f, c) => f.service.handle('schedule', ctx, { campaign_id: c.id, revision: c.revision });

test('OAuth binds state to workspace and actor, rejects replay, and keeps tokens private', async t => {
  const f = fixture(t);
  let { url } = await f.service.handle('connect', ctx, {}), state = new URL(url).searchParams.get('state');
  await assert.rejects(f.service.handle('callback', { ...ctx, workspace: 'tenant-b' }, { state, code: 'test-code' }), { code: 'OAUTH_STATE_INVALID' });
  await assert.rejects(f.service.handle('callback', ctx, { state, code: 'test-code' }), { code: 'OAUTH_STATE_INVALID' });
  ({ url } = await f.service.handle('connect', ctx, {})); state = new URL(url).searchParams.get('state');
  await assert.rejects(f.service.handle('callback', { ...ctx, actor: 'someone-else' }, { state, code: 'test-code' }), { code: 'OAUTH_STATE_INVALID' });
  ({ url } = await f.service.handle('connect', ctx, {})); state = new URL(url).searchParams.get('state');
  const result = await f.service.handle('callback', ctx, { state, code: 'test-code' });
  assert.equal(result.discovery_error, null);
  assert.ok(!JSON.stringify(result).includes('FAKE_PROVIDER_TOKEN'));
  assert.ok(!JSON.stringify(await f.service.handle('status', ctx, {})).includes('encrypted_tokens'));
  await assert.rejects(f.service.handle('callback', ctx, { state, code: 'test-code' }), { code: 'OAUTH_STATE_INVALID' });
  assert.deepEqual(await f.store.list('tenant-b', 'connections'), []);
  const stored = (await f.store.list('tenant-a', 'connections'))[0];
  assert.throws(() => f.service.unseal(stored.encrypted_tokens, 'tenant-b'), { code: 'TOKEN_UNAVAILABLE' });
});

test('OAuth state and expired grants cannot execute', async t => {
  const f = fixture(t), { url } = await f.service.handle('connect', ctx, {});
  f.clock.value += 11 * 60000;
  await assert.rejects(f.service.handle('callback', ctx, { state: new URL(url).searchParams.get('state'), code: 'test-code' }), { code: 'OAUTH_STATE_INVALID' });
  await connected(f); const c = await campaign(f); await schedule(f, c);
  f.clock.value += 3600001;
  assert.equal((await f.service.runOne()).job.error.code, 'RECONNECT_REQUIRED');
  assert.equal(f.calls.length, 0);
});

test('material edits invalidate approvals and stale versions cannot overwrite', async t => {
  const f = fixture(t); await connected(f);
  const c = await campaign(f);
  const { campaign: edited } = await f.service.handle('save', ctx, { ...c, text: 'Changed exact post' });
  assert.equal(edited.approval, null);
  await assert.rejects(schedule(f, edited), { code: 'APPROVAL_REQUIRED' });
  await assert.rejects(f.service.handle('save', ctx, { ...c, text: 'Stale overwrite' }), { code: 'REVISION_CONFLICT' });
  const { campaign: approved } = await f.service.handle('approve', ctx, { campaign_id: edited.id, revision: edited.revision });
  await schedule(f, approved);
  const result = await f.service.runOne(); assert.equal(result.job.status, 'published');
  assert.equal(f.calls[0].post.text, 'Changed exact post');
  assert.equal((await f.service.runOne()).idle, true);
});

test('optional review disabled still enforces CRM membership, roles, and tenant ownership', async t => {
  const f = fixture(t, { env: { LINKEDIN_SAFETY_GUARDRAILS: 'false' }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => [{ id: 'tenant-a', role: 'viewer' }] }) });
  const req = { headers: { authorization: 'Bearer ' + 'a'.repeat(40) } };
  await assert.rejects(f.service.authorize(req, 'tenant-b'), { code: 'FORBIDDEN' });
  await assert.rejects(f.service.authorize(req, 'tenant-a', 'publish'), { code: 'FORBIDDEN' });
  await assert.rejects(f.service.authorize({ headers: {} }, 'tenant-a'), { code: 'UNAUTHENTICATED' });
  await connected(f); const c = await campaign(f, {}, false);
  await assert.rejects(f.service.handle('schedule', { ...ctx, workspace: 'tenant-b' }, { campaign_id: c.id, revision: c.revision }), { code: 'NOT_FOUND' });
  await schedule(f, c); assert.equal((await f.service.runOne()).job.status, 'published');
});

test('multiple destinations retain successful publication when another destination fails', async t => {
  const f = fixture(t, { provider: { publish: async (_token, post) => { if (post.author.endsWith('destination-b')) throw Object.assign(Error('Access removed'), { status: 403, uncertain: false, code: 'PROVIDER_ACCESS_DENIED' }); return { id: 'urn:li:share:realistic-fixture-id' }; } } });
  await connected(f, ['destination-a', 'destination-b']); const c = await campaign(f, { destination_ids: ['destination-a', 'destination-b'] });
  await schedule(f, c); await f.service.runOne(); await f.service.runOne();
  const jobs = await f.store.listJobs(ctx.workspace);
  assert.equal(jobs.filter(j => j.status === 'published').length, 1);
  assert.equal(jobs.filter(j => j.status === 'failed').length, 1);
  assert.equal((await f.service.runOne()).idle, true);
});

test('unavailable destination capability does not lock a campaign or enqueue partial work', async t => {
  const f = fixture(t); await connected(f, ['destination-a', 'destination-b']);
  const c = await campaign(f, { destination_ids: ['destination-a', 'destination-b'] });
  const d = await f.store.get(ctx.workspace, 'destinations', 'destination-b');
  await f.store.put(ctx.workspace, 'destinations', d.id, { ...d, capabilities: { publish: false } });
  await assert.rejects(schedule(f, c), { code: 'PUBLISH_SCOPE_REQUIRED' });
  assert.equal((await f.store.get(ctx.workspace, 'campaigns', c.id)).status, 'approved');
  assert.deepEqual(await f.store.listJobs(ctx.workspace), []);
});

test('missing post IDs and ambiguous timeouts become unknown and are never blindly retried', async t => {
  for (const publish of [async () => ({}), async () => { throw Object.assign(Error('Timed out'), { uncertain: true }); }]) {
    let calls = 0; const f = fixture(t, { provider: { publish: async (...args) => { calls++; return publish(...args); } } });
    await connected(f); await schedule(f, await campaign(f));
    assert.equal((await f.service.runOne()).job.status, 'unknown');
    f.clock.value += 3600000;
    assert.equal((await f.service.runOne()).idle, true); assert.equal(calls, 1);
  }
});

test('explicit provider rate-limit rejection is retried after its delay', async t => {
  let calls = 0;
  const f = fixture(t, { provider: { publish: async () => { calls++; if (calls === 1) throw Object.assign(Error('Rate limited'), { status: 429, retryable: true, retryAfter: 60, uncertain: false, code: 'RATE_LIMITED' }); return { id: 'urn:li:share:after-delay' }; } } });
  await connected(f); await schedule(f, await campaign(f));
  assert.equal((await f.service.runOne()).job.status, 'queued');
  assert.equal((await f.service.runOne()).idle, true);
  f.clock.value += 61000;
  assert.equal((await f.service.runOne()).job.status, 'published'); assert.equal(calls, 2);
});

test('cancellation and removed Page authority prevent publication', async t => {
  const f = fixture(t); await connected(f); const { jobs } = await schedule(f, await campaign(f));
  await assert.rejects(f.service.handle('cancel', { ...ctx, workspace: 'tenant-b' }, { job_id: jobs[0].id }), { code: 'NOT_FOUND' });
  assert.equal((await f.service.handle('cancel', ctx, { job_id: jobs[0].id })).job.status, 'cancelled');
  assert.equal((await f.service.runOne()).idle, true);
  const c = await campaign(f); await schedule(f, c);
  f.provider.checkAuthority = async () => { throw Object.assign(Error('Page access removed'), { status: 403, code: 'PAGE_AUTHORITY_REQUIRED' }); };
  assert.equal((await f.service.runOne()).job.error.code, 'PAGE_AUTHORITY_REQUIRED'); assert.equal(f.calls.length, 0);
});

test('media chunks become immutable and foreign/corrupt assets never publish', async t => {
  const f = fixture(t); await connected(f);
  const { asset } = await f.service.handle('upload', ctx, { filename: 'client.jpg', mime: 'image/jpeg', base64: jpeg.toString('base64') });
  assert.equal(asset.size, jpeg.length);
  await assert.rejects(f.service.handle('upload-chunk', ctx, { upload_id: asset.id, index: 0, base64: jpeg.toString('base64') }));
  await assert.rejects(f.service.handle('save', { ...ctx, workspace: 'tenant-b' }, { text: 'foreign', asset_ids: [asset.id] }), { code: 'NOT_FOUND' });
  const c = await campaign(f, { asset_ids: [asset.id], media_rights: true }); await schedule(f, c);
  // Simulate storage corruption after approval, rather than an allowed application edit.
  await f.store.put(ctx.workspace, 'chunks', asset.id + ':0', { base64: Buffer.alloc(jpeg.length, 2).toString('base64') });
  assert.equal((await f.service.runOne()).job.error.code, 'ASSET_CHANGED'); assert.equal(f.calls.length, 0);
});

test('an uploaded chunk may be resent unchanged but cannot be replaced before approval', async t => {
  const f = fixture(t), started = await f.service.handle('upload-start', ctx, { filename: 'client.jpg', mime: 'image/jpeg', size: jpeg.length });
  const payload = { upload_id: started.upload_id, index: 0, base64: jpeg.toString('base64') };
  await f.service.handle('upload-chunk', ctx, payload);
  await f.service.handle('upload-chunk', ctx, payload);
  await assert.rejects(f.service.handle('upload-chunk', ctx, { ...payload, base64: Buffer.alloc(jpeg.length, 2).toString('base64') }), { code: 'IMMUTABLE_ASSET' });
  const { asset } = await f.service.handle('upload-complete', ctx, { upload_id: started.upload_id });
  assert.deepEqual(await f.service.assetBytes(ctx.workspace, asset), jpeg);
  assert.deepEqual((await f.service.handle('upload-complete', ctx, { upload_id: started.upload_id })).asset, asset);
});

test('upload acknowledgement without media-read permission can publish, without claiming processing proof', async t => {
  let uploads = 0;
  const f = fixture(t, { provider: { uploadMedia: async () => { uploads++; return { id: 'urn:li:image:fixture', kind: 'image', status: 'STATUS_UNAVAILABLE' }; } } });
  await connected(f); const { asset } = await f.service.handle('upload', ctx, { filename: 'client.jpg', mime: 'image/jpeg', base64: jpeg.toString('base64') });
  await schedule(f, await campaign(f, { asset_ids: [asset.id], media_rights: true }));
  const { job } = await f.service.runOne();
  assert.equal(job.status, 'published'); assert.equal(job.media.status, 'STATUS_UNAVAILABLE'); assert.equal(uploads, 1);
});

test('real uploaded video waits for provider media readiness before post creation', async t => {
  const video = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp'), Buffer.alloc(40)]);
  let published = 0, uploads = 0;
  const f = fixture(t, { provider: { uploadMedia: async () => { uploads++; return { id: 'urn:li:video:fixture', kind: 'video', status: 'PROCESSING' }; }, publish: async () => { published++; return { id: 'urn:li:share:video-fixture' }; } } });
  await connected(f);
  const { asset } = await f.service.handle('upload', ctx, { filename: 'client.mp4', mime: 'video/mp4', base64: video.toString('base64') });
  await schedule(f, await campaign(f, { asset_ids: [asset.id], media_rights: true }));
  assert.equal((await f.service.runOne()).job.status, 'queued'); assert.equal(published, 0);
  f.clock.value += 31000;
  assert.equal((await f.service.runOne()).job.status, 'published'); assert.equal(published, 1); assert.equal(uploads, 1);
});

test('manual retry queues only definite failed destinations and preserves the successful post', async t => {
  let deny = true; const sent = [];
  const f = fixture(t, { provider: { publish: async (_token, post) => { sent.push(post.author); if (deny && post.author.endsWith('destination-b')) throw Object.assign(Error('Rejected'), { status: 403, uncertain: false }); return { id: post.author.endsWith('destination-a') ? 'urn:li:share:101' : 'urn:li:share:102' }; } } });
  await connected(f, ['destination-a', 'destination-b']); await schedule(f, await campaign(f, { destination_ids: ['destination-a', 'destination-b'] }));
  await f.service.runOne(); await f.service.runOne();
  const initial = await f.store.listJobs(ctx.workspace), success = initial.find(j => j.status === 'published'), failed = initial.find(j => j.status === 'failed');
  await assert.rejects(f.service.handle('retry', ctx, { job_id: success.id }), { code: 'JOB_CONFLICT' });
  await assert.rejects(f.service.handle('retry', { ...ctx, workspace: 'tenant-b' }, { job_id: failed.id }), { code: 'NOT_FOUND' });
  deny = false; await f.service.handle('retry', ctx, { job_id: failed.id }); await f.service.runOne();
  assert.equal(sent.filter(author => author.endsWith('destination-a')).length, 1);
  assert.equal(sent.filter(author => author.endsWith('destination-b')).length, 2);
  assert.equal((await f.store.listJobs(ctx.workspace)).find(j => j.id === success.id).provider_post_id, 'urn:li:share:101');
});

test('read-back verification requires the exact post ID, author, and published lifecycle', async t => {
  const f = fixture(t, { provider: { publish: async () => ({ id: 'urn:li:share:101' }) } }); await connected(f); await schedule(f, await campaign(f));
  const { job } = await f.service.runOne();
  for (const post of [{}, { id: job.provider_post_id, author: 'urn:li:person:wrong', lifecycleState: 'PUBLISHED' }, { id: job.provider_post_id, author: 'urn:li:person:destination-a', lifecycleState: 'DRAFT' }]) {
    f.provider.readPost = async () => post;
    await assert.rejects(f.service.handle('verify', ctx, { job_id: job.id }), { code: 'PUBLICATION_NOT_VERIFIED' });
    assert.equal((await f.store.listJobs(ctx.workspace))[0].verified_at, undefined);
  }
  f.provider.readPost = async () => ({ id: job.provider_post_id, author: 'urn:li:person:destination-a', lifecycleState: 'PUBLISHED' });
  assert.equal((await f.service.handle('verify', ctx, { job_id: job.id })).verified, true);
});

test('unknown reconciliation rejects foreign author, tenant, and content before saving evidence', async t => {
  const f = fixture(t, { provider: { publish: async () => { throw Object.assign(Error('Timeout'), { uncertain: true }); } } });
  await connected(f); const c = await campaign(f); await schedule(f, c); const { job } = await f.service.runOne();
  await assert.rejects(f.service.handle('retry', ctx, { job_id: job.id }), { code: 'JOB_CONFLICT' });
  await assert.rejects(f.service.handle('reconcile', { ...ctx, workspace: 'tenant-b' }, { job_id: job.id, provider_post_id: 'urn:li:share:101' }), { code: 'NOT_FOUND' });
  const valid = { id: 'urn:li:share:101', author: 'urn:li:person:destination-a', commentary: c.text, lifecycleState: 'PUBLISHED' };
  for (const post of [{ ...valid, author: 'urn:li:person:other' }, { ...valid, commentary: 'Different post' }, {}]) {
    f.provider.readPost = async () => post;
    await assert.rejects(f.service.handle('reconcile', ctx, { job_id: job.id, provider_post_id: valid.id }), { code: 'PUBLICATION_NOT_VERIFIED' });
    assert.equal((await f.store.listJobs(ctx.workspace))[0].status, 'unknown');
  }
  f.provider.readPost = async () => valid;
  const result = await f.service.handle('reconcile', ctx, { job_id: job.id, provider_post_id: valid.id });
  assert.equal(result.job.status, 'published'); assert.equal(result.job.provider_post_id, valid.id);
  assert.equal((await f.service.runOne()).idle, true);
});

test('an entitled refresh grant renews expired access without exposing tokens', async t => {
  let refreshed = 0, usedToken;
  const f = fixture(t, { provider: { publish: async token => { usedToken = token; return { id: 'urn:li:share:101' }; } } });
  await connected(f); const c = await campaign(f); await schedule(f, c);
  const connection = await f.store.get(ctx.workspace, 'connections', 'connection-a');
  const refreshExpiry = new Date(f.clock.value + 86400000).toISOString();
  await f.store.put(ctx.workspace, 'connections', connection.id, { ...connection, expires_at: new Date(f.clock.value - 1000).toISOString(), encrypted_tokens: f.service.seal({ access_token: 'OLD_FAKE_TOKEN', refresh_token: 'FAKE_REFRESH', refresh_expires_at: refreshExpiry }, ctx.workspace) });
  f.provider.refreshToken = async token => { assert.equal(token, 'FAKE_REFRESH'); refreshed++; return { access_token: 'NEW_FAKE_TOKEN', scopes: ['w_member_social'], expires_at: new Date(f.clock.value + 3600000).toISOString() }; };
  assert.equal((await f.service.runOne()).job.status, 'published'); assert.equal(refreshed, 1); assert.equal(usedToken, 'NEW_FAKE_TOKEN');
  const saved = await f.store.get(ctx.workspace, 'connections', connection.id);
  assert.equal(f.service.unseal(saved.encrypted_tokens, ctx.workspace).refresh_token, 'FAKE_REFRESH');
  assert.ok(!JSON.stringify(await f.service.handle('status', ctx, {})).includes('NEW_FAKE_TOKEN'));
});

test('disconnect while refresh is in flight prevents returning the old grant', async t => {
  const f = fixture(t); await connected(f); await schedule(f, await campaign(f));
  const connection = await f.store.get(ctx.workspace, 'connections', 'connection-a');
  await f.store.put(ctx.workspace, 'connections', connection.id, { ...connection, expires_at: new Date(f.clock.value + 30000).toISOString(), encrypted_tokens: f.service.seal({ access_token: 'OLD_FAKE_TOKEN', refresh_token: 'FAKE_REFRESH', refresh_expires_at: new Date(f.clock.value + 86400000).toISOString() }, ctx.workspace) });
  f.provider.refreshToken = async () => {
    const current = await f.store.get(ctx.workspace, 'connections', connection.id);
    await f.store.put(ctx.workspace, 'connections', connection.id, { ...current, status: 'disconnected', encrypted_tokens: null }, { expectedRevision: current.revision });
    return { access_token: 'NEW_FAKE_TOKEN', scopes: ['w_member_social'], expires_at: new Date(f.clock.value + 3600000).toISOString() };
  };
  const result = await f.service.runOne();
  assert.equal(result.job.status, 'failed'); assert.equal(result.job.error.code, 'RECONNECT_REQUIRED'); assert.equal(f.calls.length, 0);
});

test('two concurrent reconciliations cannot overwrite the first provider evidence', async t => {
  const f = fixture(t, { provider: { publish: async () => { throw Object.assign(Error('Timeout'), { uncertain: true }); } } });
  await connected(f); const c = await campaign(f); await schedule(f, c); const { job } = await f.service.runOne();
  const pending = [];
  f.provider.readPost = async (_token, id) => new Promise(resolve => {
    pending.push(() => resolve({ id, author: 'urn:li:person:destination-a', commentary: c.text, lifecycleState: 'PUBLISHED' }));
    if (pending.length === 2) for (const finish of pending) finish();
  });
  const results = await Promise.allSettled(['urn:li:share:101', 'urn:li:share:102'].map(provider_post_id => f.service.handle('reconcile', ctx, { job_id: job.id, provider_post_id })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'JOB_CONFLICT');
  assert.equal((await f.store.listJobs(ctx.workspace))[0].provider_post_id, results.find(result => result.status === 'fulfilled').value.job.provider_post_id);
});
