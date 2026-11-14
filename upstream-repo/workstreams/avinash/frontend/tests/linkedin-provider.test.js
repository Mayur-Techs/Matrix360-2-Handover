'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createProvider, ProviderError } = require('../lib/m360-linkedin-provider');
const config = { clientId: 'test-client', clientSecret: 'test-secret', redirectUri: 'http://localhost:3000/api/linkedin', apiVersion: '202610' };
const member = 'urn:li:person:member1';
const reply = (body, status = 200, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers });
function scripted(steps) {
  const calls = [];
  const provider = createProvider(config, async (url, options) => {
    calls.push({ url, options }); const step = steps.shift();
    assert.ok(step, `Unexpected request ${url}`);
    return typeof step === 'function' ? step(url, options) : step;
  });
  return { provider, calls, done: () => assert.equal(steps.length, 0) };
}

test('OAuth exchanges on the server and introspects actual scopes when token response omits them', async () => {
  const { provider, calls, done } = scripted([
    reply({ access_token: 'opaque-token', expires_in: 3600 }),
    reply({ active: true, client_id: config.clientId, scope: 'openid,profile,w_member_social' })
  ]);
  const url = new URL(provider.authorizationUrl('a'.repeat(48)));
  assert.equal(url.hostname, 'www.linkedin.com'); assert.equal(url.searchParams.get('scope'), 'openid profile w_member_social');
  const result = await provider.exchangeCode('one-time-code');
  assert.deepEqual(result.scopes, ['openid', 'profile', 'w_member_social']);
  assert.equal(result.refresh_token, null); assert.ok(Date.parse(result.expires_at) > Date.now());
  assert.equal(new URLSearchParams(calls[0].options.body).get('redirect_uri'), config.redirectUri);
  assert.equal(calls[1].url, 'https://www.linkedin.com/oauth/v2/introspectToken'); done();
});

test('OAuth never substitutes requested scopes for absent grant evidence', async () => {
  const { provider } = scripted([reply({ access_token: 'token', expires_in: 3600 }), reply({ active: true })]);
  await assert.rejects(provider.exchangeCode('code'), { code: 'OAUTH_SCOPES' });
});

test('refresh exchanges only a provider-issued credential and uses confirmed new expiry/scopes', async () => {
  const { provider, calls } = scripted([reply({ access_token: 'new-access', expires_in: 3600, refresh_token: 'rotated-refresh', refresh_token_expires_in: 7200, scope: 'openid profile w_member_social' })]);
  const result = await provider.refreshToken('original-refresh');
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('refresh_token'), 'original-refresh');
  assert.equal(result.refresh_token, 'rotated-refresh'); assert.ok(Date.parse(result.refresh_expires_at) > Date.parse(result.expires_at));
  assert.deepEqual(result.scopes, ['openid', 'profile', 'w_member_social']);
  const missing = scripted([reply({ access_token: 'new-access', expires_in: 60, scope: 'openid profile' })]);
  const preserved = await missing.provider.refreshToken('original-refresh');
  assert.equal(preserved.refresh_token, 'original-refresh'); assert.equal(preserved.refresh_expires_at, null);
  const revoked = scripted([reply({}, 400)]);
  await assert.rejects(revoked.provider.refreshToken('revoked-refresh'), { status: 400, uncertain: false });
});

test('author recheck rejects another member and revoked tokens', async () => {
  const { provider } = scripted([reply({ active: true, scope: 'w_member_social' }), reply({ sub: 'member1', name: 'Test Member' })]);
  await assert.rejects(provider.checkAuthority('token', 'urn:li:person:foreign'), { code: 'AUTHOR' });
  const revoked = scripted([reply({ active: false, status: 'revoked' })]);
  await assert.rejects(revoked.provider.checkAuthority('token', member), { code: 'GRANT_INACTIVE' });
});

test('Page discovery checks organic operation authority and excludes denied Pages', async () => {
  const { provider, calls, done } = scripted([
    reply({ sub: 'member1', name: 'Test Member' }),
    reply({ elements: [{ organization: 'urn:li:organization:100' }, { organization: 'urn:li:organization:200' }], paging: { links: [] } }),
    reply({ status: { 'com.linkedin.organization.Denied': {} } }),
    reply({ status: { 'com.linkedin.organization.Approved': {} } }),
    reply({ localizedName: 'Allowed Page' })
  ]);
  const rows = await provider.destinations('token', ['w_member_social', 'w_organization_social', 'rw_organization_admin']);
  assert.deepEqual(rows.map(row => row.urn), [member, 'urn:li:organization:200']);
  assert.ok(calls[2].url.includes('ORGANIC_SHARE_CREATE')); assert.equal(rows[1].capabilities.read, false); done();
});

test('native video uploads exact byte ranges, ordered ETags, finalizes, then reads actual processing status', async () => {
  const { provider, calls, done } = scripted([
    reply({ value: { video: 'urn:li:video:video1', uploadToken: 'upload-session', uploadInstructions: [
      { firstByte: 0, lastByte: 2, uploadUrl: 'https://www.linkedin.com/dms-uploads/part1' },
      { firstByte: 3, lastByte: 74999, uploadUrl: 'https://www.linkedin.com/dms-uploads/part2' }
    ] } }), reply(null, 201, { etag: '"part-one"' }), reply(null, 201, { etag: '"part-two"' }), reply(null, 200),
    reply({ id: 'urn:li:video:video1', status: 'PROCESSING', owner: member })
  ]);
  const bytes = Buffer.concat([Buffer.from('abcdef'), Buffer.alloc(74994)]);
  const result = await provider.uploadMedia('token', member, { kind: 'video', bytes, mime: 'video/mp4', title: 'Actual file' });
  assert.equal(result.status, 'PROCESSING'); assert.equal(calls[1].options.body.toString(), 'abc'); assert.deepEqual(calls[2].options.body, bytes.subarray(3));
  assert.deepEqual(JSON.parse(calls[3].options.body).finalizeUploadRequest.uploadedPartIds, ['part-one', 'part-two']); done();
});

test('upload rejects untrusted redirect destination and incomplete video ranges before finalization', async () => {
  const foreign = scripted([reply({ value: { image: 'urn:li:image:image1', uploadUrl: 'https://attacker.example/upload' } })]);
  await assert.rejects(foreign.provider.uploadMedia('token', member, { kind: 'image', bytes: Buffer.from('file'), mime: 'image/png' }), { code: 'UPLOAD_URL' });
  assert.equal(foreign.calls.length, 1);
  const broken = scripted([reply({ value: { video: 'urn:li:video:video1', uploadInstructions: [{ firstByte: 2, lastByte: 3, uploadUrl: 'https://www.linkedin.com/upload' }] } })]);
  await assert.rejects(broken.provider.uploadMedia('token', member, { kind: 'video', bytes: Buffer.alloc(75000), mime: 'video/mp4' }), { code: 'VIDEO_PARTS' });
  const small = scripted([]);
  await assert.rejects(small.provider.uploadMedia('token', member, { kind: 'video', bytes: Buffer.from('file'), mime: 'video/mp4' }), { code: 'MEDIA_SIZE' });
});

test('image upload without media read access reports unavailable status rather than fabricated readiness', async () => {
  const { provider } = scripted([reply({ value: { image: 'urn:li:image:image1', uploadUrl: 'https://www.linkedin.com/dms-uploads/file' } }), reply(null, 201), reply({}, 403)]);
  const result = await provider.uploadMedia('token', member, { kind: 'image', bytes: Buffer.from('image'), mime: 'image/png' });
  assert.equal(result.status, 'STATUS_UNAVAILABLE'); assert.equal(result.id, 'urn:li:image:image1');
});

test('publication uses real provider acknowledgement and refuses pending media', async () => {
  const { provider, calls } = scripted([reply(null, 201, { 'x-restli-id': 'urn:li:share:12345' })]);
  await assert.rejects(provider.publish('token', { author: member, text: 'Post', media: { id: 'urn:li:video:one', status: 'PROCESSING' } }), { code: 'MEDIA_PROCESSING' });
  const result = await provider.publish('token', { author: member, text: 'Real approved post' });
  assert.equal(result.id, 'urn:li:share:12345'); assert.equal(result.accepted, true); assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['LinkedIn-Version'], '202610'); assert.equal(calls[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].options.body).distribution.targetEntities, []);
});

test('missing post IDs, network timeouts, and server errors are unknown outcomes with no blind retry', async () => {
  for (const step of [reply(null, 201), reply({}, 503), () => { throw new Error('network contains secret'); }]) {
    const { provider, calls } = scripted([step]);
    await assert.rejects(provider.publish('token', { author: member, text: 'Approved' }), error => error instanceof ProviderError && error.uncertain && !error.retryable && !error.message.includes('secret'));
    assert.equal(calls.length, 1);
  }
});

test('explicit rate limiting carries provider retry time and is distinguishable from unknown outcome', async () => {
  const { provider } = scripted([reply({}, 429, { 'retry-after': '120' })]);
  await assert.rejects(provider.publish('token', { author: member, text: 'Approved' }), error => error.status === 429 && error.retryAfter === 120 && error.retryable && !error.uncertain);
});

test('missing analytics access and missing metric values remain unavailable, never invented zeros', async () => {
  const absent = scripted([]);
  assert.deepEqual(await absent.provider.metrics('token', { author: member, id: 'urn:li:share:123', scopes: ['w_member_social'] }), { available: false, metrics: null, retrieved_at: null, reason: 'Analytics permission has not been granted.' });
  const { provider, calls } = scripted([reply({ elements: [{ count: 7 }] }), ...Array.from({ length: 4 }, () => reply({ elements: [] }))]);
  const result = await provider.metrics('token', { author: member, id: 'urn:li:ugcPost:123', scopes: ['r_member_postAnalytics'] });
  assert.equal(result.metrics.IMPRESSION, 7); assert.equal(result.metrics.REACTION, null); assert.ok(calls[0].url.includes('entity=(ugc:urn%3Ali%3AugcPost%3A123)'));
});
