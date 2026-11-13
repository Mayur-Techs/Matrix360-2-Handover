'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  calculateSpend,
  evaluateDeliveryHealth,
  getCampaignAnalytics,
  getWorkspaceAnalytics
} = require('../lib/m360-analytics');

const {
  recordWhatsAppCampaignDeliveryEvent,
  clearWhatsAppCampaignResultsStore
} = require('../lib/m360-whatsapp-onboarding');

const {
  recordEmailCampaignDeliveryEvent,
  clearEmailCampaignResultsStore
} = require('../lib/m360-email-onboarding');

const { resetOutboxStoreForTests } = require('../lib/m360-outbox-worker');
const marketingHandler = require('../api/marketing');

function createMockReqRes({ method = 'GET', url = '/api/marketing', workspaceId = 'ws-analytics-test', query = {}, body = {}, role = 'client_admin' } = {}) {
  const token = `token-${role}-${randomUUID()}`;
  const req = {
    method,
    url,
    query: { workspace_id: workspaceId, ...query },
    headers: {
      authorization: `Bearer ${token}`,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: { workspace_id: workspaceId, ...body }
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

test('Stage 3: Cross-Channel Analytics Data Layer', async (t) => {
  const origFetch = global.fetch;

  t.beforeEach(() => {
    process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    clearWhatsAppCampaignResultsStore();
    clearEmailCampaignResultsStore();
    resetOutboxStoreForTests();

    global.fetch = async (url, opts = {}) => {
      const auth = String(opts.headers?.Authorization || opts.headers?.authorization || '');
      // Workspace A token grants ws-analytics-test, Workspace B token grants ws-tenant-b
      if (auth.includes('ws-tenant-b')) {
        return {
          status: 200,
          ok: true,
          json: async () => [{ id: 'ws-tenant-b', role: 'client_admin' }]
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => [{ id: 'ws-analytics-test', role: 'client_admin' }]
      };
    };
  });

  t.afterEach(() => {
    global.fetch = origFetch;
  });

  await t.test('Honest Zero Baseline: Empty workspace returns zeros for all metrics and spend without fabrication', async () => {
    const wsId = 'ws-empty-' + randomUUID();
    const analytics = await getWorkspaceAnalytics(wsId);

    assert.equal(analytics.workspace_id, wsId);
    assert.equal(analytics.campaign_count, 0);
    assert.equal(analytics.has_activity, false);
    assert.equal(analytics.overview.total_messages_sent, 0);

    // WhatsApp honest zeros
    assert.deepEqual(analytics.overview.channels.whatsapp, {
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
      opted_out: 0
    });

    // Email honest zeros
    assert.deepEqual(analytics.overview.channels.email, {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      complained: 0,
      unsubscribed: 0
    });

    // Spend honest zeros
    assert.equal(analytics.overview.spend.total_spend, 0);
    assert.equal(analytics.overview.spend.total_provider_cost, 0);
    assert.equal(analytics.overview.spend.matrix360_platform_fee, 0);
    assert.equal(analytics.overview.spend.currency, 'INR');

    // Health honest zero
    assert.equal(analytics.overview.delivery_health.status, 'HEALTHY');
    assert.equal(analytics.overview.delivery_health.warnings.length, 0);
  });

  await t.test('Synthetic Event Log: Formula verification across WhatsApp and Email metrics', async () => {
    const wsId = 'ws-analytics-test';
    const campId = 'camp-synth-1';

    // 1. WhatsApp synthetic events
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'm1', status: 'sent' });
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'm1', status: 'delivered' });
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'm1', status: 'read' });
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'm1', status: 'replied' });
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'm2', status: 'sent' });
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'm2', status: 'failed' });
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'm3', status: 'sent' });
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'm3', status: 'opted_out' });

    // 2. Email synthetic events
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'e1', status: 'sent' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'e1', status: 'delivered' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'e1', status: 'opened' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'e1', status: 'clicked' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'e2', status: 'sent' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'e2', status: 'bounce' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'e3', status: 'sent' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'e3', status: 'complaint' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'e4', status: 'sent' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'e4', status: 'unsubscribed' });

    const campAnalytics = await getCampaignAnalytics(wsId, campId);
    assert.ok(campAnalytics);

    // Verify WhatsApp counts
    assert.equal(campAnalytics.channels.whatsapp.sent, 3);
    assert.equal(campAnalytics.channels.whatsapp.delivered, 1);
    assert.equal(campAnalytics.channels.whatsapp.read, 1);
    assert.equal(campAnalytics.channels.whatsapp.replied, 1);
    assert.equal(campAnalytics.channels.whatsapp.failed, 1);
    assert.equal(campAnalytics.channels.whatsapp.opted_out, 1);

    // Verify Email counts
    assert.equal(campAnalytics.channels.email.sent, 4);
    assert.equal(campAnalytics.channels.email.delivered, 1);
    assert.equal(campAnalytics.channels.email.opened, 1);
    assert.equal(campAnalytics.channels.email.clicked, 1);
    assert.equal(campAnalytics.channels.email.bounced, 1);
    assert.equal(campAnalytics.channels.email.complained, 1);
    assert.equal(campAnalytics.channels.email.unsubscribed, 1);

    // Verify Spend calculation
    // WhatsApp: 3 * 0.8631 * 1.18 = 3.0554
    // Email: 4 * 0.01 * 1.18 = 0.0472
    // Total provider: 3.1026
    const expectedWaCost = Number((3 * 0.8631 * 1.18).toFixed(4));
    const expectedEmCost = Number((4 * 0.01 * 1.18).toFixed(4));
    const expectedProviderTotal = Number((expectedWaCost + expectedEmCost).toFixed(4));

    assert.equal(campAnalytics.spend.whatsapp_provider_cost, expectedWaCost);
    assert.equal(campAnalytics.spend.email_provider_cost, expectedEmCost);
    assert.equal(campAnalytics.spend.total_provider_cost, expectedProviderTotal);
    assert.equal(campAnalytics.spend.matrix360_platform_fee, 0);
    assert.equal(campAnalytics.spend.total_spend, expectedProviderTotal);
  });

  await t.test('Delivery Health: Safety thresholds trigger WARNING when exceeded', () => {
    // 1. Healthy below thresholds
    const healthy = evaluateDeliveryHealth({
      emailSent: 100,
      emailBounced: 2, // 2% <= 5%
      emailComplained: 0,
      whatsappSent: 100,
      whatsappOptedOut: 1 // 1% <= 3%
    });
    assert.equal(healthy.status, 'HEALTHY');
    assert.equal(healthy.warnings.length, 0);

    // 2. High Bounce Rate (> 5%)
    const highBounce = evaluateDeliveryHealth({
      emailSent: 100,
      emailBounced: 6 // 6% > 5%
    });
    assert.equal(highBounce.status, 'WARNING');
    assert.ok(highBounce.warnings.some(w => w.metric === 'email_bounce_rate'));

    // 3. High Spam Complaint Rate (> 0.1%)
    const highSpam = evaluateDeliveryHealth({
      emailSent: 1000,
      emailComplained: 2 // 0.2% > 0.1%
    });
    assert.equal(highSpam.status, 'WARNING');
    assert.ok(highSpam.warnings.some(w => w.metric === 'email_complaint_rate'));

    // 4. High WhatsApp Opt-out Rate (> 3%)
    const highOptOut = evaluateDeliveryHealth({
      whatsappSent: 100,
      whatsappOptedOut: 5 // 5% > 3%
    });
    assert.equal(highOptOut.status, 'WARNING');
    assert.ok(highOptOut.warnings.some(w => w.metric === 'whatsapp_opt_out_rate'));
  });

  await t.test('Workspace Isolation: Workspace A cannot query Workspace B metrics', async () => {
    const wsA = 'ws-analytics-test';
    const wsB = 'ws-tenant-b';
    const campB = 'camp-tenant-b-exclusive';

    // Seed events for Workspace B
    recordWhatsAppCampaignDeliveryEvent(wsB, campB, { messageId: 'wb1', status: 'sent' });
    recordWhatsAppCampaignDeliveryEvent(wsB, campB, { messageId: 'wb1', status: 'delivered' });

    // 1. Workspace A queries workspace overview: must NOT include Workspace B's data
    const wsAAnalytics = await getWorkspaceAnalytics(wsA);
    assert.equal(wsAAnalytics.overview.channels.whatsapp.sent, 0);
    assert.equal(wsAAnalytics.campaign_count, 0);

    // 2. Workspace A attempts to query Workspace B's campaign: returns null (not found in A)
    const crossQuery = await getCampaignAnalytics(wsA, campB);
    assert.equal(crossQuery, null, 'Campaign of Workspace B must not be accessible to Workspace A');

    // 3. Via Marketing API endpoint:
    // Workspace A member requests /api/marketing?action=analytics_campaign&campaign_id=camp-tenant-b-exclusive
    const mockCall = createMockReqRes({
      workspaceId: wsA,
      query: { action: 'analytics_campaign', campaign_id: campB }
    });
    await marketingHandler(mockCall.req, mockCall.res);
    assert.equal(mockCall.res._status, 404, 'Must return 404 when querying another tenant campaign');
  });
});
