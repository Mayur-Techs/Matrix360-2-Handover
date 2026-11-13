'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.BREVO_WEBHOOK_SECRET = 'brevo-webhook-secret-s3';

const {
  getEmailOnboardingRecord,
  saveEmailOnboardingRecord,
  clearEmailOnboardingStore,
  transitionEmailOnboarding
} = require('../lib/m360-email-onboarding');

const {
  getSuppressions,
  resetConsentStoreForTests
} = require('../lib/m360-consent');

const {
  resetComplianceStateForTests
} = require('../lib/m360-email-compliance');

const marketingHandler = require('../api/marketing');

function createMockReqRes({ method = 'POST', url = '/api/marketing?action=webhooks/brevo', headers = {}, body = null, rawBody = null } = {}) {
  const req = {
    method,
    url,
    headers: {
      'content-type': 'application/json',
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

test('Stage 3: Bounce & Complaint Handling, Signed Raw Webhooks & Confirmed-Delivery Gate', async (t) => {
  const wsId = 'ws-email-s3-' + Date.now();
  clearEmailOnboardingStore();
  resetConsentStoreForTests();
  resetComplianceStateForTests();

  t.after(() => {
    clearEmailOnboardingStore();
    resetConsentStoreForTests();
    resetComplianceStateForTests();
  });

  const webhookSecret = process.env.BREVO_WEBHOOK_SECRET;

  await t.test('Signed raw webhook verifies and rejects invalid signatures', async () => {
    const payload = {
      event: 'delivered',
      'message-id': '<msg_test_01@brevo.com>',
      email: 'owner@example.com',
      workspace_id: wsId
    };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');

    // Invalid signature -> 401
    const { req: badReq, res: badRes } = createMockReqRes({
      headers: { 'x-sib-signature': 'sha256=invalidhex00000000000000000000000000000000000000000000000000000000' },
      body: payload,
      rawBody: raw
    });
    await marketingHandler(badReq, badRes);
    assert.equal(badRes._status, 401, 'Invalid signature must return 401');

    // Valid signature -> 200 or 202
    const validSig = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');
    const { req: goodReq, res: goodRes } = createMockReqRes({
      headers: { 'x-sib-signature': validSig },
      body: payload,
      rawBody: raw
    });
    await marketingHandler(goodReq, goodRes);
    assert.ok([200, 202].includes(goodRes._status), 'Valid signature must be accepted');
  });

  await t.test('Hard bounce webhook writes suppression row immediately', async () => {
    const payload = {
      event: 'hard_bounce',
      email: 'bounced_user@example.com',
      workspace_id: wsId
    };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');

    const { req, res } = createMockReqRes({
      headers: { 'x-sib-signature': sig },
      body: payload,
      rawBody: raw
    });
    await marketingHandler(req, res);

    const supps = getSuppressions(wsId);
    assert.ok(supps.some(s => s.value_normalized === 'bounced_user@example.com'), 'Bounced email must be immediately suppressed');
  });

  await t.test('Spam complaint webhook writes suppression row immediately', async () => {
    const payload = {
      event: 'complaint',
      email: 'complaining_user@example.com',
      workspace_id: wsId
    };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');

    const { req, res } = createMockReqRes({
      headers: { 'x-sib-signature': sig },
      body: payload,
      rawBody: raw
    });
    await marketingHandler(req, res);

    const supps = getSuppressions(wsId);
    assert.ok(supps.some(s => s.value_normalized === 'complaining_user@example.com'), 'Complaining email must be immediately suppressed');
  });

  await t.test('Soft bounce suppresses after 3 occurrences', async () => {
    const targetEmail = 'soft_bounce_user@example.com';
    const payload = {
      event: 'soft_bounce',
      email: targetEmail,
      workspace_id: wsId
    };
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');

    // Occurrence 1: recorded, not suppressed
    const mock1 = createMockReqRes({ headers: { 'x-sib-signature': sig }, body: payload, rawBody: raw });
    await marketingHandler(mock1.req, mock1.res);
    assert.equal(getSuppressions(wsId).some(s => s.value_normalized === targetEmail), false, 'Not suppressed after 1 soft bounce');

    // Occurrence 2: recorded, not suppressed
    const mock2 = createMockReqRes({ headers: { 'x-sib-signature': sig }, body: payload, rawBody: raw });
    await marketingHandler(mock2.req, mock2.res);
    assert.equal(getSuppressions(wsId).some(s => s.value_normalized === targetEmail), false, 'Not suppressed after 2 soft bounces');

    // Occurrence 3: suppressed!
    const mock3 = createMockReqRes({ headers: { 'x-sib-signature': sig }, body: payload, rawBody: raw });
    await marketingHandler(mock3.req, mock3.res);
    assert.equal(getSuppressions(wsId).some(s => s.value_normalized === targetEmail), true, 'Suppressed after 3 soft bounces');
  });

  await t.test('Confirmed-delivery gate: state reaches ready_limited ONLY on matching webhook callback', async () => {
    saveEmailOnboardingRecord(wsId, {
      sender_domain: 'lakhotia.example.com',
      from_address: 'info@lakhotia.example.com',
      spf_ok: true,
      dkim_ok: true,
      dmarc_ok: true,
      state: 'dns_verifying',
      test_message_id: 'test_msg_998877'
    });

    // 1. Initial state has no confirmed delivery
    let rec = getEmailOnboardingRecord(wsId);
    assert.equal(rec.state, 'dns_verifying');
    assert.equal(rec.test_delivery_confirmed_at, null);

    // 2. Webhook for unrelated message does NOT flip state
    const unrelPayload = {
      event: 'delivered',
      'message-id': 'unrelated_other_message',
      email: 'owner@lakhotia.example.com',
      workspace_id: wsId
    };
    const unrelRaw = Buffer.from(JSON.stringify(unrelPayload), 'utf8');
    const unrelSig = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(unrelRaw).digest('hex');
    const mockUnrel = createMockReqRes({ headers: { 'x-sib-signature': unrelSig }, body: unrelPayload, rawBody: unrelRaw });
    await marketingHandler(mockUnrel.req, mockUnrel.res);

    rec = getEmailOnboardingRecord(wsId);
    assert.equal(rec.state, 'dns_verifying', 'Must remain dns_verifying for unrelated message');
    assert.equal(rec.test_delivery_confirmed_at, null);

    // 3. Webhook for EXACT test message ID flips state to ready_limited
    const matchPayload = {
      event: 'delivered',
      'message-id': 'test_msg_998877',
      email: 'owner@lakhotia.example.com',
      workspace_id: wsId
    };
    const matchRaw = Buffer.from(JSON.stringify(matchPayload), 'utf8');
    const matchSig = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(matchRaw).digest('hex');
    const mockMatch = createMockReqRes({ headers: { 'x-sib-signature': matchSig }, body: matchPayload, rawBody: matchRaw });
    await marketingHandler(mockMatch.req, mockMatch.res);

    rec = getEmailOnboardingRecord(wsId);
    assert.equal(rec.state, 'ready_limited', 'State must advance to ready_limited upon confirmed delivery');
    assert.ok(rec.test_delivery_confirmed_at, 'Delivery confirmed timestamp must be set');
  });
});
