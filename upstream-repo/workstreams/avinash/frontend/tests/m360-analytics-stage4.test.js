'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  renderDashboardHtml,
  generateClientSafeCsv
} = require('../lib/m360-dashboard-render');

const {
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

function createMockReqRes({ method = 'GET', url = '/api/marketing', workspaceId = 'ws-dashboard-test', query = {}, body = {}, role = 'client_admin' } = {}) {
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
  const responseHeaders = {};

  const res = {
    get statusCode() { return statusCode; },
    set statusCode(code) { statusCode = code; },
    setHeader(name, val) { responseHeaders[name.toLowerCase()] = val; },
    getHeader(name) { return responseHeaders[name.toLowerCase()]; },
    writeHead(code) { statusCode = code; return res; },
    write(chunk) { responseData += chunk ? chunk.toString() : ''; return true; },
    end(chunk) {
      if (chunk) responseData += chunk.toString();
      return res;
    },
    get _body() {
      try { return JSON.parse(responseData); } catch { return responseData; }
    },
    get _raw() { return responseData; },
    get _status() { return statusCode; },
    get _headers() { return responseHeaders; }
  };

  return { req, res };
}

test('Stage 4: Owner Analytics Dashboard UI & Client-Safe Export', async (t) => {
  const origFetch = global.fetch;

  t.beforeEach(() => {
    process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    clearWhatsAppCampaignResultsStore();
    clearEmailCampaignResultsStore();
    resetOutboxStoreForTests();

    global.fetch = async (url, opts = {}) => {
      return {
        status: 200,
        ok: true,
        json: async () => [{ id: 'ws-dashboard-test', role: 'client_admin' }]
      };
    };
  });

  t.afterEach(() => {
    global.fetch = origFetch;
  });

  await t.test('Honest Zero Empty State: Produces clean empty state when 0 events exist', async () => {
    const wsId = 'ws-empty-' + randomUUID();
    const analytics = await getWorkspaceAnalytics(wsId);
    const html = renderDashboardHtml(analytics);

    assert.ok(html.includes('id="analytics-empty-state"'), 'Must render empty state container');
    assert.ok(
      html.includes('No campaigns sent yet. Metrics will appear after your first dispatch.'),
      'Must contain exact reassuring empty state copy'
    );
    assert.ok(!html.includes('<tr>'), 'Must not render table rows on 0 events');
    assert.ok(!html.includes('NaN'), 'Must not produce NaN in output');
  });

  await t.test('Dashboard Markup: Renders live metrics, spend split, and health indicators correctly', async () => {
    const wsId = 'ws-dashboard-test';
    const campId = 'camp-q4-outreach';

    // Dispatched events
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'wa1', status: 'sent' });
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'wa1', status: 'delivered' });
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'wa1', status: 'read' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'em1', status: 'sent' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'em1', status: 'delivered' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'em1', status: 'opened' });

    const analytics = await getWorkspaceAnalytics(wsId);
    const html = renderDashboardHtml(analytics);

    // Spend breakdown
    assert.ok(html.includes('Cross-Channel Spend Breakdown'));
    assert.ok(html.includes('Meta WhatsApp Cost'));
    assert.ok(html.includes('Brevo Email Cost'));
    assert.ok(html.includes('Matrix360 Platform Fee'));
    assert.ok(html.includes('Transparent 0% markup'));

    // Health panel
    assert.ok(html.includes('Deliverability Health'));
    assert.ok(html.includes('Email Bounce Rate'));
    assert.ok(html.includes('Spam Complaint Rate'));
    assert.ok(html.includes('WhatsApp Opt-Out Rate'));

    // Channel telemetry
    assert.ok(html.includes('WhatsApp Telemetry'));
    assert.ok(html.includes('Email Telemetry'));
    assert.ok(html.includes('camp-q4-outreach'));
  });

  await t.test('Client-Safe Export: CSV includes only business metrics, never internal IDs or tokens', async () => {
    const wsId = 'ws-dashboard-test';
    const campId = 'camp-q4-outreach';

    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'wa1', status: 'sent' });
    recordWhatsAppCampaignDeliveryEvent(wsId, campId, { messageId: 'wa1', status: 'delivered' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'em1', status: 'sent' });
    recordEmailCampaignDeliveryEvent(wsId, campId, { messageId: 'em1', status: 'delivered' });

    const analytics = await getWorkspaceAnalytics(wsId);
    const csv = generateClientSafeCsv(analytics);

    // Verify header line
    assert.ok(csv.includes('"Campaign Name","Channel","Dispatched","Delivered"'));

    // Verify Forbidden internal fields are NOT present in CSV
    assert.ok(!csv.includes('internal_id'), 'No internal_id');
    assert.ok(!csv.includes('token-'), 'No tokens');
    assert.ok(!csv.includes('Bearer'), 'No bearer tokens');
    assert.ok(!csv.includes('system_user_token'), 'No system user tokens');
    assert.ok(!csv.includes('app_secret'), 'No app secrets');

    // Verify API export endpoint
    const mockCall = createMockReqRes({
      workspaceId: wsId,
      query: { action: 'analytics_export_csv' }
    });
    await marketingHandler(mockCall.req, mockCall.res);

    assert.equal(mockCall.res._status, 200);
    assert.ok(mockCall.res.getHeader('content-type')?.includes('text/csv'));
    assert.ok(mockCall.res._raw.includes('Campaign Name'));
  });
});
