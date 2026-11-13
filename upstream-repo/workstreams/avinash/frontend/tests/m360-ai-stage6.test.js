'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

const {
  runChatToCampaignWorkflow,
  runSupervisorWorkflow
} = require('../lib/agents/supervisor');

const {
  executeTool
} = require('../lib/agents/tools');

const {
  resetBusForTests
} = require('../lib/agents/bus');

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
      authorization: 'Bearer mock-test-token-stage6',
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

test('Stage 6: Chat-to-Campaign End-to-End Routing & Zero Auto-Send Gates', async (t) => {
  const wsId = 'ws-chat-s6-' + Date.now();
  resetBusForTests();

  const origFetch = globalThis.fetch;

  t.after(() => {
    resetBusForTests();
    globalThis.fetch = origFetch;
  });

  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('/me/workspaces')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: wsId, role: 'platform_owner', is_active: true }]
      };
    }
    return origFetch(url, opts);
  };

  const existingCrmContacts = [
    { id: 'c1', name: 'Alok', phone: '+919876540001', consent_status: 'granted', whatsapp_opt_in_status: 'granted' },
    { id: 'c2', name: 'Preeti', phone: '+919876540002', consent_status: 'granted', whatsapp_opt_in_status: 'granted' },
    { id: 'c3', name: 'Unknown Lead', phone: '+919876540003', consent_status: 'unconsented' }
  ];

  await t.test('Instruction containing raw numbers/emails produces draft + real audience with 0 sends', async () => {
    // Instruction containing phone numbers and unverified leads
    const prompt = 'send a Diwali offer to 9876543210 and my opted-in Shree Heights leads on WhatsApp';

    const result = await runChatToCampaignWorkflow({
      workspaceId: wsId,
      prompt,
      businessProfile: { businessName: 'Shree Heights', hasModel: true },
      contacts: existingCrmContacts
    });

    assert.equal(result.success, true);
    assert.equal(result.channel, 'WhatsApp');
    assert.equal(result.status, 'awaiting_human_approval');
    assert.equal(result.sendsDispatched, 0, 'Must dispatch 0 sends from chat instruction');

    // Real audience summary: only c1 and c2 are eligible; raw numbers in prompt are NOT invented into audience
    assert.equal(result.audience.total, 3);
    assert.equal(result.audience.eligible_count, 2);
    assert.equal(result.audience.eligible_contacts.length, 2);

    // Draft is clearly marked as draft
    assert.equal(result.draft.is_draft, true);
    assert.equal(result.draft.channel, 'WhatsApp');
    assert.ok(result.draft.note.includes('APPROVED before sending'));

    // Transparent cost estimate
    assert.equal(result.cost_estimate.currency, 'INR');
    assert.equal(result.cost_estimate.matrix360_markup_inr, 0.0);
    assert.ok(result.cost_estimate.total_estimated_inr > 0);
  });

  await t.test('Chat-to-campaign HTTP endpoint routes through human review and refuses auto-dispatch', async () => {
    const { req, res } = createMockReqRes({
      method: 'POST',
      url: `/api/marketing?action=chat/campaign&workspace_id=${wsId}`,
      body: {
        workspace_id: wsId,
        instruction: 'send Diwali discount to verified leads via WhatsApp',
        business_profile: { businessName: 'Lakhotia Logistics', hasModel: true },
        contacts: existingCrmContacts
      }
    });

    await marketingHandler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.status, 'awaiting_human_approval');
    assert.equal(res._body.sendsDispatched, 0);
    assert.equal(res._body.channel, 'WhatsApp');
  });

  await t.test('The ONLY way a send happens is human approval yielding a server-verified approval ID', async () => {
    const corrId = 'corr-approval-gate-test';

    // 1. Without approvalId: halts at awaiting_human_approval, 0 sends
    const initialRun = await runSupervisorWorkflow({
      workspaceId: wsId,
      correlationId: corrId,
      prompt: 'Send update to clients',
      businessProfile: { businessName: 'Lakhotia Logistics', hasModel: true },
      contacts: existingCrmContacts,
      approvalId: null
    });

    assert.equal(initialRun.status, 'awaiting_human_approval');
    assert.equal(initialRun.sendsDispatched, 0);

    // 2. With invalid approvalId: refused
    const toolRefused = await executeTool('send_whatsapp_message', {
      recipients: ['919876540001']
    }, {
      approvalId: 'unverified_short'
    });
    assert.equal(toolRefused.status, 'blocked');
    assert.equal(toolRefused.code, 'HUMAN_APPROVAL_REQUIRED');

    // 3. With server-verified approval ID: dispatches
    const verifiedApprovalId = 'appr_srv_verified_20261110_token_ok';
    const approvedRun = await runSupervisorWorkflow({
      workspaceId: wsId,
      correlationId: corrId + '-approved',
      prompt: 'Send update to clients',
      businessProfile: { businessName: 'Lakhotia Logistics', hasModel: true },
      contacts: existingCrmContacts,
      approvalId: verifiedApprovalId
    });

    assert.equal(approvedRun.status, 'dispatched');
    assert.equal(approvedRun.sendsDispatched, 2, 'Sends only to the 2 eligible contacts');
  });
});
