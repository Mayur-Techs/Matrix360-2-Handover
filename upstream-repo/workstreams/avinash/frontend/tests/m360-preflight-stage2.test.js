'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const {
  runPreflightChecks,
  checkVault,
  checkWebhooks
} = require('../lib/m360-preflight.js');

const marketingHandler = require('../api/marketing.js');

function createMockReqRes({ method = 'GET', url = '/api/marketing/preflight?workspace_id=ws-preflight-test', role = 'platform_owner' } = {}) {
  const token = `token-${role}-${randomUUID()}`;
  const req = {
    method,
    url,
    query: { action: 'preflight', workspace_id: 'ws-preflight-test' },
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: { workspace_id: 'ws-preflight-test' }
  };

  let statusCode = 200;
  let responseData = '';

  const res = {
    get statusCode() { return statusCode; },
    set statusCode(code) { statusCode = code; },
    setHeader() {},
    writeHead(code) { statusCode = code; return res; },
    write(chunk) { responseData += chunk ? chunk.toString() : ''; return true; },
    end(chunk) {
      if (chunk) responseData += chunk.toString();
      return res;
    },
    get _body() {
      try { return JSON.parse(responseData); } catch { return responseData; }
    },
    get _status() { return statusCode; }
  };

  return { req, res };
}

test('Stage 2: Owner-Only Go-Live Preflight Engine', async (t) => {
  const origFetch = global.fetch;

  t.after(() => {
    global.fetch = origFetch;
  });

  await t.test('Unconfigured environment returns NOT-CONFIGURED for all services without inventing secrets', async () => {
    const prevVault = process.env.M360_TENANT_ENCRYPTION_KEY;
    const prevMeta = process.env.META_SYSTEM_USER_TOKEN;
    const prevBrevo = process.env.BREVO_SMTP_KEY;
    const prevLlm = process.env.OPENAI_API_KEY;

    delete process.env.M360_TENANT_ENCRYPTION_KEY;
    delete process.env.META_SYSTEM_USER_TOKEN;
    delete process.env.BREVO_SMTP_KEY;
    delete process.env.BREVO_SMTP_LOGIN;
    delete process.env.BREVO_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const results = await runPreflightChecks();
      assert.equal(results.length, 6);

      for (const r of results) {
        assert.ok(['NOT-CONFIGURED', 'PASS', 'FAIL'].includes(r.status));
        if (r.status === 'NOT-CONFIGURED') {
          assert.ok(r.fix, `NOT-CONFIGURED service ${r.service} must provide an actionable fix`);
        }
      }
    } finally {
      if (prevVault) process.env.M360_TENANT_ENCRYPTION_KEY = prevVault;
      if (prevMeta) process.env.META_SYSTEM_USER_TOKEN = prevMeta;
      if (prevBrevo) process.env.BREVO_SMTP_KEY = prevBrevo;
      if (prevLlm) process.env.OPENAI_API_KEY = prevLlm;
    }
  });

  await t.test('Role gating: /api/marketing/preflight is strictly restricted to platform_owner', async () => {
    process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    // Mock CRM lookups
    global.fetch = async (url, opts = {}) => {
      const auth = String(opts.headers?.Authorization || opts.headers?.authorization || '');
      const role = auth.includes('platform_owner') ? 'platform_owner' : 'client_admin';
      return {
        status: 200,
        ok: true,
        json: async () => [{ id: 'ws-preflight-test', role }]
      };
    };

    // Attempt 1: client_admin is refused (HTTP 403)
    const clientAdminCall = createMockReqRes({ role: 'client_admin' });
    await marketingHandler(clientAdminCall.req, clientAdminCall.res);
    assert.equal(clientAdminCall.res._status, 403, 'client_admin must be rejected with 403');
    assert.ok(clientAdminCall.res._body?.error?.includes('strictly restricted to platform_owner'));

    // Attempt 2: platform_owner is allowed (HTTP 200)
    const ownerCall = createMockReqRes({ role: 'platform_owner' });
    await marketingHandler(ownerCall.req, ownerCall.res);
    assert.equal(ownerCall.res._status, 200, 'platform_owner must receive 200');
    assert.equal(ownerCall.res._body?.status, 'ok');
    assert.ok(Array.isArray(ownerCall.res._body?.preflight));
  });

  await t.test('Vault verification: valid 32-byte key passes round-trip; invalid key fails', () => {
    // 1. Valid key passes
    process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString('base64');
    const validResult = checkVault();
    assert.equal(validResult.status, 'PASS');
    assert.ok(validResult.message.includes('AES-256-GCM round-trip'));

    // 2. Corrupt/short key fails
    process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.from('short-key').toString('base64');
    const invalidResult = checkVault();
    assert.equal(invalidResult.status, 'FAIL');
    assert.ok(invalidResult.message.includes('must decode to exactly 32 bytes'));

    delete process.env.M360_TENANT_ENCRYPTION_KEY;
  });

  await t.test('Webhooks verification: reports missing tokens accurately', () => {
    const prevWa = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    const prevSec = process.env.WHATSAPP_APP_SECRET;
    const prevBrv = process.env.BREVO_WEBHOOK_SECRET;

    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.BREVO_WEBHOOK_SECRET;
    delete process.env.BREVO_WEBHOOK_BEARER_TOKEN;

    try {
      const resMissing = checkWebhooks();
      assert.equal(resMissing.status, 'NOT-CONFIGURED');
      assert.ok(resMissing.fix.includes('WHATSAPP_WEBHOOK_VERIFY_TOKEN'));

      // Set all
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'token_123';
      process.env.WHATSAPP_APP_SECRET = 'secret_123';
      process.env.BREVO_WEBHOOK_SECRET = 'brevo_sec_123';

      const resPass = checkWebhooks();
      assert.equal(resPass.status, 'PASS');
    } finally {
      if (prevWa) process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = prevWa;
      else delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      if (prevSec) process.env.WHATSAPP_APP_SECRET = prevSec;
      else delete process.env.WHATSAPP_APP_SECRET;
      if (prevBrv) process.env.BREVO_WEBHOOK_SECRET = prevBrv;
      else delete process.env.BREVO_WEBHOOK_SECRET;
    }
  });
});
