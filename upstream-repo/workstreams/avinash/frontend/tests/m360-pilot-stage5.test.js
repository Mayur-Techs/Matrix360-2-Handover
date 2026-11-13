'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const {
  MAX_PILOT_AUDIENCE_SIZE,
  resetPilotStateForTests,
  getPilotConnectionStatus,
  importPilotAudience,
  draftPilotCampaign,
  approvePilotDraft,
  dispatchPilotCampaign
} = require('../lib/m360-pilot');

const {
  getWorkspaceAnalytics
} = require('../lib/m360-analytics');

const { resetOutboxStoreForTests } = require('../lib/m360-outbox-worker');
const marketingHandler = require('../api/marketing');

function createMockReqRes({ method = 'GET', url = '/api/marketing', workspaceId = 'ws-pilot-test', query = {}, body = {}, role = 'client_admin' } = {}) {
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
    get _status() { return statusCode; },
    get _headers() { return responseHeaders; }
  };

  return { req, res };
}

test('Stage 5: Guided One-Client Pilot Flow', async (t) => {
  const origFetch = global.fetch;

  t.beforeEach(() => {
    process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    resetPilotStateForTests();
    resetOutboxStoreForTests();

    global.fetch = async (url, opts = {}) => {
      return {
        status: 200,
        ok: true,
        json: async () => [{ id: 'ws-pilot-test', role: 'client_admin' }]
      };
    };
  });

  t.afterEach(() => {
    global.fetch = origFetch;
  });

  await t.test('End-to-End Pilot Run: Steps 1 through 6 in team_test mode updates dashboard with real dispatched count', async () => {
    const wsId = 'ws-pilot-test';
    const campId = 'camp-pilot-e2e-1';

    // Step 1: Connectivity check
    const step1Call = createMockReqRes({
      workspaceId: wsId,
      query: { action: 'pilot/status' }
    });
    await marketingHandler(step1Call.req, step1Call.res);
    assert.equal(step1Call.res._status, 200);
    assert.ok(step1Call.res._body?.channels);

    // Step 2: Audience import (3 test contacts <= 20 cap)
    const contacts = [
      { name: 'Lead 1', phone: '+919876543201', email: 'test1@matrix360.example' },
      { name: 'Lead 2', phone: '+919876543202', email: 'test2@matrix360.example' },
      { name: 'Lead 3', phone: '+919876543203', email: 'test3@matrix360.example' }
    ];

    const step2Call = createMockReqRes({
      method: 'POST',
      workspaceId: wsId,
      query: { action: 'pilot/audience' },
      body: { campaign_id: campId, contacts }
    });
    await marketingHandler(step2Call.req, step2Call.res);
    assert.equal(step2Call.res._status, 200);
    assert.equal(step2Call.res._body?.eligible_count, 3);
    assert.equal(step2Call.res._body?.cap_enforced, true);

    // Step 3: Campaign drafting
    const step3Call = createMockReqRes({
      method: 'POST',
      workspaceId: wsId,
      query: { action: 'pilot/draft' },
      body: {
        campaign_id: campId,
        channel: 'WhatsApp',
        template_name: 'marketing_starter_v1'
      }
    });
    await marketingHandler(step3Call.req, step3Call.res);
    assert.equal(step3Call.res._status, 200);
    const versionHash = step3Call.res._body?.draft?.version_hash;
    assert.ok(versionHash?.startsWith('draft_'));

    // Step 4: Human Approval Gate
    const step4Call = createMockReqRes({
      method: 'POST',
      workspaceId: wsId,
      query: { action: 'pilot/approve' },
      body: { campaign_id: campId, version_hash: versionHash }
    });
    await marketingHandler(step4Call.req, step4Call.res);
    assert.equal(step4Call.res._status, 200);
    const approvalId = step4Call.res._body?.approval_id;
    assert.ok(approvalId?.startsWith('appr_'));

    // Step 5 & 6: Dispatch pilot in team_test mode with mock WhatsApp adapter
    const mockWhatsAppAdapter = {
      execute: async (payload, { mode }) => {
        assert.equal(mode, 'team_test');
        return { provider_message_id: 'wam_' + randomUUID() };
      }
    };

    // Dispatch directly using pilot runner (with mock adapter injected)
    const dispatchResult = await dispatchPilotCampaign({
      workspaceId: wsId,
      campaignId: campId,
      approvalId,
      mode: 'team_test',
      testRecipients: ['+919876543201', '+919876543202', '+919876543203'],
      whatsAppAdapter: mockWhatsAppAdapter
    });

    assert.equal(dispatchResult.success, true);
    assert.equal(dispatchResult.dispatched_count, 3);
    assert.equal(dispatchResult.failed_count, 0);

    // Verify Stage 3 & 4 Analytics reflects exactly the real 3 dispatches
    const analytics = await getWorkspaceAnalytics(wsId);
    assert.equal(analytics.overview.channels.whatsapp.sent, 3);
    assert.equal(analytics.overview.total_messages_sent, 3);
    assert.equal(analytics.has_activity, true);
    assert.ok(analytics.overview.spend.total_spend > 0);
  });

  await t.test('Security Gate: Skipping human approval strictly blocks dispatch', async () => {
    const wsId = 'ws-pilot-test';
    const campId = 'camp-unapproved';

    await importPilotAudience({
      workspaceId: wsId,
      campaignId: campId,
      contacts: [{ name: 'Lead 1', phone: '+919876543210' }]
    });

    await draftPilotCampaign({
      workspaceId: wsId,
      campaignId: campId,
      channel: 'WhatsApp'
    });

    // Attempt dispatch via API WITHOUT approval_id
    const unapprovedCall = createMockReqRes({
      method: 'POST',
      workspaceId: wsId,
      query: { action: 'pilot/dispatch' },
      body: { campaign_id: campId, approval_id: '' }
    });
    await marketingHandler(unapprovedCall.req, unapprovedCall.res);

    assert.equal(unapprovedCall.res._status, 403, 'Must return 403 when approval is skipped');
    assert.ok(unapprovedCall.res._body?.error?.includes('Human approval is mandatory'));

    // Attempt dispatch via API with fabricated/invalid approval_id
    const fakeApprovalCall = createMockReqRes({
      method: 'POST',
      workspaceId: wsId,
      query: { action: 'pilot/dispatch' },
      body: { campaign_id: campId, approval_id: 'appr_fake123456789' }
    });
    await marketingHandler(fakeApprovalCall.req, fakeApprovalCall.res);
    assert.equal(fakeApprovalCall.res._status, 403);
  });

  await t.test('Audience Cap: Strictly enforces maximum 20 recipients', async () => {
    const wsId = 'ws-pilot-test';
    const campId = 'camp-cap-test';

    // Generate 21 contacts (> 20 cap)
    const contacts21 = [];
    for (let i = 1; i <= 21; i++) {
      contacts21.push({ name: `Lead ${i}`, phone: `+9198765432${i < 10 ? '0' + i : i}` });
    }

    const overCapCall = createMockReqRes({
      method: 'POST',
      workspaceId: wsId,
      query: { action: 'pilot/audience' },
      body: { campaign_id: campId, contacts: contacts21 }
    });
    await marketingHandler(overCapCall.req, overCapCall.res);

    assert.equal(overCapCall.res._status, 400);
    assert.ok(overCapCall.res._body?.error?.includes('exceeds maximum limit of 20'));
  });

  await t.test('Live Mode Switch: Rejects live mode without M360_MARKETING_MODE=live and confirmation', async () => {
    const wsId = 'ws-pilot-test';
    const campId = 'camp-live-test';

    delete process.env.M360_MARKETING_MODE;

    await importPilotAudience({
      workspaceId: wsId,
      campaignId: campId,
      contacts: [{ name: 'Lead 1', phone: '+919876543210' }]
    });

    const draft = await draftPilotCampaign({ workspaceId: wsId, campaignId: campId, channel: 'WhatsApp' });
    const approval = await approvePilotDraft({ workspaceId: wsId, campaignId: campId, versionHash: draft.draft.version_hash });

    // Attempt live dispatch when M360_MARKETING_MODE is unset
    await assert.rejects(
      async () => {
        await dispatchPilotCampaign({
          workspaceId: wsId,
          campaignId: campId,
          approvalId: approval.approval_id,
          mode: 'live',
          clientConfirmed: true
        });
      },
      /Live dispatch blocked: M360_MARKETING_MODE is not configured to live/
    );

    // Set M360_MARKETING_MODE=live but clientConfirmed=false
    process.env.M360_MARKETING_MODE = 'live';
    try {
      await assert.rejects(
        async () => {
          await dispatchPilotCampaign({
            workspaceId: wsId,
            campaignId: campId,
            approvalId: approval.approval_id,
            mode: 'live',
            clientConfirmed: false
          });
        },
        /Live dispatch requires explicit client confirmation/
      );
    } finally {
      delete process.env.M360_MARKETING_MODE;
    }
  });
});
