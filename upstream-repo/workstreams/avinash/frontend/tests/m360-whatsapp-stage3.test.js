'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Required AES-256-GCM tenant encryption key for tests
process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.WHATSAPP_APP_SECRET = 'test-secret-stage3';
process.env.META_GRAPH_VERSION = 'v21.0';

const {
  saveWhatsAppOnboardingRecord,
  clearWhatsAppOnboardingStore,
  runGuardedWhatsAppSelfTest
} = require('../lib/m360-whatsapp-onboarding');

const {
  configureMarketingProvider
} = require('../lib/m360-marketing-orchestrator');

const marketingHandler = require('../api/marketing');

function createMockReqRes({ method = 'GET', url = '/api/marketing', headers = {}, body = null, rawBody = null } = {}) {
  const req = {
    method,
    url,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer mock-test-token-stage3',
      ...headers
    },
    body,
    rawBody: rawBody || (body ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8') : Buffer.alloc(0))
  };

  let statusCode = 200;
  let headersSent = {};
  let responseData = '';

  const res = {
    get statusCode() { return statusCode; },
    set statusCode(code) { statusCode = code; },
    setHeader(name, val) { headersSent[name.toLowerCase()] = val; },
    getHeader(name) { return headersSent[name.toLowerCase()]; },
    writeHead(code, hdrs) {
      statusCode = code;
      if (hdrs) Object.assign(headersSent, hdrs);
      return res;
    },
    write(chunk) {
      responseData += (chunk ? chunk.toString() : '');
      return true;
    },
    end(chunk) {
      if (chunk) responseData += chunk.toString();
      return res;
    },
    get _body() {
      try { return JSON.parse(responseData); } catch { return responseData; }
    },
    get _status() { return statusCode; },
    get _headers() { return headersSent; }
  };

  return { req, res };
}

test('Stage 3: Guarded WhatsApp Self-Test (Owner-Only, Real Meta Simulation Free)', async (t) => {
  const wsId = 'ws-test-s3-' + Date.now();
  clearWhatsAppOnboardingStore();

  const origEnv = { ...process.env };
  const origFetch = globalThis.fetch;

  t.after(() => {
    process.env = origEnv;
    globalThis.fetch = origFetch;
    clearWhatsAppOnboardingStore();
  });

  await t.test('Self-test rejects non-platform_owner with 403', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('/me/workspaces')) {
        return { ok: true, status: 200, json: async () => [{ id: wsId, role: 'client_admin', is_active: true }] };
      }
      return origFetch(url);
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/self-test&workspace_id=${wsId}`,
      body: { workspace_id: wsId, owner_phone: '+919999988888' }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 403, 'Must reject client_admin from self-test');
    assert.ok(String(res._body.error).includes('platform_owner'));
  });

  await t.test('Self-test halts and reports missing keys when Meta env vars not set', async () => {
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    delete process.env.META_SYSTEM_USER_TOKEN;

    globalThis.fetch = async (url) => {
      if (String(url).includes('/me/workspaces')) {
        return { ok: true, status: 200, json: async () => [{ id: wsId, role: 'platform_owner', is_active: true }] };
      }
      return origFetch(url);
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/self-test&workspace_id=${wsId}`,
      body: { workspace_id: wsId, owner_phone: '+919999988888' }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.status, 'missing_keys');
    assert.equal(res._body.skipped, true);
    assert.ok(res._body.missing_keys.includes('META_APP_ID'));
    assert.ok(res._body.missing_keys.includes('META_APP_SECRET'));
    assert.ok(res._body.missing_keys.includes('META_SYSTEM_USER_TOKEN'));
    assert.ok(!res._body.simulated, 'Must never simulate Meta responses');
  });

  await t.test('Self-test runs real sequential check when keys configured and redacts tokens', async () => {
    process.env.META_APP_ID = 'meta-app-s3';
    process.env.META_APP_SECRET = 'meta-secret-s3';
    process.env.META_SYSTEM_USER_TOKEN = 'meta-system-token-s3';
    process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

    // Setup onboarded workspace state
    saveWhatsAppOnboardingRecord(wsId, {
      state: 'templates_in_review',
      waba_id: 'waba-s3',
      phone_number_id: 'phone-s3',
      templates: [{ name: 'm360_site_visit_invitation', status: 'APPROVED' }]
    });

    configureMarketingProvider(wsId, 'whatsapp', {
      token: 'client-token-s3-secret',
      phone_number_id: 'phone-s3',
      waba_id: 'waba-s3'
    }, { verified: true });

    let sentToRecipient = null;

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/me/workspaces')) {
        return { ok: true, status: 200, json: async () => [{ id: wsId, role: 'platform_owner', is_active: true }] };
      }
      if (u.includes('/me?fields=')) {
        return { ok: true, status: 200, json: async () => ({ id: 'meta-app-s3', name: 'Matrix360 Live App' }) };
      }
      if (u.includes('/phone-s3?fields=')) {
        return { ok: true, status: 200, json: async () => ({ id: 'phone-s3', display_phone_number: '+919999988888', quality_rating: 'GREEN' }) };
      }
      if (u.includes('/phone-s3/messages')) {
        const bodyObj = JSON.parse(opts.body || '{}');
        sentToRecipient = bodyObj.to;
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.SELF_TEST_MSG_01' }] }) };
      }
      return origFetch(url, opts);
    };

    const result = await runGuardedWhatsAppSelfTest({
      workspaceId: wsId,
      ownerPhone: '+91 99999 88888',
      fetchImpl: globalThis.fetch
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'completed');
    assert.equal(result.recipient, '+919999988888');
    assert.equal(sentToRecipient, '919999988888', 'Must send to specified owner phone number ONLY');
    assert.equal(result.provider_message_id, 'wamid.SELF_TEST_MSG_01');
    assert.equal(JSON.stringify(result).includes('client-token-s3-secret'), false, 'Client token must never appear in self-test output');
  });
});
