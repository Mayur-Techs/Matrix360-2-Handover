'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

const test = require('node:test');
const assert = require('node:assert/strict');
const orchestrator = require('../lib/m360-marketing-orchestrator');
const marketingApi = require('../api/marketing');

const originalFetch = global.fetch;
const memberships = [
  { id: 'ws-prod-vault-test', name: 'Lakhotia Vault Test', role: 'client_admin', profile_type: 'b2b_industrial', project_slug: 'lakhotia' },
  { id: 'ws-persona-test', name: 'Persona Switch Test', role: 'client_admin', profile_type: 'b2b_industrial', project_slug: 'lakhotia' },
  { id: 'ws-team-test', name: 'Team Multi-Agent Test', role: 'client_admin', profile_type: 'b2c_affinity', project_slug: 'shree_heights' },
  { id: 'ws-leads-test', name: 'Lead Import Test', role: 'client_admin', profile_type: 'b2b_industrial', project_slug: 'lakhotia' }
];

function installCrmFetch(leads = []) {
  global.fetch = async url => {
    if (String(url).endsWith('/me/workspaces')) return { status: 200, ok: true, json: async () => memberships };
    if (String(url).includes('/workspaces/') && String(url).endsWith('/leads')) return { status: 200, ok: true, json: async () => leads };
    if (String(url).includes('graph.facebook.com')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          verified_name: 'Matrix360 Business',
          display_phone_number: '+91 98765 43210',
          quality_rating: 'GREEN',
          code_verification_status: 'VERIFIED'
        })
      };
    }
    return { status: 200, ok: true, json: async () => ({}) };
  };
}

function mockHttp(method, path, body = {}, auth = 'Bearer test-session-token-long-enough-123') {
  const parsedUrl = new URL(path, 'http://127.0.0.1');
  const query = Object.fromEntries(parsedUrl.searchParams);
  const req = {
    method,
    url: path,
    query,
    headers: { authorization: auth, 'content-type': 'application/json' },
    body
  };

  let resData = null;
  const res = {
    statusCode: 200,
    setHeader() {},
    end(data) {
      if (data) {
        try {
          resData = JSON.parse(data);
        } catch {
          resData = data;
        }
      }
    }
  };

  return { req, res, get: () => ({ status: res.statusCode, data: resData }) };
}

test.beforeEach(() => {
  orchestrator.resetTaskStoreForTests();
  process.env.M360_KEYLESS_TEST_MODE = 'true';
  installCrmFetch([]);
});

test.after(() => {
  global.fetch = originalFetch;
});

test('WhatsApp Meta Key Vault: Tenant-isolated AES-256-GCM encryption and provider verification', async () => {
  const workspaceId = 'ws-prod-vault-test';

  // Configure Meta WhatsApp API credentials
  const configReq = mockHttp('POST', '/api/marketing/providers/configure', {
    workspace_id: workspaceId,
    provider: 'whatsapp',
    token: 'EAABw_secret_test_token_string_long_enough_123',
    phone_number_id: '109876543212345',
    waba_id: '987654321012345'
  });
  await marketingApi(configReq.req, configReq.res);

  const configRes = configReq.get();
  assert.equal(configRes.status, 200);
  assert.equal(configRes.data.status, 'verified_connected');
  assert.equal(configRes.data.provider, 'whatsapp');
  assert.equal(configRes.data.phone_number_id, '109876543212345');
  assert.equal(configRes.data.waba_id, '987654321012345');
  assert.equal(configRes.data.masked_token.slice(-4), '_123');

  // Verify provider check works
  const verifyReq = mockHttp('POST', '/api/marketing/providers/verify', {
    workspace_id: workspaceId,
    provider: 'whatsapp'
  });
  await marketingApi(verifyReq.req, verifyReq.res);

  const verifyRes = verifyReq.get();
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.data.verified, true);
  assert.equal(verifyRes.data.status, 'verified_connected');
});

test('Persona Mode Switcher: Dynamically shifts between B2B Industrial and B2C Affinity', async () => {
  const workspaceId = 'ws-persona-test';

  // 1. Dispatch initial B2B Industrial campaign
  const dispatchReq = mockHttp('POST', '/api/marketing/dispatch', {
    workspace_id: workspaceId,
    prompt: 'Industrial warehouse and logistics hub outreach'
  });
  await marketingApi(dispatchReq.req, dispatchReq.res);
  const corrId = dispatchReq.get().data.correlation_id;
  await new Promise(r => setTimeout(r, 60));

  const taskB2B = orchestrator.getMarketingTask(workspaceId, corrId);
  assert.ok(taskB2B);
  assert.equal(taskB2B.profile_type, 'b2b_industrial');

  // 2. Switch to B2C Residential / Affinity mode
  const switchReq1 = mockHttp('POST', '/api/marketing/switch-persona', {
    workspace_id: workspaceId,
    correlation_id: corrId,
    persona_mode: 'b2c_affinity'
  });
  await marketingApi(switchReq1.req, switchReq1.res);

  const switchRes1 = switchReq1.get();
  assert.equal(switchRes1.status, 200);
  assert.equal(switchRes1.data.status, 'ok');
  assert.equal(switchRes1.data.persona_mode, 'b2c_affinity');
  assert.equal(switchRes1.data.project, 'shree_heights');
  assert.ok(switchRes1.data.affinity_strategy.pitch_framing.value_proposition.includes('riverine living') ||
            switchRes1.data.affinity_strategy.pitch_framing.emotional_hook.includes('home'));

  // 3. Switch back to B2B Industrial mode
  const switchReq2 = mockHttp('POST', '/api/marketing/switch-persona', {
    workspace_id: workspaceId,
    correlation_id: corrId,
    persona_mode: 'b2b_industrial'
  });
  await marketingApi(switchReq2.req, switchReq2.res);

  const switchRes2 = switchReq2.get();
  assert.equal(switchRes2.status, 200);
  assert.equal(switchRes2.data.persona_mode, 'b2b_industrial');
  assert.equal(switchRes2.data.project, 'lakhotia');
});

test('Multi-Agent Team Collaboration: Supervisor review controls and inter-agent directives', async () => {
  const workspaceId = 'ws-team-test';

  const dispatchReq = mockHttp('POST', '/api/marketing/dispatch', {
    workspace_id: workspaceId,
    prompt: 'Omnichannel campaign for riverfront residences'
  });
  await marketingApi(dispatchReq.req, dispatchReq.res);
  const corrId = dispatchReq.get().data.correlation_id;
  await new Promise(r => setTimeout(r, 60));

  // 1. Fetch Agent Team Board
  const getBoardReq = mockHttp('GET', `/api/marketing/agent-team?workspace_id=${workspaceId}&correlation_id=${corrId}`);
  await marketingApi(getBoardReq.req, getBoardReq.res);
  const boardRes = getBoardReq.get();
  assert.equal(boardRes.status, 200);
  assert.ok(boardRes.data.board.supervisor);
  assert.ok(boardRes.data.board.specialists.agent_leads);
  assert.ok(boardRes.data.board.specialists.agent_content);
  assert.ok(boardRes.data.board.specialists.agent_outreach);

  // 2. Supervisor Reviews Deliverable (Agreed)
  const reviewReq = mockHttp('POST', '/api/marketing/agent-team', {
    workspace_id: workspaceId,
    correlation_id: corrId,
    operation: 'review',
    decision: 'agreed',
    feedback: 'Approved by Overview AI Boss'
  });
  await marketingApi(reviewReq.req, reviewReq.res);
  assert.equal(reviewReq.get().status, 200);
  assert.equal(reviewReq.get().data.status, 'review_recorded');
  assert.equal(reviewReq.get().data.review.decision, 'agreed');

  // 3. Post Inter-Agent Directive Message
  const msgReq = mockHttp('POST', '/api/marketing/agent-team', {
    workspace_id: workspaceId,
    correlation_id: corrId,
    operation: 'message',
    sender: 'Overview AI (Supervisor)',
    recipient: 'agent_leads',
    message: 'Prioritize contacts with Hooghly and Chandannagar affinity.',
    role: 'boss'
  });
  await marketingApi(msgReq.req, msgReq.res);
  assert.equal(msgReq.get().status, 200);
  assert.equal(msgReq.get().data.status, 'message_posted');
  assert.ok(msgReq.get().data.entry.message);

  // 4. Verify board now contains new message
  const updatedBoardReq = mockHttp('GET', `/api/marketing/agent-team?workspace_id=${workspaceId}&correlation_id=${corrId}`);
  await marketingApi(updatedBoardReq.req, updatedBoardReq.res);
  const updatedDialogue = updatedBoardReq.get().data.board.inter_agent_dialogue;
  assert.ok(updatedDialogue.some(m => (m.message || '').includes('Prioritize contacts with Hooghly')));
});

test('Direct Lead Injection: Imports contacts and updates Gate 2 audience eligibility', async () => {
  const workspaceId = 'ws-leads-test';

  const dispatchReq = mockHttp('POST', '/api/marketing/dispatch', {
    workspace_id: workspaceId,
    prompt: 'Targeted residential outreach'
  });
  await marketingApi(dispatchReq.req, dispatchReq.res);
  const corrId = dispatchReq.get().data.correlation_id;
  await new Promise(r => setTimeout(r, 60));

  const contactsToImport = [
    { name: 'Rohan Sen', email: 'rohan.sen@example.invalid', phone: '+919876500001', company: 'Self', consent_email: true, consent_whatsapp: true, consent_source: 'crm_verified_form', consent_timestamp: new Date().toISOString() },
    { name: 'Ananya Roy', email: 'ananya.roy@example.invalid', phone: '+919876500002', company: 'Self', consent_email: true, consent_whatsapp: true, consent_source: 'crm_verified_form', consent_timestamp: new Date().toISOString() }
  ];

  const importReq = mockHttp('POST', '/api/marketing/import-leads', {
    workspace_id: workspaceId,
    correlation_id: corrId,
    leads: contactsToImport
  });
  await marketingApi(importReq.req, importReq.res);

  const importRes = importReq.get();
  assert.equal(importRes.status, 200);
  assert.equal(importRes.data.status, 'ok');
  assert.equal(importRes.data.total_count, 2);

  const task = orchestrator.getMarketingTask(workspaceId, corrId);
  assert.equal(task.channel_readiness.WhatsApp.gates.gate2_audience.eligible_count, 2);
  assert.equal(task.channel_readiness.WhatsApp.gates.gate2_audience.passed, true);
  assert.equal(task.channel_readiness.Email.gates.gate2_audience.eligible_count, 2);
  assert.equal(task.channel_readiness.Email.gates.gate2_audience.passed, true);
});
