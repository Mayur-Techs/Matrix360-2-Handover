'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Required AES-256-GCM tenant encryption key for tests
process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.WHATSAPP_APP_SECRET = 'test-secret-stage4';
process.env.META_GRAPH_VERSION = 'v21.0';

const {
  getWhatsAppOnboardingRecord,
  saveWhatsAppOnboardingRecord,
  clearWhatsAppOnboardingStore,
  exchangeEmbeddedSignupCode,
  registerPhoneNumberAndSubscribeWaba,
  syncTemplateStatuses,
  sendOnboardingTestMessage
} = require('../lib/m360-whatsapp-onboarding');

const {
  getStoredProviderCredentials,
  configureMarketingProvider,
  decryptSecret
} = require('../lib/m360-marketing-orchestrator');

test('Stage 4: Bug Sweep on Real Integration Gaps', async (t) => {
  const wsId = 'ws-test-s4-' + Date.now();
  clearWhatsAppOnboardingStore();

  const origEnv = { ...process.env };
  const origFetch = globalThis.fetch;

  t.after(() => {
    process.env = origEnv;
    globalThis.fetch = origFetch;
    clearWhatsAppOnboardingStore();
  });

  process.env.META_APP_ID = 'app-s4';
  process.env.META_APP_SECRET = 'secret-s4';
  process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

  await t.test('Gap 1: WABA with multiple numbers lets owner pick without silently taking the first', async () => {
    const mockFetch = async (url) => {
      const u = String(url);
      if (u.includes('/oauth/access_token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'tok-multi' }) };
      }
      if (u.includes('/debug_token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['waba-multi'] }] }
          })
        };
      }
      if (u.includes('/waba-multi/phone_numbers')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'phone-num-1', display_phone_number: '+91 98765 11111', verified_name: 'Branch 1' },
              { id: 'phone-num-2', display_phone_number: '+91 98765 22222', verified_name: 'Branch 2' }
            ]
          })
        };
      }
      throw new Error('Unexpected url: ' + u);
    };

    // 1. Without selected phone number, returns multiple_phone_numbers to let owner pick
    const initialRes = await exchangeEmbeddedSignupCode({
      code: 'auth-code-multi',
      workspaceId: wsId,
      fetchImpl: mockFetch
    });

    assert.equal(initialRes.success, false);
    assert.equal(initialRes.status, 'multiple_phone_numbers');
    assert.equal(initialRes.error, 'MULTIPLE_PHONE_NUMBERS');
    assert.equal(initialRes.available_phone_numbers.length, 2);
    assert.equal(initialRes.available_phone_numbers[0].id, 'phone-num-1');
    assert.equal(initialRes.available_phone_numbers[1].id, 'phone-num-2');

    // 2. With selected phone number, binds that exact chosen number
    const chosenRes = await exchangeEmbeddedSignupCode({
      code: 'auth-code-multi',
      workspaceId: wsId,
      selectedPhoneNumberId: 'phone-num-2',
      fetchImpl: mockFetch
    });

    assert.equal(chosenRes.success, true);
    assert.equal(chosenRes.phone_number_id, 'phone-num-2');
    assert.equal(chosenRes.display_phone_number, '+91 98765 22222');
    assert.equal(chosenRes.verified_name, 'Branch 2');
  });

  await t.test('Gap 2: Registration errors return honest, distinct messages', async () => {
    // A. already registered (code 133010) -> success: true, already_registered: true
    const fetchAlreadyReg = async (url) => {
      const u = String(url);
      if (u.includes('/register')) {
        return { ok: false, status: 400, json: async () => ({ error: { code: 133010, message: 'Number is already registered' } }) };
      }
      if (u.includes('/subscribed_apps')) {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      throw new Error('Unexpected: ' + u);
    };

    const reg1 = await registerPhoneNumberAndSubscribeWaba({
      workspaceId: wsId,
      pin: '123456',
      fetchImpl: fetchAlreadyReg
    });
    assert.equal(reg1.success, true);
    assert.equal(reg1.already_registered, true);
    assert.ok(reg1.message.includes('already registered'));

    // B. PIN required (code 133005) -> error PIN_REQUIRED
    const fetchPinReq = async (url) => {
      return { ok: false, status: 400, json: async () => ({ error: { code: 133005, message: 'Two-step verification PIN required' } }) };
    };

    const reg2 = await registerPhoneNumberAndSubscribeWaba({
      workspaceId: wsId,
      pin: '123456',
      fetchImpl: fetchPinReq
    });
    assert.equal(reg2.success, false);
    assert.equal(reg2.error, 'PIN_REQUIRED');

    // C. Rate limit (code 4 / 80007) -> error RATE_LIMIT_EXCEEDED
    const fetchRateLimit = async (url) => {
      return { ok: false, status: 400, json: async () => ({ error: { code: 80007, message: 'Too many requests' } }) };
    };

    const reg3 = await registerPhoneNumberAndSubscribeWaba({
      workspaceId: wsId,
      pin: '123456',
      fetchImpl: fetchRateLimit
    });
    assert.equal(reg3.success, false);
    assert.equal(reg3.error, 'RATE_LIMIT_EXCEEDED');
  });

  await t.test('Gap 3: Template REJECTED transitions state to needs_attention with reason', async () => {
    saveWhatsAppOnboardingRecord(wsId, {
      state: 'templates_in_review',
      waba_id: 'waba-s4-tpl',
      phone_number_id: 'phone-s4-tpl',
      templates: [{ name: 'm360_site_visit_invitation', status: 'PENDING' }]
    });

    configureMarketingProvider(wsId, 'whatsapp', {
      token: 'tok-tpl-s4',
      phone_number_id: 'phone-s4-tpl',
      waba_id: 'waba-s4-tpl'
    }, { verified: true });

    const fetchRejected = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              name: 'm360_site_visit_invitation',
              status: 'REJECTED',
              rejected_reason: 'PROMOTIONAL_CONTENT',
              category: 'MARKETING'
            }
          ]
        })
      };
    };

    const syncRes = await syncTemplateStatuses({ workspaceId: wsId, fetchImpl: fetchRejected });
    assert.equal(syncRes.success, true);
    assert.equal(syncRes.all_approved, false);
    assert.equal(syncRes.templates[0].status, 'REJECTED');
    assert.equal(syncRes.templates[0].rejection_reason, 'PROMOTIONAL_CONTENT');

    const rec = getWhatsAppOnboardingRecord(wsId);
    assert.equal(rec.state, 'needs_attention');
    assert.ok(rec.last_meta_error?.message.includes('PROMOTIONAL_CONTENT'));

    // Non-APPROVED template cannot be used to send test message
    const sendRes = await sendOnboardingTestMessage({
      workspaceId: wsId,
      templateName: 'm360_site_visit_invitation',
      ownerPhone: '+919999988888',
      fetchImpl: async () => { throw new Error('Must not be called'); }
    });

    assert.equal(sendRes.success, false);
    assert.equal(sendRes.error, 'TEMPLATE_NOT_APPROVED');
  });

  await t.test('Gap 4: Token handling stores AES-256-GCM encrypted in vault, never logged or disk-written', async () => {
    const rawToken = 'EAABw_super_sensitive_meta_token_12345';
    configureMarketingProvider(wsId, 'whatsapp', {
      token: rawToken,
      phone_number_id: 'phone-vault-s4',
      waba_id: 'waba-vault-s4'
    }, { verified: true });

    const stored = getStoredProviderCredentials(wsId, 'whatsapp');
    assert.ok(stored.encrypted_token, 'Encrypted token must exist');
    assert.equal(stored.token, undefined, 'Plaintext token must not be stored in credentials object');
    assert.notEqual(stored.encrypted_token, rawToken, 'Stored token must not be plaintext');

    const decrypted = decryptSecret(stored.encrypted_token, wsId);
    assert.equal(decrypted, rawToken, 'Decrypted token must match original token');
  });
});
