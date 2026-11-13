'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Ensure test tenant encryption key is present for AES-256-GCM vault
process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

const {
  getMetaOnboardingConfig,
  getWhatsAppOnboardingRecord,
  saveWhatsAppOnboardingRecord,
  clearWhatsAppOnboardingStore,
  transitionWhatsAppOnboarding
} = require('../lib/m360-whatsapp-onboarding');

const {
  configureMarketingProvider,
  getStoredProviderCredentials,
  resetTaskStoreForTests
} = require('../lib/m360-marketing-orchestrator');

const marketingHandler = require('../api/marketing');

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

describe('Stage 5: Front-End Verified WhatsApp Connect & Status Flow', () => {
  const originalEnv = { ...process.env };
  const origFetch = globalThis.fetch;
  let currentTestRole = 'client_admin';
  let activeTestWsId = null;

  beforeEach(() => {
    clearWhatsAppOnboardingStore();
    resetTaskStoreForTests();
    currentTestRole = 'client_admin';
  });

  after(() => {
    globalThis.fetch = origFetch;
  });

  // Intercept CRM /me/workspaces fetch for test workspaces
  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    if (urlStr.includes('/me/workspaces')) {
      const wsId = activeTestWsId || 'default';
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: wsId, role: currentTestRole, is_active: true }]
      };
    }
    if (urlStr.includes('/oauth/access_token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'EAAB_test_mock_token_123',
          waba_id: 'waba_mock_111',
          phone_number_id: 'phone_mock_222',
          display_phone_number: '+91 98765 43210',
          verified_name: 'Verified Front-End Test Corp'
        })
      };
    }
    return origFetch(url, opts);
  };

  // Restore environment after each test
  function restoreEnv() {
    process.env.META_APP_ID = originalEnv.META_APP_ID;
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = originalEnv.META_EMBEDDED_SIGNUP_CONFIG_ID;
    process.env.META_APP_SECRET = originalEnv.META_APP_SECRET;
    process.env.META_GRAPH_VERSION = originalEnv.META_GRAPH_VERSION;
  }

  it('Flow 1: Keys-Missing State — returns configured: false and front-end displays Setup Not Finished', async () => {
    delete process.env.META_APP_ID;
    delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
    delete process.env.META_APP_SECRET;

    const wsId = 'ws-fe-missing-' + randomUUID();
    activeTestWsId = wsId;
    const { req, res } = createMockReqRes({
      method: 'GET',
      url: `/api/marketing?action=whatsapp/onboarding/config&workspace_id=${wsId}`
    });

    await marketingHandler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._body.status, 'ok');
    assert.equal(res._body.config.configured, false, 'Must report configured: false when keys are absent');
    assert.ok(res._body.config.missing_config.includes('META_APP_ID'));
    assert.ok(res._body.config.missing_config.includes('META_EMBEDDED_SIGNUP_CONFIG_ID'));

    // Verify HTML source contract matches this endpoint and status handling
    const htmlPath = path.join(__dirname, '..', 'frontend-source', 'whatsapp-onboarding.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(html.includes('/api/marketing/whatsapp/onboarding/config'), 'Front-end must poll onboarding config');
    assert.ok(html.includes('Setup incomplete on server'), 'Front-end must render setup warning');
    assert.ok(html.includes('Setup Not Finished'), 'Button text must show Setup Not Finished when unconfigured');

    restoreEnv();
  });

  it('Flow 2: Keys-Present State — returns configured: true and enables WhatsApp Connect button', async () => {
    process.env.META_APP_ID = '987654321012345';
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = 'meta_config_verified_99';
    process.env.META_APP_SECRET = 'sec_meta_0000000000000000';
    process.env.META_GRAPH_VERSION = 'v21.0';

    const wsId = 'ws-fe-present-' + randomUUID();
    activeTestWsId = wsId;
    const { req, res } = createMockReqRes({
      method: 'GET',
      url: `/api/marketing?action=whatsapp/onboarding/config&workspace_id=${wsId}`
    });

    await marketingHandler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._body.status, 'ok');
    assert.equal(res._body.config.configured, true, 'Must report configured: true when keys are present');
    assert.equal(res._body.config.meta_app_id, '987654321012345');
    assert.equal(res._body.config.meta_embedded_signup_config_id, 'meta_config_verified_99');
    assert.equal(res._body.config.meta_graph_version, 'v21.0');
    assert.deepEqual(res._body.config.missing_config, []);

    // Verify front-end initializes Meta SDK and enables button
    const htmlPath = path.join(__dirname, '..', 'frontend-source', 'whatsapp-onboarding.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(html.includes('Connect WhatsApp Business Number'), 'Button text must become Connect WhatsApp Business Number');
    assert.ok(html.includes('loadMetaSdk'), 'Must load Meta SDK when configured');

    restoreEnv();
  });

  it('Flow 3: Role Gate & Validation on Token Exchange Endpoint', async () => {
    const wsId = 'ws-fe-exchange-role-' + randomUUID();
    activeTestWsId = wsId;

    // 1. Missing authorization code rejected with 400
    currentTestRole = 'client_admin';
    const { req: reqNoCode, res: resNoCode } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/exchange&workspace_id=${wsId}`,
      body: { workspace_id: wsId }
    });
    await marketingHandler(reqNoCode, resNoCode);
    assert.equal(resNoCode._status, 400, 'Must reject missing code with 400');
    assert.ok(resNoCode._body.error.includes('Authorization code'));

    // 2. Viewer role rejected with 403
    currentTestRole = 'viewer';
    const { req: reqViewer, res: resViewer } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=whatsapp/onboarding/exchange&workspace_id=${wsId}`,
      body: { code: 'test_auth_code_123', workspace_id: wsId }
    });
    await marketingHandler(reqViewer, resViewer);
    assert.equal(resViewer._status, 403, 'Viewer role cannot perform WhatsApp onboarding');
  });

  it('Flow 4: State Machine — Successful exchange transitions to number_registering, NEVER false ready', async () => {
    const wsId = 'ws-fe-statemachine-' + randomUUID();

    // Verify initial state is not_started
    const initial = getWhatsAppOnboardingRecord(wsId);
    assert.equal(initial.state, 'not_started');
    assert.equal(initial.test_delivery_confirmed_at, null);

    // Simulate legitimate Meta exchange fact
    const updated = transitionWhatsAppOnboarding(wsId, 'exchange_success', {
      waba_id: 'waba_998877',
      phone_number_id: 'phone_665544',
      access_token: 'EAAB_test_token_verified',
      display_phone_number: '+1 555-0199',
      verified_name: 'Matrix360 Production Demo'
    });

    assert.equal(updated.state, 'number_registering', 'State must advance to number_registering');
    assert.equal(updated.waba_id, 'waba_998877');
    assert.equal(updated.phone_number_id, 'phone_665544');
    assert.notEqual(updated.state, 'ready_limited', 'State must NEVER prematurely claim ready_limited');
    assert.notEqual(updated.state, 'verified', 'State must NEVER prematurely claim verified');
  });

  it('Flow 5: Webhook Confirmation Requirement — Ready status is strictly gated on test delivery receipt', async () => {
    const wsId = 'ws-fe-gate-' + randomUUID();
    activeTestWsId = wsId;
    currentTestRole = 'client_admin';

    // Transition through registration and templates approval
    transitionWhatsAppOnboarding(wsId, 'exchange_success', {
      waba_id: 'waba_gate_1',
      phone_number_id: 'phone_gate_1',
      access_token: 'EAAB_test_gate',
      display_phone_number: '+91 98765 43210',
      verified_name: 'Gate Test Corp'
    });

    transitionWhatsAppOnboarding(wsId, 'register_and_subscribe_success', {
      registered: true,
      subscribed: true
    });

    // Provide approved template
    transitionWhatsAppOnboarding(wsId, 'templates_updated', {
      templates: [
        { name: 'm360_intro_v1', category: 'MARKETING', language: 'en', status: 'APPROVED' }
      ]
    });

    let record = getWhatsAppOnboardingRecord(wsId);
    // Despite approved templates, because delivery is unconfirmed, state MUST NOT be ready_limited
    assert.equal(record.state, 'templates_in_review', 'State must hold at templates_in_review until delivery confirmed');
    assert.equal(record.test_delivery_confirmed_at, null);

    // Now deliver real signed webhook callback
    transitionWhatsAppOnboarding(wsId, 'test_delivery_confirmed', {
      confirmed: true,
      confirmed_at: new Date().toISOString()
    });

    const readyRecord = getWhatsAppOnboardingRecord(wsId);
    assert.ok(readyRecord.test_delivery_confirmed_at, 'Delivery confirmed timestamp must be set');
    assert.equal(readyRecord.state, 'ready_limited', 'Only after webhook delivery confirmation does state become ready_limited');
  });

  it('Flow 6: WhatsApp Status Page reflects honest state and delivery receipt', async () => {
    const wsId = 'ws-fe-statuspage-' + randomUUID();
    activeTestWsId = wsId;
    currentTestRole = 'client_admin';

    // Seed record
    saveWhatsAppOnboardingRecord(wsId, {
      state: 'ready_limited',
      waba_id: 'waba_status_check',
      phone_number_id: 'phone_status_check',
      display_phone_number: '+91 98765 00000',
      verified_name: 'Status Page Verification',
      tier: 'tier_250',
      test_delivery_confirmed_at: '2026-11-10T10:00:00.000Z',
      templates: [
        { name: 'starter_template', status: 'APPROVED', category: 'MARKETING', language: 'en' }
      ]
    });

    const { req, res } = createMockReqRes({
      method: 'GET',
      url: `/api/marketing?action=whatsapp/onboarding/status&workspace_id=${wsId}`
    });

    await marketingHandler(req, res);

    assert.equal(res._status, 200);
    assert.equal(res._body.status, 'ok');
    assert.equal(res._body.onboarding.state, 'ready_limited');
    assert.equal(res._body.onboarding.tier, 'tier_250');
    assert.equal(res._body.onboarding.test_delivery_confirmed_at, '2026-11-10T10:00:00.000Z');
    assert.equal(res._body.onboarding.templates[0].status, 'APPROVED');

    // Verify rate disclosure is honest and present
    assert.ok(res._body.rates, 'Must include rate disclosure');
    assert.ok(res._body.rates.provider_note.includes('Billed directly by Meta'), 'Must disclose Meta direct billing');
    assert.equal(res._body.rates.marketing.total_inr, 1.0185);
  });
});
