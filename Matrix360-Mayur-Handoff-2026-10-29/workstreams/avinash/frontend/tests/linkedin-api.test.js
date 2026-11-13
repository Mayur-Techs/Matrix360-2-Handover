'use strict';
// Actual API/service/SQLite integration. CRM and LinkedIn are explicitly mocked; no live publication.
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../lib/m360-linkedin-api');
const { createService } = require('../lib/m360-linkedin-service');
const { createStore } = require('../lib/m360-linkedin-store');
const tokenA = 'a'.repeat(40), tokenB = 'b'.repeat(40), viewer = 'v'.repeat(40), sales = 's'.repeat(40);

function fixture(t) {
  const store = createStore({ backend: 'sqlite', path: ':memory:', env: {} }); t.after(() => store.close());
  const roles = { [tokenA]: ['tenant-a', 'client_admin'], [tokenB]: ['tenant-b', 'client_admin'], [viewer]: ['tenant-a', 'viewer'], [sales]: ['tenant-a', 'sales_operator'] };
  const calls = [], crmCalls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://matrix360-crm-backend-p9os.onrender.com/me/workspaces');
    const token = options.headers.Authorization.replace('Bearer ', ''); crmCalls.push(token);
    const membership = roles[token];
    return { ok: Boolean(membership), status: membership ? 200 : 401, json: async () => membership ? [{ id: membership[0], role: membership[1], name: membership[0] }] : {} };
  };
  const provider = {
    checkAuthority: async (token, destination) => { calls.push({ op: 'authority', token, author: destination.urn }); },
    publish: async (token, post) => { calls.push({ op: 'publish', token, author: post.author }); return { id: `urn:li:share:${calls.length}`, url: 'https://www.linkedin.com/feed/update/test-fixture/' }; }
  };
  const env = { LINKEDIN_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'), LINKEDIN_SAFETY_GUARDRAILS: 'false' };
  const service = createService({ store, provider, fetchImpl, env });
  async function request({ op = 'status', method = 'GET', token = tokenA, workspace = 'tenant-a', body = {}, headers = {} } = {}) {
    const req = { method, url: '/api/linkedin', query: { op, workspace_id: workspace }, body, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } };
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = JSON.parse(value); } };
    await api(req, res, { service }); return res;
  }
  async function seed(workspace) {
    const token = `DECLARED_FAKE_LINKEDIN_${workspace}`;
    await store.put(workspace, 'connections', 'connection', { member_urn: `urn:li:person:${workspace}`, name: workspace, status: 'connected', expires_at: new Date(Date.now() + 3600000).toISOString(), scopes: ['w_member_social'], encrypted_tokens: service.seal({ access_token: token }, workspace) });
    await store.put(workspace, 'destinations', 'destination', { connection_id: 'connection', urn: `urn:li:person:${workspace}`, capabilities: { publish: true } });
    return token;
  }
  return { store, service, calls, crmCalls, request, seed };
}

test('API rejects anonymous, wrong-tenant and expired CRM sessions before exposing records', async t => {
  const f = fixture(t); await f.seed('tenant-a');
  assert.equal((await f.request({ token: null })).statusCode, 401);
  assert.equal(f.crmCalls.length, 0);
  assert.equal((await f.request({ workspace: 'tenant-b' })).statusCode, 403);
  assert.equal((await f.request({ token: 'e'.repeat(40) })).statusCode, 401);
  const status = await f.request();
  assert.equal(status.statusCode, 200); assert.equal(status.headers['Cache-Control'], 'private, no-store');
  assert.ok(!JSON.stringify(status.body).includes('DECLARED_FAKE_LINKEDIN'));
  assert.ok(!JSON.stringify(status.body).includes('encrypted_tokens'));
});

test('API preserves role boundaries with optional LinkedIn reviews disabled', async t => {
  const f = fixture(t); await f.seed('tenant-a');
  assert.equal((await f.request({ token: viewer })).statusCode, 200);
  for (const op of ['save', 'upload-start', 'connect', 'approve', 'schedule', 'disconnect', 'prepare']) {
    const result = await f.request({ op, method: 'POST', token: viewer });
    assert.equal(result.statusCode, 403, op);
  }
  const draft = await f.request({ op: 'save', method: 'POST', token: sales, body: { text: 'Editor-created draft', destination_ids: ['destination'] } });
  assert.equal(draft.statusCode, 200);
  const denied = await f.request({ op: 'schedule', method: 'POST', token: sales, body: { campaign_id: draft.body.campaign.id, revision: draft.body.campaign.revision } });
  assert.equal(denied.statusCode, 403); assert.equal((await f.store.listJobs('tenant-a')).length, 0);
});

test('API enforces HTTP methods and rejects cross-site mutations', async t => {
  const f = fixture(t);
  for (const op of ['connect', 'callback', 'save', 'schedule', 'disconnect', 'worker']) assert.equal((await f.request({ op })).statusCode, 405, op);
  assert.equal((await f.request({ method: 'POST' })).statusCode, 405);
  assert.equal((await f.request({ op: 'save', method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })).statusCode, 403);
  assert.equal(f.crmCalls.length, 0);
});

test('API cannot read, edit, schedule or disconnect a foreign workspace record through guessed IDs', async t => {
  const f = fixture(t); await f.seed('tenant-a');
  const saved = await f.request({ op: 'save', method: 'POST', body: { text: 'Tenant A private draft', destination_ids: ['destination'] } });
  const campaign = saved.body.campaign;
  const foreign = { token: tokenB, workspace: 'tenant-b' };
  const listing = await f.request({ ...foreign, op: 'campaigns' });
  assert.deepEqual(listing.body.campaigns, []); assert.deepEqual(listing.body.jobs, []);
  assert.equal((await f.request({ ...foreign, op: 'save', method: 'POST', body: { ...campaign, workspace_id: 'tenant-b', text: 'Overwrite' } })).statusCode, 404);
  assert.equal((await f.request({ ...foreign, op: 'schedule', method: 'POST', body: { campaign_id: campaign.id, revision: campaign.revision } })).statusCode, 404);
  assert.equal((await f.request({ ...foreign, op: 'disconnect', method: 'POST', body: { connection_id: 'connection' } })).statusCode, 404);
  assert.equal((await f.store.get('tenant-a', 'connections', 'connection')).status, 'connected');
  assert.equal((await f.store.get('tenant-a', 'campaigns', campaign.id)).text, 'Tenant A private draft');
});

test('authenticated worker executes each tenant job using only that tenant encrypted grant', async t => {
  const f = fixture(t), oldSecret = process.env.LINKEDIN_WORKER_SECRET;
  process.env.LINKEDIN_WORKER_SECRET = 'worker-test-secret-'.repeat(3);
  t.after(() => { if (oldSecret === undefined) delete process.env.LINKEDIN_WORKER_SECRET; else process.env.LINKEDIN_WORKER_SECRET = oldSecret; });
  const expected = {};
  for (const [workspace, token] of [['tenant-a', tokenA], ['tenant-b', tokenB]]) {
    expected[`urn:li:person:${workspace}`] = await f.seed(workspace);
    const draft = await f.request({ op: 'save', method: 'POST', token, workspace, body: { text: `Approved test fixture ${workspace}`, destination_ids: ['destination'] } });
    const scheduled = await f.request({ op: 'schedule', method: 'POST', token, workspace, body: { campaign_id: draft.body.campaign.id, revision: draft.body.campaign.revision } });
    assert.equal(scheduled.statusCode, 200);
  }
  assert.equal((await f.request({ op: 'worker', method: 'POST', token: null })).statusCode, 401);
  assert.equal((await f.request({ op: 'worker', method: 'POST' })).statusCode, 401);
  assert.equal(f.calls.length, 0);
  for (let i = 0; i < 2; i++) {
    const result = await f.request({ op: 'worker', method: 'POST', token: process.env.LINKEDIN_WORKER_SECRET });
    assert.equal(result.statusCode, 200); assert.equal(result.body.result.job.status, 'published');
    assert.ok(!JSON.stringify(result.body).includes('DECLARED_FAKE_LINKEDIN'));
  }
  assert.equal(f.calls.filter(call => call.op === 'publish').length, 2);
  for (const call of f.calls) assert.equal(call.token, expected[call.author]);
  const resultsA = await f.request({ op: 'campaigns' });
  assert.equal(resultsA.body.jobs.length, 1); assert.equal(resultsA.body.jobs[0].workspace_id, 'tenant-a');
});
