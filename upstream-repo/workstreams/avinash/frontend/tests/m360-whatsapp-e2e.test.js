'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Set required test encryption keys and environment configuration
process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.META_APP_ID = 'test-meta-app-1001';
process.env.META_APP_SECRET = 'test-meta-app-secret-1002';
process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = 'test-config-1003';
process.env.META_SYSTEM_USER_TOKEN = 'test-sys-token-1004';
process.env.WHATSAPP_APP_SECRET = 'test-webhook-secret-1005';
process.env.META_GRAPH_VERSION = 'v21.0';

const {
  getWhatsAppOnboardingRecord,
  clearWhatsAppOnboardingStore
} = require('../lib/m360-whatsapp-onboarding');

const marketingHandler = require('../api/marketing');

function createMockReqRes({ method = 'GET', url = '/api/marketing', headers = {}, body = null, rawBody = null } = {}) {
  const req = {
    method,
    url,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer mock-test-token-012345678901234567890123456789',
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

test('Stage 1 E2E Regression Net: Full WhatsApp Onboarding Path to ready_limited', async (t) => {
  const wsId = 'ws-e2e-regress-' + Date.now();
  clearWhatsAppOnboardingStore();

  const origFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = origFetch;
    clearWhatsAppOnboardingStore();
  });

  // Mock network calls at the network boundary only (globalThis.fetch)
  globalThis.fetch = async (url, opts = {}) => {
    const urlStr = String(url);
    const method = String(opts.method || 'GET').toUpperCase();

    // CRM workspace membership authorization
    if (urlStr.includes('/me/workspaces')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: wsId, role: 'client_admin', is_active: true }]
      };
    }

    // Step 1: Meta OAuth code exchange
    if (urlStr.includes('/oauth/access_token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'meta-user-access-token-e2e',
          token_type: 'bearer'
        })
      };
    }

    // Step 1: Meta debug_token
    if (urlStr.includes('/debug_token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            is_valid: true,
            app_id: 'test-meta-app-1001',
            granular_scopes: [
              {
                scope: 'whatsapp_business_management',
                target_ids: ['waba-e2e-1001']
              }
            ]
          }
        })
      };
    }

    // Step 1: Meta query WABA phone numbers
    if (urlStr.includes('/waba-e2e-1001/phone_numbers')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 'phone-e2e-2002',
              display_phone_number: '+91 98765 43210',
              verified_name: 'Matrix Real Estate E2E'
            }
          ]
        })
      };
    }

    // Step 2: Meta phone registration
    if (urlStr.includes('/phone-e2e-2002/register') && method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      };
    }

    // Step 2: Meta WABA subscribed_apps
    if (urlStr.includes('/waba-e2e-1001/subscribed_apps') && method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true })
      };
    }

    // Step 3: Meta submit starter templates
    if (urlStr.includes('/waba-e2e-1001/message_templates') && method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'meta-tpl-' + Math.random().toString(36).slice(2),
          status: 'PENDING',
          category: 'UTILITY'
        })
      };
    }

    // Step 4: Meta query template statuses
    if (urlStr.includes('/waba-e2e-1001/message_templates') && method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { name: 'm360_site_visit_invitation', status: 'APPROVED', category: 'MARKETING', language: 'en_US' },
            { name: 'm360_booking_confirmation', status: 'APPROVED', category: 'UTILITY', language: 'en_US' },
            { name: 'm360_exclusive_launch_offer', status: 'APPROVED', category: 'MARKETING', language: 'en_US' },
            { name: 'm360_site_tour_reminder', status: 'APPROVED', category: 'UTILITY', language: 'en_US' }
          ]
        })
      };
    }

    // Step 5: Meta send test message
    if (urlStr.includes('/phone-e2e-2002/messages') && method === 'POST') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          messaging_product: 'whatsapp',
          contacts: [{ input: '+919999999999', wa_id: '919999999999' }],
          messages: [{ id: 'wamid.E2E_CONFIRM_TEST_MSG_999' }]
        })
      };
    }

    throw new Error('Unexpected unmocked network request in E2E test: ' + urlStr);
  };

  await t.test('0. Baseline: initial state is not_started', () => {
    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'not_started');
    assert.equal(rec.waba_id, null);
    assert.equal(rec.phone_number_id, null);
    assert.equal(rec.test_delivery_confirmed_at, null);
  });

  await t.test('1. Exchange Embedded Signup code -> number_registering', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/exchange&workspace_id=${wsId}`,
      body: { code: 'valid-meta-auth-code-123', workspace_id: wsId }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200, 'Exchange endpoint must return 200: ' + JSON.stringify(res._body));
    assert.equal(res._body.status, 'ok');
    assert.equal(res._body.waba_id, 'waba-e2e-1001');
    assert.equal(res._body.phone_number_id, 'phone-e2e-2002');

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'number_registering');
    assert.equal(rec.waba_id, 'waba-e2e-1001');
    assert.equal(rec.phone_number_id, 'phone-e2e-2002');
    assert.notEqual(rec.state, 'ready_limited', 'State must not be ready_limited');
    assert.notEqual(rec.state, 'verified', 'State must not be verified');
  });

  await t.test('2. Register phone number + subscribe WABA -> templates_in_review', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/register&workspace_id=${wsId}`,
      body: { workspace_id: wsId, pin: '123456' }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200, 'Registration endpoint must return 200: ' + JSON.stringify(res._body));
    assert.equal(res._body.status, 'ok');
    assert.equal(res._body.state, 'templates_in_review');

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'templates_in_review');
    assert.notEqual(rec.state, 'ready_limited', 'State must not be ready_limited');
    assert.notEqual(rec.state, 'verified', 'State must not be verified');
  });

  await t.test('3. Submit starter templates -> templates pending in review', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/templates/submit&workspace_id=${wsId}`,
      body: { workspace_id: wsId }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200, 'Templates submission must return 200: ' + JSON.stringify(res._body));
    assert.equal(res._body.status, 'ok');
    assert.equal(res._body.templates.length, 4);

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'templates_in_review');
    assert.equal(rec.templates.length, 4);
    assert.ok(rec.templates.some(t => t.status === 'PENDING'));
    assert.notEqual(rec.state, 'ready_limited', 'State must not be ready_limited');
    assert.notEqual(rec.state, 'verified', 'State must not be verified');
  });

  await t.test('4. Poll template statuses -> all approved', async () => {
    const { req, res } = createMockReqRes({
      method: 'GET',
      url: `/api/marketing?action=whatsapp/onboarding/templates/status&workspace_id=${wsId}`
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200, 'Templates status poll must return 200: ' + JSON.stringify(res._body));
    assert.equal(res._body.status, 'ok');
    assert.equal(res._body.all_approved, true);

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'templates_in_review');
    assert.ok(rec.templates.every(t => t.status === 'APPROVED'));
    assert.notEqual(rec.state, 'ready_limited', 'State must not be ready_limited');
    assert.notEqual(rec.state, 'verified', 'State must not be verified');
  });

  await t.test('5. Send onboarding test message -> unconfirmed, state remains templates_in_review', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/test-send&workspace_id=${wsId}`,
      body: {
        workspace_id: wsId,
        template_name: 'm360_site_visit_invitation',
        owner_phone: '+919999999999'
      }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200, 'Test send must return 200: ' + JSON.stringify(res._body));
    assert.equal(res._body.status, 'dispatched');
    assert.equal(res._body.provider_message_id, 'wamid.E2E_CONFIRM_TEST_MSG_999');

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.test_message_id, 'wamid.E2E_CONFIRM_TEST_MSG_999');
    assert.equal(rec.test_delivery_confirmed_at, null, 'Test delivery must be unconfirmed prior to webhook callback');
    assert.notEqual(rec.state, 'ready_limited', 'HARD GATE: Sending a test message must NEVER set state to ready_limited');
    assert.notEqual(rec.state, 'verified', 'HARD GATE: Sending a test message must NEVER set state to verified');
  });

  await t.test('6. Unrelated or unconfirmed webhook does NOT trigger transition', async () => {
    const unconfirmedPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-e2e-1001',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+91 98765 43210',
                  phone_number_id: 'phone-e2e-2002'
                },
                statuses: [
                  {
                    id: 'wamid.UNRELATED_MSG_ID_777',
                    status: 'sent',
                    timestamp: '1731145200',
                    recipient_id: '919999999999'
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const rawBuffer = Buffer.from(JSON.stringify(unconfirmedPayload), 'utf8');
    const hmac = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBuffer).digest('hex');

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: '/api/marketing?action=webhooks/whatsapp',
      headers: {
        'x-hub-signature-256': hmac
      },
      rawBody: rawBuffer
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.test_delivery_confirmed_at, null);
    assert.notEqual(rec.state, 'ready_limited');
  });

  await t.test('7. Real webhook delivery callback for test message ID -> state transitions to ready_limited', async () => {
    const deliveredPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-e2e-1001',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '+91 98765 43210',
                  phone_number_id: 'phone-e2e-2002'
                },
                statuses: [
                  {
                    id: 'wamid.E2E_CONFIRM_TEST_MSG_999',
                    status: 'delivered',
                    timestamp: '1731145260',
                    recipient_id: '919999999999'
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const rawBuffer = Buffer.from(JSON.stringify(deliveredPayload), 'utf8');
    const hmac = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBuffer).digest('hex');

    const { req, res } = createMockReqRes({
      method: 'POST',
      url: '/api/marketing?action=webhooks/whatsapp',
      headers: {
        'x-hub-signature-256': hmac
      },
      rawBody: rawBuffer
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.ok(rec.test_delivery_confirmed_at, 'Delivery timestamp must be recorded');
    assert.equal(rec.state, 'ready_limited', 'HARD GATE: Confirmed webhook delivery MUST transition state to ready_limited');
  });

  await t.test('8. Owner status screen reports ready_limited with active tier 250 guidance', async () => {
    const { req, res } = createMockReqRes({
      method: 'GET',
      url: `/api/marketing?action=whatsapp/onboarding/status&workspace_id=${wsId}`
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.status, 'ok');
    assert.equal(res._body.onboarding.state, 'ready_limited');
    assert.equal(res._body.next_action.title, 'Ready for Outreach (Tier 250)');
    assert.equal(res._body.onboarding.tier, 'tier_250');
  });
});
