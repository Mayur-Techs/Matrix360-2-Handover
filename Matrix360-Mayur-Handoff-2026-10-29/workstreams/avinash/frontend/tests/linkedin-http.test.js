'use strict';
// Exercises the actual HTTP handler/service with SQLite and explicitly fake CRM/LinkedIn providers.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const handler = require('../lib/m360-linkedin-api');
const { createStore } = require('../lib/m360-linkedin-store');
const { createService } = require('../lib/m360-linkedin-service');

test('HTTP fixture completes authorized connect, compose, approve, schedule, worker, and read-back', async t => {
  const store = createStore({ path: ':memory:', backend: 'sqlite', env: {} }); t.after(() => store.close());
  const token = 'a'.repeat(40), worker = 'w'.repeat(40), originalWorker = process.env.LINKEDIN_WORKER_SECRET;
  process.env.LINKEDIN_WORKER_SECRET = worker;
  t.after(() => { if (originalWorker === undefined) delete process.env.LINKEDIN_WORKER_SECRET; else process.env.LINKEDIN_WORKER_SECRET = originalWorker; });
  let postCalls = 0, posted;
  const provider = {
    authorizationUrl: state => 'https://www.linkedin.com/oauth/v2/authorization?state=' + state,
    exchangeCode: async () => ({ access_token: 'FAKE_PROVIDER_TOKEN', scopes: ['w_member_social'], expires_at: new Date(Date.now() + 3600000).toISOString() }),
    identity: async () => ({ urn: 'urn:li:person:fixture', name: 'Fixture Identity' }),
    destinations: async () => [{ urn: 'urn:li:person:fixture', name: 'Fixture Identity', type: 'member', capabilities: { publish: true } }],
    checkAuthority: async () => {},
    publish: async (_token, post) => { postCalls++; posted = post; return { id: 'urn:li:share:123' }; },
    readPost: async () => ({ id: 'urn:li:share:123', author: posted.author, commentary: posted.text, lifecycleState: 'PUBLISHED' })
  };
  const service = createService({ store, provider, env: { LINKEDIN_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64') }, fetchImpl: async url => {
    assert.equal(url, 'https://matrix360-crm-backend-p9os.onrender.com/me/workspaces');
    return { status: 200, ok: true, json: async () => [{ id: 'fixture-a', role: 'client_admin', name: 'Synthetic Fixture A' }] };
  } });
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
    await handler(req, res, { service });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/linkedin';
  async function call(op, body, options = {}) {
    const query = new URLSearchParams({ op, workspace_id: options.workspace || 'fixture-a' });
    const response = await fetch(base + '?' + query, { method: body ? 'POST' : 'GET', headers: { ...(options.anonymous ? {} : { Authorization: 'Bearer ' + (options.token || token) }), 'Content-Type': 'application/json', ...options.headers }, ...(body ? { body: JSON.stringify({ workspace_id: options.workspace || 'fixture-a', ...body }) } : {}) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  assert.equal((await call('status', null, { anonymous: true })).status, 401);
  assert.equal((await call('status', null, { workspace: 'fixture-b' })).status, 403);
  assert.equal((await call('connect', {}, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const connect = await call('connect', {}); assert.equal(connect.status, 200);
  const state = new URL(connect.body.url).searchParams.get('state');
  const callback = await call('callback', { state, code: 'fixture-code' }); assert.equal(callback.status, 200);
  assert.ok(!JSON.stringify(callback.body).includes('FAKE_PROVIDER_TOKEN'));
  assert.equal((await call('callback', { state, code: 'fixture-code' })).status, 403);
  const status = await call('status'); const destination = status.body.destinations[0];
  const saved = await call('save', { text: 'Synthetic local HTTP fixture; never published externally.', destination_ids: [destination.id] }); assert.equal(saved.status, 200);
  let campaign = saved.body.campaign;
  assert.equal((await call('schedule', { campaign_id: campaign.id, revision: campaign.revision })).status, 409);
  const approved = await call('approve', { campaign_id: campaign.id, revision: campaign.revision }); campaign = approved.body.campaign;
  const scheduled = await call('schedule', { campaign_id: campaign.id, revision: campaign.revision }); assert.equal(scheduled.status, 200);
  const scheduledAgain = await call('schedule', { campaign_id: campaign.id, revision: scheduled.body.campaign.revision });
  assert.equal(scheduledAgain.body.jobs[0].id, scheduled.body.jobs[0].id);
  assert.equal((await call('worker', {})).status, 401);
  const dispatched = await call('worker', {}, { token: worker }); assert.equal(dispatched.body.result.job.status, 'published');
  assert.equal((await call('worker', {}, { token: worker })).body.result.idle, true); assert.equal(postCalls, 1);
  const verified = await call('verify', { job_id: scheduled.body.jobs[0].id }); assert.equal(verified.body.verified, true);
  assert.equal(verified.headers.get('cache-control'), 'private, no-store');
  const list = await call('campaigns'); assert.equal(list.body.jobs[0].provider_post_id, 'urn:li:share:123');
  assert.equal((await call('campaigns', null, { workspace: 'fixture-b' })).status, 403);
});
