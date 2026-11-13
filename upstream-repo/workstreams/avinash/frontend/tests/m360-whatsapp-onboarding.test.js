'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Setup required test vault key for AES-256-GCM
process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const {
  WHATSAPP_ONBOARDING_STATES,
  getWhatsAppOnboardingRecord,
  saveWhatsAppOnboardingRecord,
  clearWhatsAppOnboardingStore,
  getMetaOnboardingConfig,
  transitionWhatsAppOnboarding,
  exchangeEmbeddedSignupCode
} = require('../lib/m360-whatsapp-onboarding');

const {
  findWorkspaceByWhatsAppPhoneNumberId,
  getStoredProviderCredentials,
  decryptSecret
} = require('../lib/m360-marketing-orchestrator');

const marketingHandler = require('../api/marketing');

// Helper to simulate HTTP requests against marketingHandler
function createMockReqRes({ method = 'GET', url = '/api/marketing', headers = {}, body = null } = {}) {
  const req = {
    method,
    url,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer mock-test-token-012345678901234567890123456789',
      ...headers
    },
    body
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

test('Stage 1: WhatsApp Onboarding State Machine & Vault Storage', async (t) => {
  const wsId = 'ws-stage1-test-' + Date.now();
  clearWhatsAppOnboardingStore();

  await t.test('initial state is not_started', () => {
    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'not_started');
    assert.equal(rec.tier, 'tier_250');
    assert.equal(rec.waba_id, null);
    assert.equal(rec.phone_number_id, null);
    assert.equal(rec.test_delivery_confirmed_at, null);
  });

  await t.test('start_signup transitions not_started to awaiting_client_login', () => {
    const updated = transitionWhatsAppOnboarding(wsId, 'start_signup');
    assert.equal(updated.state, 'awaiting_client_login');
  });

  await t.test('exchange_success requires valid Meta facts: waba_id, phone_number_id, access_token', () => {
    assert.throws(() => {
      transitionWhatsAppOnboarding(wsId, 'exchange_success', { waba_id: 'waba_123' });
    }, /Meta exchange requires genuine waba_id, phone_number_id, and access_token/);

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'awaiting_client_login', 'State must not advance on missing facts');
  });

  await t.test('exchange_success advances to number_registering and securely vaults the token', () => {
    const metaFact = {
      waba_id: 'waba_meta_8888',
      phone_number_id: 'phone_meta_9999',
      access_token: 'EAAB_test_access_token_super_secret',
      display_phone_number: '+919876543210',
      verified_name: 'Stage 1 Business'
    };

    const updated = transitionWhatsAppOnboarding(wsId, 'exchange_success', metaFact);
    assert.equal(updated.state, 'number_registering');
    assert.equal(updated.waba_id, 'waba_meta_8888');
    assert.equal(updated.phone_number_id, 'phone_meta_9999');
    assert.equal(updated.display_phone_number, '+919876543210');
    assert.equal(updated.last_meta_error, null);

    // Verify credential stored in workspace vault (AES-256-GCM encrypted)
    const stored = getStoredProviderCredentials(wsId, 'whatsapp');
    assert.ok(stored, 'Provider credentials must be saved for tenant');
    assert.equal(stored.phoneNumberId, 'phone_meta_9999');
    assert.equal(stored.wabaId, 'waba_meta_8888');
    assert.equal(stored.displayPhoneNumber, '+919876543210');
    assert.ok(stored.encryptedToken, 'Token must be encrypted');
    assert.notEqual(stored.encryptedToken, metaFact.access_token, 'Plaintext token must not be stored');

    // Decrypting via vault master key recovers the exact token
    const decrypted = decryptSecret(stored.encryptedToken, wsId);
    assert.equal(decrypted, metaFact.access_token);

    // Verify tenant isolation routing: incoming webhook for phone_meta_9999 immediately finds wsId
    const resolvedTenant = findWorkspaceByWhatsAppPhoneNumberId('phone_meta_9999');
    assert.equal(resolvedTenant, wsId, 'Tenant routing must map phone_number_id to correct workspace');
  });

  await t.test('exchange_failed holds state at current step and records real Meta error', () => {
    const errorWs = 'ws-fail-test-' + Date.now();
    transitionWhatsAppOnboarding(errorWs, 'start_signup');
    const beforeRec = getWhatsAppOnboardingRecord(errorWs);
    assert.equal(beforeRec.state, 'awaiting_client_login');

    const metaErr = { message: 'Code has expired or is invalid', code: 100, fbtrace_id: 'tr_xyz' };
    const updated = transitionWhatsAppOnboarding(errorWs, 'exchange_failed', { error: metaErr });

    assert.equal(updated.state, 'awaiting_client_login', 'State must NOT advance on exchange failure');
    assert.deepEqual(updated.last_meta_error, metaErr, 'Must record exact Meta error');
  });
});

test('Stage 2: Embedded Signup Begin & Exchange API Endpoints', async (t) => {
  const wsId = 'ws-stage2-test-' + Date.now();
  clearWhatsAppOnboardingStore();

  // Mock workspace authorization and CRM lookup
  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  // Setup mock CRM response for auth
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('/me/workspaces')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: wsId, role: 'client_admin', is_active: true }]
      };
    }
    if (urlStr.includes('/oauth/access_token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'EAAB_mock_graph_exchange_token_12345',
          waba_id: 'waba_mock_7777',
          phone_number_id: 'phone_mock_6666',
          display_phone_number: '+919830012345',
          verified_name: 'Verified Real Estate Ltd'
        })
      };
    }
    return origFetch(url, opts);
  };

  await t.test('GET /api/marketing/whatsapp/onboarding/config returns plain config', async () => {
    process.env.META_APP_ID = 'test-meta-app-123';
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = 'test-config-id-456';
    process.env.META_APP_SECRET = 'test-app-secret-789';

    const { req, res } = createMockReqRes({
      method: 'GET',
      url: `/api/marketing?action=whatsapp/onboarding/config&workspace_id=${wsId}`
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.status, 'ok');
    assert.equal(body.config.meta_app_id, 'test-meta-app-123');
    assert.equal(body.config.meta_embedded_signup_config_id, 'test-config-id-456');
    assert.equal(body.config.configured, true);
    assert.deepEqual(body.config.missing_config, []);
  });

  await t.test('GET config identifies missing variables honestly without fabricating values', async () => {
    delete process.env.META_APP_ID;
    delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;

    const { req, res } = createMockReqRes({
      method: 'GET',
      url: `/api/marketing?action=whatsapp/onboarding/config&workspace_id=${wsId}`
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.config.configured, false);
    assert.ok(body.config.missing_config.includes('META_APP_ID'));
    assert.ok(body.config.missing_config.includes('META_EMBEDDED_SIGNUP_CONFIG_ID'));
  });

  await t.test('POST /api/marketing/whatsapp/onboarding/exchange role gates sales_operator with 403', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('/me/workspaces')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: wsId, role: 'sales_operator', is_active: true }]
        };
      }
      return origFetch(url);
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/exchange`,
      body: { workspace_id: wsId, code: 'auth_code_from_fb_login' }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 403, 'sales_operator cannot exchange or configure onboarding credentials');
  });

  await t.test('POST exchange with client_admin performs server-side exchange and moves state to number_registering', async () => {
    process.env.META_APP_ID = 'test-meta-app-123';
    process.env.META_APP_SECRET = 'test-app-secret-789';

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/me/workspaces')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: wsId, role: 'client_admin', is_active: true }]
        };
      }
      if (urlStr.includes('/oauth/access_token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'EAAB_token_exchanged_live_99999',
            waba_id: 'waba_live_5555',
            phone_number_id: 'phone_live_4444',
            display_phone_number: '+919830055555',
            verified_name: 'Metro Skyline Realtors'
          })
        };
      }
      return origFetch(url);
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/exchange`,
      body: { workspace_id: wsId, code: 'valid_fb_login_code_xyz' }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.status, 'ok');
    assert.equal(body.state, 'number_registering');
    assert.equal(body.waba_id, 'waba_live_5555');
    assert.equal(body.phone_number_id, 'phone_live_4444');
    assert.equal(body.display_phone_number, '+919830055555');

    // Confirm state persisted in store
    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'number_registering');
    assert.equal(rec.waba_id, 'waba_live_5555');
  });

  await t.test('POST exchange surfaces real Meta Graph errors and does not advance state', async () => {
    const failWs = 'ws-fail-exchange-' + Date.now();
    transitionWhatsAppOnboarding(failWs, 'start_signup');

    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/me/workspaces')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: failWs, role: 'platform_owner', is_active: true }]
        };
      }
      if (urlStr.includes('/oauth/access_token')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: {
              message: 'This authorization code has been used.',
              type: 'OAuthException',
              code: 100,
              error_subcode: 36009
            }
          })
        };
      }
      return origFetch(url);
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/exchange`,
      body: { workspace_id: failWs, code: 'used_or_expired_code' }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 400);
    const body = res._body;
    assert.equal(body.status, 'failed');
    assert.equal(body.error, 'GRAPH_EXCHANGE_FAILED');
    assert.equal(body.message, 'This authorization code has been used.');

    const rec = getWhatsAppOnboardingRecord(failWs);
    assert.equal(rec.state, 'awaiting_client_login', 'State must remain at awaiting_client_login on error');
    assert.equal(rec.last_meta_error.code, 100);
  });
});

test('Stage 3: Phone Number Registration & WABA Subscription', async (t) => {
  const wsId = 'ws-stage3-test-' + Date.now();
  clearWhatsAppOnboardingStore();

  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  transitionWhatsAppOnboarding(wsId, 'start_signup');
  transitionWhatsAppOnboarding(wsId, 'exchange_success', {
    waba_id: 'waba_reg_111',
    phone_number_id: 'phone_reg_222',
    access_token: 'EAAB_token_reg_333',
    display_phone_number: '+919830088888',
    verified_name: 'Stage 3 Estate'
  });

  await t.test('POST register role gates sales_operator with 403', async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes('/me/workspaces')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: wsId, role: 'sales_operator', is_active: true }]
        };
      }
      return origFetch(url);
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/register`,
      body: { workspace_id: wsId, pin: '123456' }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 403);
  });

  await t.test('POST register with PIN required returns 428 and holds state', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/me/workspaces')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: wsId, role: 'client_admin', is_active: true }]
        };
      }
      if (urlStr.includes('/register')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: {
              message: 'Two-step verification PIN required for this number.',
              code: 133005
            }
          })
        };
      }
      return origFetch(url);
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/register`,
      body: { workspace_id: wsId }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 428);
    const body = res._body;
    assert.equal(body.error, 'PIN_REQUIRED');

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'number_registering', 'State must not advance when PIN is required');
  });

  await t.test('POST register successfully registers number and subscribes app, moving to templates_in_review', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/me/workspaces')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: wsId, role: 'client_admin', is_active: true }]
        };
      }
      if (urlStr.includes('/register')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        };
      }
      if (urlStr.includes('/subscribed_apps')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        };
      }
      return origFetch(url);
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/register`,
      body: { workspace_id: wsId, pin: '654321' }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.status, 'ok');
    assert.equal(body.registered, true);
    assert.equal(body.subscribed, true);
    assert.equal(body.state, 'templates_in_review');

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'templates_in_review');
  });
});

test('Stage 4: Starter Template Submission, Status Polling & Send Gate', async (t) => {
  const wsId = 'ws-stage4-test-' + Date.now();
  clearWhatsAppOnboardingStore();

  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  transitionWhatsAppOnboarding(wsId, 'start_signup');
  transitionWhatsAppOnboarding(wsId, 'exchange_success', {
    waba_id: 'waba_tpl_444',
    phone_number_id: 'phone_tpl_555',
    access_token: 'EAAB_token_tpl_666',
    display_phone_number: '+919830099999',
    verified_name: 'Template Realty'
  });
  transitionWhatsAppOnboarding(wsId, 'register_and_subscribe_success', {
    registered: true,
    subscribed: true
  });

  await t.test('POST templates/submit creates starter templates with PENDING status', async () => {
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/me/workspaces')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: wsId, role: 'platform_owner', is_active: true }]
        };
      }
      if (urlStr.includes('/message_templates')) {
        const body = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'meta_tpl_' + body.name, status: 'PENDING', category: body.category })
        };
      }
      return origFetch(url, opts);
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/templates/submit`,
      body: { workspace_id: wsId }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.status, 'ok');
    assert.ok(Array.isArray(body.templates));
    assert.equal(body.templates.length, 4);
    assert.ok(body.templates.every(t => t.status === 'PENDING'));

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.templates.length, 4);
  });

  await t.test('GET templates/status reads real Meta statuses (APPROVED / REJECTED)', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/me/workspaces')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: wsId, role: 'client_admin', is_active: true }]
        };
      }
      if (urlStr.includes('/message_templates')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { name: 'm360_site_visit_invitation', status: 'APPROVED', category: 'MARKETING' },
              { name: 'm360_booking_confirmation', status: 'APPROVED', category: 'UTILITY' },
              { name: 'm360_exclusive_launch_offer', status: 'REJECTED', category: 'MARKETING', rejected_reason: 'PROMOTIONAL_CONTENT_VIOLATION' },
              { name: 'm360_site_tour_reminder', status: 'PENDING', category: 'UTILITY' }
            ]
          })
        };
      }
      return origFetch(url);
    };

    const { req, res } = createMockReqRes({
      method: 'GET',
      url: `/api/marketing?action=whatsapp/onboarding/templates/status&workspace_id=${wsId}`
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.status, 'ok');

    const rejected = body.templates.find(t => t.name === 'm360_exclusive_launch_offer');
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.rejection_reason, 'PROMOTIONAL_CONTENT_VIOLATION');

    const approved = body.templates.find(t => t.name === 'm360_site_visit_invitation');
    assert.equal(approved.status, 'APPROVED');
  });

  async function setupWhatsAppTask(ws) {
    const {
      createHandoverEnvelope,
      dispatchMarketingTask,
      approveChannelDraft
    } = require('../lib/m360-marketing-orchestrator');

    const envelope = createHandoverEnvelope({
      workspace_id: ws,
      payload: { prompt: 'Template Test', business_name: 'Biz', profile_type: 'b2b_industrial', project: 'p1' }
    });
    const task = await dispatchMarketingTask(envelope, {
      skip_ai: true,
      keylessTestMode: true,
      audienceFixture: [{ id: 'fix-1', test_data: true, outbound_blocked: true }]
    });
    for (let i = 0; i < 20 && task.status !== 'draft_ready'; i++) await new Promise(r => setTimeout(r, 5));

    task.audience_snapshot = {
      test_data: false,
      outbound_blocked: false,
      contacts: [
        {
          id: 'wa-lead-1',
          phone: '+919876543210',
          whatsapp_opt_in_status: 'granted',
          consent_evidence: { whatsapp: true, source: 'crm_verified' }
        }
      ]
    };
    task.connections = { whatsapp: true };
    const draft = task.channel_draft_versions.WhatsApp.versions.at(-1);
    approveChannelDraft(ws, task.correlation_id, 'WhatsApp', draft.version_hash, 'marketing_operator');
    task.channel_readiness.WhatsApp.gates.gate2_audience = { passed: true, eligible_count: 1 };
    task.channel_readiness.WhatsApp.gates.gate3_provider = { passed: true, provider_name: 'WHATSAPP' };
    return task;
  }

  await t.test('Live WhatsApp send blocks PENDING template with TEMPLATE_NOT_APPROVED', async () => {
    const { executeMarketingChannel } = require('../lib/m360-marketing-orchestrator');

    process.env.MARKETING_LIVE_SEND_ENABLED = 'true';
    t.after(() => {
      delete process.env.MARKETING_LIVE_SEND_ENABLED;
    });

    const task = await setupWhatsAppTask(wsId);

    await assert.rejects(async () => {
      await executeMarketingChannel(wsId, task.correlation_id, 'WhatsApp', {
        mode: 'live',
        templateName: 'm360_site_tour_reminder', // PENDING in store
        operatorApproved: true,
        approvalPhrase: 'SEND_APPROVED_WHATSAPP_CAMPAIGN',
        token: 'EAAB_test',
        phoneNumberId: 'phone_tpl_555'
      });
    }, (err) => {
      assert.equal(err.code, 'TEMPLATE_NOT_APPROVED');
      assert.equal(err.template_status, 'PENDING');
      return true;
    });
  });

  await t.test('Live WhatsApp send blocks REJECTED template and reports Meta rejection reason', async () => {
    const { executeMarketingChannel } = require('../lib/m360-marketing-orchestrator');

    process.env.MARKETING_LIVE_SEND_ENABLED = 'true';
    t.after(() => {
      delete process.env.MARKETING_LIVE_SEND_ENABLED;
    });

    const task = await setupWhatsAppTask(wsId);

    await assert.rejects(async () => {
      await executeMarketingChannel(wsId, task.correlation_id, 'WhatsApp', {
        mode: 'live',
        templateName: 'm360_exclusive_launch_offer', // REJECTED in store
        operatorApproved: true,
        approvalPhrase: 'SEND_APPROVED_WHATSAPP_CAMPAIGN',
        token: 'EAAB_test',
        phoneNumberId: 'phone_tpl_555'
      });
    }, (err) => {
      assert.equal(err.code, 'TEMPLATE_NOT_APPROVED');
      assert.equal(err.template_status, 'REJECTED');
      assert.ok(err.message.includes('PROMOTIONAL_CONTENT_VIOLATION'));
      return true;
    });
  });

  await t.test('Live WhatsApp send succeeds when template is APPROVED', async () => {
    const { executeMarketingChannel } = require('../lib/m360-marketing-orchestrator');

    process.env.MARKETING_LIVE_SEND_ENABLED = 'true';
    t.after(() => {
      delete process.env.MARKETING_LIVE_SEND_ENABLED;
    });

    const task = await setupWhatsAppTask(wsId);

    const mockAdapter = {
      name: 'mock_meta_whatsapp_adapter',
      execute: async () => ({
        provider_message_id: 'wamid.HBgLOTE5ODMwMDMzMzMzFQIAERgSRTk5OTA4NkZGMDU5MEQ4REE1AA=='
      })
    };

    const sendResult = await executeMarketingChannel(wsId, task.correlation_id, 'WhatsApp', {
      mode: 'live',
      templateName: 'm360_site_visit_invitation', // APPROVED in store
      operatorApproved: true,
      approvalPhrase: 'SEND_APPROVED_WHATSAPP_CAMPAIGN',
      token: 'EAAB_test',
      phoneNumberId: 'phone_tpl_555',
      whatsAppAdapter: mockAdapter
    });

    assert.equal(sendResult.status, 'provider_accepted');
    assert.equal(sendResult.sent, true);
    assert.equal(sendResult.accepted_count, 1);
  });
});

test('Stage 5: Confirmed Test Delivery Gate & Tier Upgrades', async (t) => {
  const wsId = 'ws-stage5-test-' + Date.now();
  clearWhatsAppOnboardingStore();

  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  const testPhone = '+919830077777';
  const testPhoneId = 'phone_test_gate_555';

  transitionWhatsAppOnboarding(wsId, 'start_signup');
  transitionWhatsAppOnboarding(wsId, 'exchange_success', {
    waba_id: 'waba_test_gate_444',
    phone_number_id: testPhoneId,
    access_token: 'EAAB_token_gate_555',
    display_phone_number: testPhone,
    verified_name: 'Gate 5 Builders'
  });
  transitionWhatsAppOnboarding(wsId, 'register_and_subscribe_success', {
    registered: true,
    subscribed: true
  });
  transitionWhatsAppOnboarding(wsId, 'templates_updated', {
    templates: [
      { name: 'm360_site_visit_invitation', status: 'APPROVED', category: 'MARKETING' },
      { name: 'm360_booking_confirmation', status: 'APPROVED', category: 'UTILITY' }
    ]
  });

  let dispatchedWamid = '';

  await t.test('POST test-send dispatches message but leaves state in templates_in_review without turning green', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/me/workspaces')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: wsId, role: 'client_admin', is_active: true }]
        };
      }
      if (urlStr.includes('/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: [{ id: 'wamid.HBgLOTE5ODMwMDc3Nzc3FQIAERgSRTk5OTA4NkZGMDU5MEQ4REE2AA==' }]
          })
        };
      }
      return origFetch(url);
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/test-send`,
      body: { workspace_id: wsId, template_name: 'm360_site_visit_invitation' }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.status, 'dispatched');
    assert.ok(body.provider_message_id.startsWith('wamid.'));
    dispatchedWamid = body.provider_message_id;

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'templates_in_review', 'State must NOT advance to ready until webhook confirms delivery');
    assert.equal(rec.test_message_id, dispatchedWamid);
    assert.equal(rec.test_delivery_confirmed_at, null);
  });

  await t.test('POST test-send with missing provider_message_id records NO_PROVIDER_ID failure honestly', async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/me/workspaces')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: wsId, role: 'platform_owner', is_active: true }]
        };
      }
      if (urlStr.includes('/messages')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}) // Empty response without message id
        };
      }
      return origFetch(url);
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/test-send`,
      body: { workspace_id: wsId }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 400);
    const body = res._body;
    assert.equal(body.status, 'failed');
    assert.equal(body.error, 'NO_PROVIDER_ID');
    assert.equal(body.provider_message_id, null);
  });

  await t.test('Webhook delivered callback confirms delivery and advances state to ready_limited (tier 250)', async () => {
    const crypto = require('node:crypto');
    const appSecret = 'webhook_app_secret_test_555';
    process.env.WHATSAPP_APP_SECRET = appSecret;
    t.after(() => {
      delete process.env.WHATSAPP_APP_SECRET;
    });

    const webhookPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba_test_gate_444',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: testPhone,
                  phone_number_id: testPhoneId
                },
                statuses: [
                  {
                    id: dispatchedWamid,
                    status: 'delivered',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: testPhone.replace(/\D/g, '')
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    });

    const sig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(Buffer.from(webhookPayload, 'utf8')).digest('hex');

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=webhooks/whatsapp`,
      headers: {
        'x-hub-signature-256': sig,
        'content-type': 'application/json'
      },
      body: webhookPayload
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.ok(rec.test_delivery_confirmed_at, 'Must record test_delivery_confirmed_at timestamp');
    assert.equal(rec.state, 'ready_limited', 'State turns to ready_limited only after confirmed delivery');
    assert.equal(rec.tier, 'tier_250', 'Tier must stay tier_250 until Meta raises it');
  });

  await t.test('Meta business verification tier raise advances state to verified', () => {
    const updated = transitionWhatsAppOnboarding(wsId, 'tier_raised_verified', {
      tier: 'tier_1k',
      business_verified: true
    });
    assert.equal(updated.state, 'verified');
    assert.equal(updated.tier, 'tier_1k');
  });
});

test('Stage 6: Owner Status Screen & Cost Disclosure Details', async (t) => {
  const wsId = 'ws-stage6-test-' + Date.now();
  clearWhatsAppOnboardingStore();

  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
  });

  globalThis.fetch = async (url) => {
    if (String(url).includes('/me/workspaces')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: wsId, role: 'client_admin', is_active: true }]
      };
    }
    return origFetch(url);
  };

  await t.test('GET status with unconfirmed delivery shows in-progress next_action, never active', async () => {
    transitionWhatsAppOnboarding(wsId, 'start_signup');

    const { req, res } = createMockReqRes({
      method: 'GET',
      url: `/api/marketing?action=whatsapp/onboarding/status&workspace_id=${wsId}`
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.equal(body.status, 'ok');
    assert.equal(body.onboarding.state, 'awaiting_client_login');
    assert.equal(body.onboarding.test_delivery_confirmed_at, null);
    assert.equal(body.next_action.title, 'Complete Meta Login');
    assert.notEqual(body.onboarding.state, 'ready_limited');
    assert.notEqual(body.onboarding.state, 'verified');
  });

  await t.test('GET status returns transparent Meta rates disclosure matching rates table', async () => {
    const { req, res } = createMockReqRes({
      method: 'GET',
      url: `/api/marketing?action=whatsapp/onboarding/status&workspace_id=${wsId}`
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    const body = res._body;
    assert.ok(body.rates);
    assert.equal(body.rates.marketing.base_inr, 0.8631);
    assert.equal(body.rates.marketing.gst_pct, 18);
    assert.equal(body.rates.marketing.total_inr, 1.0185);
    assert.equal(body.rates.utility.base_inr, 0.1150);
    assert.equal(body.rates.utility.total_inr, 0.1357);
    assert.equal(body.rates.service.total_inr, 0);
  });
});
