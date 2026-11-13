'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const { URL } = require('node:url');

const orchestrator = require('../lib/m360-marketing-orchestrator');
const marketingApi = require('../api/marketing');
const { dispatchWhatsAppCampaign, normalizePhoneNumber } = require('../lib/m360-whatsapp-provider');

process.env.M360_KEYLESS_TEST_MODE = 'true';
process.env.NODE_ENV = 'test';
process.env.M360_MARKETING_AI_ENABLED = 'true';

const originalFetch = global.fetch;
const memberships = [
  { id: 'ws-vault-test-alpha', name: 'Alpha Workspace', role: 'client_admin', profile_type: 'b2b_industrial', project_slug: 'lakhotia' },
  { id: 'ws-tenant-alpha', name: 'Tenant Alpha', role: 'client_admin', profile_type: 'b2b_industrial', project_slug: 'lakhotia' },
  { id: 'ws-tenant-beta', name: 'Tenant Beta', role: 'client_admin', profile_type: 'b2b_industrial', project_slug: 'lakhotia' },
  { id: 'ws-autonomous-test', name: 'Autonomous Enterprise Workspace', role: 'client_admin', profile_type: 'b2b_industrial', project_slug: 'lakhotia' }
];

function installMockFetch() {
  global.fetch = async url => {
    if (String(url).endsWith('/me/workspaces')) return { status: 200, ok: true, json: async () => memberships };
    if (String(url).includes('/leads')) return { status: 200, ok: true, json: async () => [] };
    return { status: 200, ok: true, json: async () => ({}) };
  };
}

function mockHttp(method, path, body = {}, auth = 'Bearer test-session-token-long-enough-123') {
  const parsedUrl = new URL(path, 'http://127.0.0.1');
  const query = Object.fromEntries(parsedUrl.searchParams);
  const req = {
    method,
    url: path,
    query,
    headers: { authorization: auth, 'content-type': 'application/json' },
    body
  };

  let resData = null;
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead(code) { res.statusCode = code; return res; },
    end(data) {
      if (data) {
        try {
          resData = JSON.parse(data);
        } catch (_) {
          resData = data;
        }
      }
    }
  };

  return {
    req,
    res,
    get: () => ({ status: res.statusCode, body: resData })
  };
}

test('Multi-Provider Vault: Configures, encrypts with AES-256-GCM, and verifies all 5 channels', async () => {
  installMockFetch();
  const wsA = 'ws-vault-test-alpha';

  // 1. WhatsApp
  const waReq = mockHttp('POST', '/api/marketing/providers/configure', {
    workspace_id: wsA,
    provider: 'whatsapp',
    token: 'EAABw_secret_whatsapp_token_99999',
    phone_number_id: '109876543212345',
    waba_id: '987654321012345'
  });
  await marketingApi(waReq.req, waReq.res);
  const waRes = waReq.get();
  assert.equal(waRes.status, 200);
  assert.equal(waRes.body.provider, 'whatsapp');
  assert.equal(waRes.body.verified, true);
  assert.equal(waRes.body.masked_token.slice(-4), '9999');

  // 2. Email
  const emailReq = mockHttp('POST', '/api/marketing/providers/configure', {
    workspace_id: wsA,
    provider: 'email',
    smtp_login: 'brevo-login-user-123',
    smtp_key: 'xsmtpsib-secret-key-12345',
    sender_email: 'campaigns@testalpha.com',
    sender_name: 'Alpha Brand'
  });
  await marketingApi(emailReq.req, emailReq.res);
  const emailRes = emailReq.get();
  assert.equal(emailRes.status, 200);
  assert.equal(emailRes.body.provider, 'email');
  assert.equal(emailRes.body.masked_token.slice(-4), '2345');

  // 3. Meta (Instagram & Facebook)
  const metaReq = mockHttp('POST', '/api/marketing/providers/configure', {
    workspace_id: wsA,
    provider: 'meta',
    token: 'EAAG_meta_page_access_token_6789',
    page_id: '1029384756',
    ig_user_id: '178414000123'
  });
  await marketingApi(metaReq.req, metaReq.res);
  const metaRes = metaReq.get();
  assert.equal(metaRes.status, 200);
  assert.equal(metaRes.body.provider, 'meta');
  assert.equal(metaRes.body.masked_token.slice(-4), '6789');

  // 4. LinkedIn
  const liReq = mockHttp('POST', '/api/marketing/providers/configure', {
    workspace_id: wsA,
    provider: 'linkedin',
    token: 'AQV_linkedin_access_token_3456',
    organization_urn: 'urn:li:organization:7654321'
  });
  await marketingApi(liReq.req, liReq.res);
  const liRes = liReq.get();
  assert.equal(liRes.status, 200);
  assert.equal(liRes.body.provider, 'linkedin');
  assert.equal(liRes.body.masked_token.slice(-4), '3456');

  // 5. SMS (Twilio)
  const smsReq = mockHttp('POST', '/api/marketing/providers/configure', {
    workspace_id: wsA,
    provider: 'sms',
    account_sid: 'AC_MOCK_TEST_ACCOUNT_SID_FOR_SMS_00',
    auth_token: 'auth_token_secret_sms_7890',
    from_number: '+12025550199'
  });
  await marketingApi(smsReq.req, smsReq.res);
  const smsRes = smsReq.get();
  assert.equal(smsRes.status, 200);
  assert.equal(smsRes.body.provider, 'sms');
  assert.equal(smsRes.body.masked_token.slice(-4), '7890');

  // Check providers/status endpoint
  const statusReq = mockHttp('GET', `/api/marketing/providers/status?workspace_id=${wsA}`);
  await marketingApi(statusReq.req, statusReq.res);
  const statusRes = statusReq.get();
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.providers.whatsapp.configured, true);
  assert.equal(statusRes.body.providers.email.configured, true);
  assert.equal(statusRes.body.providers.meta.configured, true);
  assert.equal(statusRes.body.providers.linkedin.configured, true);
  assert.equal(statusRes.body.providers.sms.configured, true);

  global.fetch = originalFetch;
});

test('Multi-Provider Vault: Strict Tenant Isolation between workspaces', async () => {
  const wsA = 'ws-tenant-alpha';
  const wsB = 'ws-tenant-beta';

  // Configure wsA with unique token
  orchestrator.configureMarketingProvider(wsA, 'whatsapp', {
    token: 'EAABw_secret_alpha_token_1111',
    phone_number_id: '111111111111'
  });

  const credsA = orchestrator.getStoredProviderCredentials(wsA, 'whatsapp');
  assert.ok(credsA);
  assert.equal(credsA.maskedToken.slice(-4), '1111');

  // Verify wsB has NO access to wsA's credentials
  const credsB = orchestrator.getStoredProviderCredentials(wsB, 'whatsapp');
  assert.equal(credsB, null, 'Workspace B must have zero access to Workspace A credentials');

  // Verify decryptSecret throws if attempting to decrypt wsA payload with wsB key
  assert.throws(() => {
    orchestrator.decryptSecret(credsA.encryptedToken, wsB);
  }, /Unsupported state or unable to authenticate data|Invalid encrypted payload|bad decrypt/i);

  // Decrypt with correct workspace key succeeds
  const decrypted = orchestrator.decryptSecret(credsA.encryptedToken, wsA);
  assert.equal(decrypted, 'EAABw_secret_alpha_token_1111');
});

test('WhatsApp Marketing AI: Directives with 50 eligible leads, project brochure, and scheduling', async () => {
  installMockFetch();
  const workspaceId = 'ws-autonomous-test';

  const { req, res, get } = mockHttp('POST', '/api/marketing?action=conversations', {
    workspace_id: workspaceId,
    prompt: 'Prepare WhatsApp messages for 50 eligible leads, use the latest approved project brochure and schedule them for tomorrow.'
  });

  await marketingApi(req, res);
  const result = get();

  assert.equal(result.status, 202);
  assert.equal(result.body.status, 'ready_for_review');

  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && m.content.includes('Campaign drafts have been prepared'));
  assert.ok(assistantMsg, 'Assistant must report drafts ready for review');
  assert.match(assistantMsg.content, /Target Audience Summary/i);
  assert.match(assistantMsg.content, /Cost Estimate/i);

  // Verify calendar event was durable registered
  const task = orchestrator.getMarketingTask(workspaceId, result.body.correlation_id);
  assert.ok(task);
  const waEvent = (task.calendar_events || []).find(e => e.channel === 'WhatsApp');
  assert.ok(waEvent, 'WhatsApp campaign must be scheduled on the calendar');
  assert.equal(waEvent.status, 'scheduled');

  global.fetch = originalFetch;
});
