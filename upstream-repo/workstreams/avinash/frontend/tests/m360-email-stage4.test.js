'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

const {
  saveEmailOnboardingRecord,
  clearEmailOnboardingStore,
  previewEmailBroadcast,
  recordEmailCampaignDeliveryEvent,
  getEmailCampaignResults
} = require('../lib/m360-email-onboarding');

const {
  recordConsent,
  recordSuppression,
  getSuppressions,
  resetConsentStoreForTests
} = require('../lib/m360-consent');

const marketingHandler = require('../api/marketing');

function createMockReqRes({ method = 'POST', url = '/api/marketing', headers = {}, body = null } = {}) {
  const parsedUrl = new URL(url, 'http://127.0.0.1');
  const query = Object.fromEntries(parsedUrl.searchParams);

  const req = {
    method,
    url,
    query,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer mock-test-token-stage4',
      ...headers
    },
    body,
    rawBody: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body || {}), 'utf8')
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

test('Stage 4: Email Broadcast Builder, Compliance Headers & Real Webhook Results', async (t) => {
  const wsId = 'ws-email-s4-' + Date.now();
  clearEmailOnboardingStore();
  resetConsentStoreForTests();

  t.after(() => {
    clearEmailOnboardingStore();
    resetConsentStoreForTests();
  });

  saveEmailOnboardingRecord(wsId, {
    sender_domain: 'lakhotia.example.com',
    from_address: 'announcements@lakhotia.example.com',
    from_name: 'Lakhotia Industrial Park',
    state: 'ready_limited',
    spf_ok: true,
    dkim_ok: true,
    dmarc_ok: true
  });

  // Setup contacts
  recordConsent(wsId, { contact_id: 'c1', channel: 'email', status: 'granted' });
  recordConsent(wsId, { contact_id: 'c2', channel: 'email', status: 'granted' });
  // c3 has no consent
  // c4 has consent but is suppressed
  recordConsent(wsId, { contact_id: 'c4', channel: 'email', status: 'granted' });
  recordSuppression(wsId, { channel: 'email', email: 'optout@example.com' });

  const contacts = [
    { id: 'c1', name: 'Alok', email: 'alok@example.com', tags: ['industrial', 'phase1'] },
    { id: 'c2', name: 'Preeti', email: 'preeti@example.com', tags: ['industrial'] },
    { id: 'c3', name: 'Rahul', email: 'rahul@example.com', tags: ['industrial'] }, // Missing consent
    { id: 'c4', name: 'Sneha', email: 'optout@example.com', tags: ['industrial'] }, // Suppressed
    { id: 'c5', name: 'Rohan', email: 'invalid_email', tags: ['industrial'] }       // Invalid email
  ];

  await t.test('Broadcast preview sends only to consented, non-suppressed contacts and shows excluded breakdown', () => {
    const preview = previewEmailBroadcast({
      workspaceId: wsId,
      templateSubject: 'Phase 2 Industrial Warehouse Bookings Open',
      templateBody: 'Secure prime warehousing plots with 24/7 power at NH-6.',
      tagFilter: 'industrial',
      contacts
    });

    assert.equal(preview.success, true);
    assert.equal(preview.audience.total, 5);
    assert.equal(preview.audience.eligible_count, 2, 'Only c1 and c2 are eligible');
    assert.equal(preview.audience.excluded_count, 3);
    assert.equal(preview.audience.excluded_breakdown.missing_consent, 1);
    assert.equal(preview.audience.excluded_breakdown.suppressed_or_opted_out, 1);
    assert.equal(preview.audience.excluded_breakdown.invalid_email, 1);

    // Unsubscribe headers & compliance footer
    assert.ok(preview.template.headers['List-Unsubscribe']);
    assert.equal(preview.template.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.ok(preview.template.sample_html.includes('Unsubscribe'));
    assert.ok(preview.template.sample_html.includes('Lakhotia Industrial Park'));
    assert.ok(preview.template.sample_html.includes('verified commercial communication'));

    // Rates preview
    assert.equal(preview.cost_estimate.currency, 'INR');
    assert.equal(preview.cost_estimate.recipient_count, 2);
    assert.equal(preview.cost_estimate.provider_base_rate_inr, 0.10);
    assert.equal(preview.cost_estimate.gst_pct, 18);
    assert.equal(preview.cost_estimate.provider_fee_per_message_inr, 0.118);
    assert.equal(preview.cost_estimate.matrix360_fee_per_message_inr, 0.0);
    assert.equal(preview.cost_estimate.total_estimated_cost_inr, 0.236);
  });

  await t.test('In team_test mode sends go only to allowlisted test recipients', () => {
    const preview = previewEmailBroadcast({
      workspaceId: wsId,
      templateSubject: 'Team Internal Test',
      templateBody: 'Testing internal dispatch.',
      contacts,
      mode: 'team_test',
      testRecipients: ['alok@example.com'] // Only Alok is on team test allowlist
    });

    assert.equal(preview.success, true);
    assert.equal(preview.audience.eligible_count, 1, 'Only Alok is eligible under team_test mode');
    assert.equal(preview.audience.eligible_contacts[0].email, 'alok@example.com');
    assert.equal(preview.audience.excluded_breakdown.mode_test_filtered, 1, 'Preeti was excluded by team_test filter');
  });

  await t.test('One-click unsubscribe endpoint suppresses address immediately', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=unsubscribe&workspace_id=${wsId}`,
      body: { email: 'alok@example.com', workspace_id: wsId }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.status, 'unsubscribed');

    const supps = getSuppressions(wsId);
    assert.ok(supps.some(s => s.value_normalized === 'alok@example.com'), 'Email must be in suppression list');
  });

  await t.test('Campaign results returns real events only, never fabricated metrics', () => {
    const corrId = 'corr-email-bc-01';

    // 1. Initial state has 0 metrics
    const initial = getEmailCampaignResults(wsId, corrId);
    assert.equal(initial.dispatched, 0);
    assert.equal(initial.delivered, 0);
    assert.equal(initial.opened, 0);
    assert.equal(initial.bounced, 0);
    assert.equal(initial.complained, 0);
    assert.equal(initial.events.length, 0);

    // 2. Real provider webhook events recorded
    recordEmailCampaignDeliveryEvent(wsId, corrId, {
      messageId: '<msg_1@brevo.com>',
      status: 'delivered',
      recipientEmail: 'preeti@example.com'
    });
    recordEmailCampaignDeliveryEvent(wsId, corrId, {
      messageId: '<msg_1@brevo.com>',
      status: 'opened',
      recipientEmail: 'preeti@example.com'
    });
    recordEmailCampaignDeliveryEvent(wsId, corrId, {
      messageId: '<msg_2@brevo.com>',
      status: 'hard_bounce',
      recipientEmail: 'bad_address@example.com'
    });

    const results = getEmailCampaignResults(wsId, corrId);
    assert.equal(results.delivered, 1);
    assert.equal(results.opened, 1);
    assert.equal(results.bounced, 1);
    assert.equal(results.events.length, 3);
  });
});
