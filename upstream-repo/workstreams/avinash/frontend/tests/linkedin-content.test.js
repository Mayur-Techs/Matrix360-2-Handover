'use strict';
// Real SQLite/service asset storage; declared fake Creative Studio and download transports.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { createStore } = require('../lib/m360-linkedin-store');
const { createService } = require('../lib/m360-linkedin-service');
const { createContentBridge } = require('../lib/m360-linkedin-content');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64');
const a = { workspace: 'tenant-a', actor: 'actor-a', role: 'client_admin' };
const b = { workspace: 'tenant-b', actor: 'actor-b', role: 'client_admin' };
const request = { headers: { authorization: 'Bearer ' + 'a'.repeat(40) } };
function fixture(t, overrides = {}) {
  const store = createStore({ backend: 'sqlite', path: ':memory:', env: {} }); t.after(() => store.close());
  const service = createService({ store, provider: {}, env: {}, fetchImpl: async () => { throw Error('Unexpected service network'); } });
  const calls = [], downloads = [], jobs = new Map(), control = { status: 'queued', url: null, failStart: false, failDownload: false, responseWorkspace: null };
  const handler = async (req, res) => {
    const body = req.method === 'POST' ? req.body : req.query; calls.push({ method: req.method, body, auth: req.headers.authorization });
    if (req.method === 'POST') {
      assert.equal(body.platform, 'LinkedIn'); assert.equal(body.confirm, true);
      if (control.failStart) throw Error('Simulated uncertain start');
      const job = randomUUID(); jobs.set(body.workspace_id, job); res.statusCode = 202;
      res.end(JSON.stringify({ status: 'queued', kind: body.kind, workspace_id: body.workspace_id, job_id: job }));
    } else {
      const client = 'm360-' + createHash('sha256').update('matrix360-crm-tenant-v1:' + body.workspace_id).digest('hex').slice(0, 28);
      res.statusCode = 200;
      res.end(JSON.stringify({ status: control.status, kind: body.kind, workspace_id: control.responseWorkspace || body.workspace_id, job_id: body.job_id,
        asset_url: control.url || `https://matrix360-socialmanager-recovery-staging.onrender.com/api/v2/image-file/${client}/${body.job_id}?token=declared-fake-signed-token` }));
    }
  };
  const fetchImpl = async (url, options) => {
    downloads.push({ url, options });
    if (control.failDownload) { control.failDownload = false; throw Error('Transient download failure'); }
    return overrides.download ? overrides.download(url, options) : new Response(PNG, { headers: { 'content-type': 'image/png', 'content-length': PNG.length.toString() } });
  };
  return { store, service, calls, downloads, jobs, control, bridge: createContentBridge({ store, service, handler, fetchImpl }) };
}
const brief = (id = randomUUID()) => ({ request_id: id, kind: 'image', prompt: 'Create a professional LinkedIn business announcement image.' });

test('concurrent and repeated starts reserve one durable request before generation and never save bearer', async t => {
  const f = fixture(t), input = brief();
  const results = await Promise.all([f.bridge.start(a, request, input), f.bridge.start(a, request, input)]);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(f.calls[0].auth, request.headers.authorization);
  assert.equal((await f.bridge.start(a, request, input)).request.status, 'queued');
  assert.equal(f.calls.length, 1); assert.ok(results.every(result => result.request.id === input.request_id));
  const stored = await f.store.get(a.workspace, 'content_requests', input.request_id);
  assert.equal(stored.correlation_id, input.request_id); assert.ok(stored.job_id);
  assert.ok(!JSON.stringify(stored).includes(request.headers.authorization));
  await assert.rejects(f.bridge.start(a, request, { ...input, prompt: 'A different professional LinkedIn business creative.' }), { code: 'CONTENT_REQUEST_CONFLICT' });
});

test('uncertain provider start is durable and repeating the request never triggers generation again', async t => {
  const f = fixture(t), input = brief(); f.control.failStart = true;
  assert.equal((await f.bridge.start(a, request, input)).request.status, 'unknown');
  f.control.failStart = false;
  assert.equal((await f.bridge.start(a, request, input)).request.status, 'unknown');
  assert.equal((await f.bridge.poll(a, request, input)).request.status, 'unknown');
  assert.equal(f.calls.length, 1);
});

test('pending content waits; completion imports actual bytes as immutable tenant asset exactly once', async t => {
  const f = fixture(t), input = brief(); await f.bridge.start(a, request, input);
  f.control.status = 'processing'; assert.equal((await f.bridge.poll(a, request, input)).request.status, 'processing');
  assert.equal(f.downloads.length, 0); assert.equal((await f.store.list(a.workspace, 'assets')).length, 0);
  f.control.status = 'completed';
  await Promise.all([f.bridge.poll(a, request, input), f.bridge.poll(a, request, input)]);
  const result = await f.bridge.poll(a, request, input);
  assert.equal(result.request.status, 'completed'); assert.ok(result.asset?.id); assert.equal(result.asset.workspace_id, a.workspace);
  assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0].options.redirect, 'error'); assert.equal(f.downloads[0].options.headers, undefined);
  assert.deepEqual(await f.service.assetBytes(a.workspace, result.asset), PNG);
  assert.equal(result.asset.sha256, createHash('sha256').update(PNG).digest('hex'));
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  assert.ok(!JSON.stringify(await f.store.list(a.workspace, 'content_requests')).includes('declared-fake-signed-token'));
});

test('requests and resulting assets remain separate across two client workspaces', async t => {
  const f = fixture(t), input = brief(); await f.bridge.start(a, request, input);
  await assert.rejects(f.bridge.poll(b, request, input), { code: 'NOT_FOUND' }); assert.equal(f.calls.length, 1);
  await f.bridge.start(b, request, input); f.control.status = 'completed';
  const first = await f.bridge.poll(a, request, input), second = await f.bridge.poll(b, request, input);
  assert.notEqual(first.asset.id, second.asset.id); assert.notEqual(first.request.job_id, second.request.job_id);
  assert.equal(await f.store.get(b.workspace, 'assets', first.asset.id), null);
  assert.equal(await f.store.get(a.workspace, 'assets', second.asset.id), null);
});

test('arbitrary hosts, foreign tenant paths and mismatched job responses never trigger downloads', async t => {
  for (const mode of ['host', 'path', 'workspace']) {
    const f = fixture(t), input = brief(); await f.bridge.start(a, request, input); f.control.status = 'completed';
    if (mode === 'host') f.control.url = 'https://attacker.example/file.png?token=long-fake-signed-token';
    if (mode === 'path') f.control.url = `https://matrix360-socialmanager-recovery-staging.onrender.com/api/v2/image-file/another-client/${f.jobs.get(a.workspace)}?token=long-fake-signed-token`;
    if (mode === 'workspace') f.control.responseWorkspace = b.workspace;
    await assert.rejects(f.bridge.poll(a, request, input), { code: mode === 'workspace' ? 'CONTENT_TENANT' : 'CONTENT_ASSET_URL' });
    assert.equal(f.downloads.length, 0);
  }
});

test('failed download retries import of the same provider job without repeating generation', async t => {
  const f = fixture(t), input = brief(); await f.bridge.start(a, request, input); f.control.status = 'completed'; f.control.failDownload = true;
  const retry = await f.bridge.poll(a, request, input); assert.equal(retry.request.status, 'processing'); assert.equal(retry.request.error.code, 'CONTENT_DOWNLOAD');
  const complete = await f.bridge.poll(a, request, input); assert.equal(complete.request.status, 'completed'); assert.equal(f.downloads.length, 2);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});

test('oversized output remains unimported and no ready asset is invented', async t => {
  const f = fixture(t, { download: () => new Response(PNG, { headers: { 'content-length': String(21 * 1024 * 1024) } }) }), input = brief();
  await f.bridge.start(a, request, input); f.control.status = 'completed';
  const result = await f.bridge.poll(a, request, input);
  assert.equal(result.request.error.code, 'CONTENT_TOO_LARGE'); assert.equal(result.asset, undefined);
  assert.deepEqual(await f.store.list(a.workspace, 'assets'), []);
});

test('poll recovers a completed asset after interruption before content request acknowledgement', async t => {
  const f = fixture(t), input = brief(); await f.bridge.start(a, request, input); f.control.status = 'completed';
  const complete = await f.bridge.poll(a, request, input), stored = complete.request;
  await f.store.put(a.workspace, 'content_requests', stored.id, { ...stored, status: 'importing', asset_id: null, import_until: new Date(Date.now() + 60000).toISOString() }, { expectedRevision: stored.revision });
  const callsBefore = f.calls.length, downloadsBefore = f.downloads.length;
  const recovered = await f.bridge.poll(a, request, input);
  assert.equal(recovered.request.status, 'completed'); assert.equal(recovered.asset.id, complete.asset.id);
  assert.equal(f.calls.length, callsBefore); assert.equal(f.downloads.length, downloadsBefore);
});
