'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');


const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const emailProvider = require('../lib/m360-email-provider');
const whatsappProvider = require('../lib/m360-whatsapp-provider');
const orchestrator = require('../lib/m360-marketing-orchestrator');
const affinityEngine = require('../lib/m360-affinity-engine');
const channelReadiness = require('../lib/m360-channel-readiness');
const marketingApi = require('../api/marketing');

const originalFetch = global.fetch;
const memberships = [
  { id: 'ws-hardening-test', name: 'Lakhotia Hardening Test', role: 'client_admin', profile_type: 'b2b_industrial', project_slug: 'lakhotia' },
  { id: 'ws-talent-test', name: 'TalentOS Workspace', role: 'client_admin', profile_type: 'recruitment_talent', project_slug: 'talentos' }
];

function installMockFetch(crmLeads = [], contentAssets = []) {
  global.fetch = async (url, options = {}) => {
    const sUrl = String(url);
    if (sUrl.endsWith('/me/workspaces')) {
      return { status: 200, ok: true, json: async () => memberships };
    }
    if (sUrl.includes('/workspaces/') && sUrl.endsWith('/leads')) {
      return { status: 200, ok: true, json: async () => crmLeads };
    }
    if (sUrl.includes('/content/assets') || sUrl.includes('content-assets')) {
      return { status: 200, ok: true, json: async () => ({ status: 'completed', assets: contentAssets }) };
    }
    if (sUrl.includes('graph.facebook.com')) {
      return {
        status: 200,
        ok: true,
        json: async () => ({
          verified_name: 'Matrix360 Business',
          display_phone_number: '+91 98765 43210',
          quality_rating: 'GREEN',
          code_verification_status: 'VERIFIED',
          messages: [{ id: 'wamid.HBgTEST123456789' }]
        })
      };
    }
    return { status: 200, ok: true, json: async () => ({}) };
  };
}

function mockHttp(method, path, body = {}, auth = 'Bearer test-session-token-hardening-123') {
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
      if (typeof data === 'string') {
        try { resData = JSON.parse(data); } catch { resData = data; }
      }
    }
  };

  return { req, res, get: () => ({ status: res.statusCode, data: resData }) };
}

test.beforeEach(() => {
  orchestrator.resetTaskStoreForTests();
  installMockFetch();
});

test.after(() => {
  global.fetch = originalFetch;
});

// ============================================================================
// FIX 1: ZERO-FABRICATION FALLBACKS
// ============================================================================

test('Fix 1: m360-email-provider never returns status: "delivered" when offline or unconfigured', async () => {
  const priorSg = process.env.SENDGRID_API_KEY;
  const priorRe = process.env.RESEND_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.RESEND_API_KEY;

  try {
    const receipt = await emailProvider.sendEmailMessage({
      to: 'lead@example.com',
      subject: 'Test subject',
      body: 'Test body',
      businessName: 'Zero Fab Test'
    });

    assert.equal(receipt.status, 'queued_sandbox_not_sent');
    assert.equal(receipt.live_dispatched, false);
    assert.notEqual(receipt.status, 'delivered');
    assert.equal(receipt.delivered_at, null);

    const campaign = await emailProvider.dispatchEmailCampaign({
      audience: [{ id: 'c1', email: 'c1@example.com', name: 'Lead 1' }],
      subject: 'Campaign test',
      body: 'Campaign text'
    });

    assert.equal(campaign.recipients_sent, 0);
    assert.equal(campaign.queued_sandbox_count, 1);
    assert.equal(campaign.results[0].status, 'queued_sandbox_not_sent');
    assert.equal(campaign.results[0].live_dispatched, false);
    assert.notEqual(campaign.results[0].status, 'delivered');
  } finally {
    if (priorSg) process.env.SENDGRID_API_KEY = priorSg;
    if (priorRe) process.env.RESEND_API_KEY = priorRe;
  }
});

test('Fix 1: m360-whatsapp-provider deep links return deep_link_prepared_not_sent, only provider_accepted on Meta 200', async () => {
  const priorToken = process.env.WHATSAPP_API_TOKEN;
  const priorPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_API_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;

  try {
    const campaign = await whatsappProvider.dispatchWhatsAppCampaign({
      audience: [{ id: 'w1', name: 'Lead 1', phone: '+91 98765 43210' }],
      body: 'Hello {{name}}',
      businessName: 'Zero Fab Business'
    });

    assert.equal(campaign.recipients_sent, 0);
    assert.equal(campaign.deep_links_prepared, 1);
    assert.equal(campaign.results[0].status, 'deep_link_prepared_not_sent');
    assert.equal(campaign.results[0].live_sent, false);
    assert.notEqual(campaign.results[0].status, 'delivered');
    assert.equal(campaign.results[0].delivered_at, null);
    assert.ok((campaign.results[0].action_links.wa_me || campaign.results[0].action_links.web_url).includes('wa.me/919876543210'));

    // When configured and returns 200 with messages[0].id
    process.env.WHATSAPP_API_TOKEN = 'EAABtestTokenValidMock';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '109876543210';

    const liveCampaign = await whatsappProvider.dispatchWhatsAppCampaign({
      audience: [{ id: 'w2', name: 'Lead 2', phone: '+91 98765 43210' }],
      body: 'Hello {{name}}',
      businessName: 'Live Cloud Business'
    });

    assert.equal(liveCampaign.recipients_sent, 1);
    assert.equal(liveCampaign.results[0].status, 'provider_accepted');
    assert.equal(liveCampaign.results[0].live_sent, true);
    assert.equal(liveCampaign.results[0].message_id, 'wamid.HBgTEST123456789');
  } finally {
    if (priorToken) process.env.WHATSAPP_API_TOKEN = priorToken;
    else delete process.env.WHATSAPP_API_TOKEN;
    if (priorPhone) process.env.WHATSAPP_PHONE_NUMBER_ID = priorPhone;
    else delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
});

// ============================================================================
// FIX 2: ZERO-PLAINTEXT VAULT PERSISTENCE & CTWA PHONE NUMBER FIX
// ============================================================================

test('Fix 2: WORKSPACE_PROVIDER_CREDENTIALS stores zero plaintext tokens, decrypts via decryptSecret, uses verified phone for CTWA', async () => {
  const ws = 'ws-hardening-test';
  const token = 'EAABsuperSecretMetaToken1234567890abcdef';
  const phoneId = '109876543210';
  const displayPhone = '+91 98765 43210';

  const record = orchestrator.configureMarketingProvider(ws, 'whatsapp', {
    token,
    phoneNumberId: phoneId,
    wabaId: 'waba-999',
    displayPhoneNumber: displayPhone
  });

  const stored = orchestrator.getStoredProviderCredentials(ws, 'whatsapp');
  assert.ok(stored, 'Stored credentials must exist');
  assert.equal(stored.token, undefined, 'Plaintext token must NEVER be stored in memory');
  assert.ok(stored.encryptedToken, 'Encrypted token must exist');
  assert.match(stored.encryptedToken, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
  assert.equal(stored.displayPhoneNumber, displayPhone);

  // Verification decrypts in-flight and returns verified phone number
  const verifyRes = await orchestrator.verifyMarketingProvider('whatsapp', { workspaceId: ws });
  assert.equal(verifyRes.verified, true);
  assert.equal(verifyRes.status, 'verified_connected');
  assert.equal(verifyRes.display_phone_number, '+91 98765 43210');

  // Verify production restrict: when in production, timeout does not fall back to mock
  const origNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  global.fetch = async () => { throw new Error('Network timeout'); };
  try {
    const prodVerify = await orchestrator.verifyMarketingProvider('whatsapp', { workspaceId: ws });
    assert.equal(prodVerify.verified, false);
    assert.equal(prodVerify.status, 'configured_unverified');
    assert.equal(prodVerify.error, 'NETWORK_TIMEOUT');
  } finally {
    process.env.NODE_ENV = origNodeEnv;
    installMockFetch();
  }
});

// ============================================================================
// FIX 3: MARKETING_ALLOWED_EMAILS=* & LIVE WHATSAPP CLOUD API DISPATCH
// ============================================================================

test('Fix 3: MARKETING_ALLOWED_EMAILS=* permits consented recipients, WhatsApp dispatches live with idempotency', async () => {
  const ws = 'ws-hardening-test';
  const env = orchestrator.createHandoverEnvelope({
    workspace_id: ws,
    payload: {
      prompt: 'Launch B2B industrial machinery campaign for Eastern corridor logistics',
      business_name: 'Lakhotia Logistics Hub',
      project: 'lakhotia',
      profile_type: 'b2b_industrial'
    }
  });

  const task = await orchestrator.dispatchMarketingTask(env, {
    skip_ai: true,
    keylessTestMode: false,
    audienceFixture: [
      {
        id: 'crm-lead-1',
        name: 'Industrial Buyer 1',
        email: 'buyer1@eastcorridor.com',
        phone: '+919876500001',
        email_opt_in_status: 'granted',
        whatsapp_opt_in_status: 'granted',
        consent_evidence: { email: true, whatsapp: true },
        suppressed: false
      }
    ]
  });

  for (let i = 0; i < 50 && task.status !== 'draft_ready'; i++) await new Promise(r => setTimeout(r, 10));

  // 1. Email with MARKETING_ALLOWED_EMAILS=*
  const priorAllowed = process.env.MARKETING_ALLOWED_EMAILS;
  const priorLive = process.env.MARKETING_LIVE_SEND_ENABLED;
  const priorMax = process.env.MARKETING_MAX_LIVE_MESSAGES;
  process.env.MARKETING_ALLOWED_EMAILS = '*';
  process.env.MARKETING_LIVE_SEND_ENABLED = 'true';
  process.env.MARKETING_MAX_LIVE_MESSAGES = '10';

  try {
    const emailDraft = task.channel_draft_versions.Email.versions.at(-1);
    orchestrator.approveChannelDraft(ws, task.correlation_id, 'Email', emailDraft.version_hash, 'admin');

    const emailAdapter = {
      name: 'test_smtp_adapter',
      verifyConnection: async () => ({ verified: true }),
      execute: async () => ({ provider_message_id: 'msg-email-allowed-star-1' })
    };

    const emailExec = await orchestrator.executeMarketingChannel(ws, task.correlation_id, 'Email', {
      mode: 'live',
      operatorApproved: true,
      approvalPhrase: 'SEND_APPROVED_EMAIL_CAMPAIGN',
      emailAdapter
    });

    assert.equal(emailExec.status, 'provider_accepted');
    assert.equal(emailExec.sent, true);
    assert.equal(emailExec.recipient_count, 1);

    // 2. WhatsApp live dispatch
    orchestrator.configureMarketingProvider(ws, 'whatsapp', {
      token: 'EAABtestLiveTokenWhatsApp1234567890',
      phoneNumberId: '109876543210'
    });

    const waDraft = task.channel_draft_versions.WhatsApp.versions.at(-1);
    orchestrator.approveChannelDraft(ws, task.correlation_id, 'WhatsApp', waDraft.version_hash, 'admin');

    // Attempt without approval phrase -> must fail
    await assert.rejects(async () => {
      await orchestrator.executeMarketingChannel(ws, task.correlation_id, 'WhatsApp', {
        mode: 'live',
        operatorApproved: true,
        approvalPhrase: 'WRONG_PHRASE'
      });
    }, err => err.code === 'LIVE_SEND_BLOCKED');

    // Live dispatch with mock adapter
    const waDispatches = [];
    const whatsAppAdapter = {
      name: 'whatsapp_cloud_mock',
      execute: async (draftPayload, opts) => {
        waDispatches.push({ draftPayload, opts });
        return { provider_message_id: 'wamid.HBgTESTDISPATCH123' };
      }
    };

    const waExec = await orchestrator.executeMarketingChannel(ws, task.correlation_id, 'WhatsApp', {
      mode: 'live',
      operatorApproved: true,
      approvalPhrase: 'SEND_APPROVED_WHATSAPP_CAMPAIGN',
      whatsAppAdapter
    });

    assert.equal(waExec.status, 'provider_accepted');
    assert.equal(waExec.sent, true);
    assert.equal(waExec.recipient_count, 1);
    assert.equal(waDispatches.length, 1);
    assert.equal(String(waDispatches[0].draftPayload.to).replace(/\D/g, ''), '919876500001');

    // Verify duplicate execution rejection via idempotency
    await assert.rejects(async () => {
      await orchestrator.executeMarketingChannel(ws, task.correlation_id, 'WhatsApp', {
        mode: 'live',
        operatorApproved: true,
        approvalPhrase: 'SEND_APPROVED_WHATSAPP_CAMPAIGN',
        whatsAppAdapter
      });
    }, err => err.code === 'DUPLICATE_EXECUTION_BLOCKED');
  } finally {
    if (priorAllowed) process.env.MARKETING_ALLOWED_EMAILS = priorAllowed;
    else delete process.env.MARKETING_ALLOWED_EMAILS;
    if (priorLive) process.env.MARKETING_LIVE_SEND_ENABLED = priorLive;
    else delete process.env.MARKETING_LIVE_SEND_ENABLED;
    if (priorMax) process.env.MARKETING_MAX_LIVE_MESSAGES = priorMax;
    else delete process.env.MARKETING_MAX_LIVE_MESSAGES;
  }
});

// ============================================================================
// FIX 4: switchPersonaMode SCHEMA PRESERVATION & RECRUITMENT / TALENTOS MODE
// ============================================================================

test('Fix 4: switchPersonaMode preserves full marketing_pitch schema, recalculates budget/ab_test, supports recruitment_talent', async () => {
  const ws = 'ws-talent-test';
  const env = orchestrator.createHandoverEnvelope({
    workspace_id: ws,
    payload: {
      prompt: 'Source senior full stack engineers and operations shift managers',
      business_name: 'TalentOS Recruiting',
      project: 'talentos',
      profile_type: 'recruitment_talent'
    }
  });

  const task = await orchestrator.dispatchMarketingTask(env, {
    skip_ai: true,
    keylessTestMode: false,
    audienceFixture: [
      {
        id: 'cand-1',
        name: 'Senior Dev',
        phone: '+91 98765 00099',
        email: 'dev@talentos.ai',
        purpose: 'recruitment',
        is_candidate: true,
        email_opt_in_status: 'granted',
        whatsapp_opt_in_status: 'granted',
        consent_evidence: { email: true, whatsapp: true }
      },
      {
        id: 'comm-1',
        name: 'Warehouse B2B Buyer',
        phone: '+91 98765 00088',
        email: 'buyer@industrial.com',
        purpose: 'commercial',
        is_candidate: false,
        email_opt_in_status: 'granted',
        whatsapp_opt_in_status: 'granted',
        consent_evidence: { email: true, whatsapp: true }
      }
    ]
  });

  for (let i = 0; i < 50 && task.status !== 'draft_ready'; i++) await new Promise(r => setTimeout(r, 10));

  // Verify recruitment_talent classification and purpose isolation
  assert.equal(task.profile_type, 'recruitment_talent');
  assert.equal(task.affinity_strategy.purpose, 'recruitment');

  // Candidate is eligible; commercial lead is blocked by purpose isolation
  assert.equal(task.channel_readiness.Email.gates.gate2_audience.eligible_count, 1);
  assert.ok(task.channel_readiness.Email.gates.gate2_audience.reasons.some(r => r.includes('purpose isolation')));

  // Switch to B2C Residential Affinity
  await orchestrator.switchPersonaMode(ws, task.correlation_id, 'b2c_affinity');
  assert.equal(task.profile_type, 'b2c_affinity');

  // Verify all canonical schema fields AND aliases survive
  const pitch = task.marketing_pitch;
  assert.ok(pitch.title, 'title must exist');
  assert.ok(pitch.profile_label, 'profile_label must exist');
  assert.ok(pitch.value_proposition, 'value_proposition must exist');
  assert.ok(Array.isArray(pitch.target_segments), 'target_segments must be an array');
  assert.ok(Array.isArray(pitch.qualification_criteria), 'qualification_criteria must be an array');
  assert.ok(pitch.budget_overview, 'budget_overview must exist');
  assert.ok(pitch.disclaimer, 'disclaimer must exist');
  assert.equal(pitch.profile_type, 'b2c_affinity');
  assert.ok(pitch.framing);

  // Verify budget and AB test plan were recalculated
  assert.equal(task.budget_estimate.profile_type, 'b2c_affinity');
  assert.ok(task.ab_test_plan.sample_size_per_variant > 0);

  // Switch back to recruitment_talent
  await orchestrator.switchPersonaMode(ws, task.correlation_id, 'recruitment_talent');
  assert.equal(task.profile_type, 'recruitment_talent');
  assert.equal(task.marketing_pitch.profile_type, 'recruitment_talent');
  assert.ok(task.marketing_pitch.title.includes('TalentOS'));
});

// ============================================================================
// FIX 5: MULTI-AGENT TEAM BOARD ACTIONS & GATE 1 ENFORCEMENT
// ============================================================================

test('Fix 5: Disagreed review blocks Gate 1 approval until revision, executeSpecialist updates board', async () => {
  const ws = 'ws-hardening-test';
  const env = orchestrator.createHandoverEnvelope({
    workspace_id: ws,
    payload: {
      prompt: 'Prepare multi-channel industrial park release',
      business_name: 'Lakhotia Industrial Masterplan',
      project: 'lakhotia',
      profile_type: 'b2b_industrial'
    }
  });

  const task = await orchestrator.dispatchMarketingTask(env, {
    skip_ai: true,
    keylessTestMode: false,
    audienceFixture: [
      {
        id: 'crm-lead-team',
        name: 'Plant Manager',
        email: 'plant@corp.com',
        phone: '+919876543210',
        email_opt_in_status: 'granted',
        consent_evidence: { email: true }
      }
    ]
  });

  for (let i = 0; i < 50 && task.status !== 'draft_ready'; i++) await new Promise(r => setTimeout(r, 10));

  // Supervisor disagrees with outreach draft
  const reviewRes = orchestrator.reviewAgentDeliverable(ws, task.correlation_id, {
    reviewer: 'Overview AI (Boss)',
    targetAgent: 'agent_outreach',
    decision: 'disagreed',
    feedback: 'Tone must emphasize heavy load capacity and 40ft trailer turning radius.'
  });

  assert.equal(reviewRes.review.decision, 'disagreed');
  assert.equal(task.agent_team_board.supervisor.review_status, 'changes_requested');

  // Gate 1 approval MUST be blocked while changes_requested
  const emailDraft = task.channel_draft_versions.Email.versions.at(-1);
  assert.throws(() => {
    orchestrator.approveChannelDraft(ws, task.correlation_id, 'Email', emailDraft.version_hash, 'admin');
  }, err => err.code === 'SUPERVISOR_REVISION_REQUIRED');

  // Generating a revision clears the block
  await orchestrator.reviseMarketingTaskDraft(ws, task.correlation_id, 'Email: Make it more formal with trailer turning radius specifications');
  assert.equal(task.agent_team_board.supervisor.review_status, 'revised_ready_for_review');

  // Now Gate 1 approval succeeds
  const revisedDraft = task.channel_draft_versions.Email.versions.at(-1);
  const approved = orchestrator.approveChannelDraft(ws, task.correlation_id, 'Email', revisedDraft.version_hash, 'admin');
  assert.equal(approved.gates.gate1_draft.passed, true);

  // Assign specialist task with executeSpecialist: true
  const assignRes = orchestrator.assignAgentTask(ws, task.correlation_id, {
    to: 'agent_leads',
    title: 'Refresh Hooghly Belt Contacts',
    executeSpecialist: true
  });

  assert.equal(assignRes.assignment.status, 'completed');
  assert.ok(assignRes.assignment.output.includes('verified CRM contacts'));
});

// ============================================================================
// FIX 6: AUTHENTICATED PRODUCTION REVERSE HANDOFFS
// ============================================================================

test('Fix 6: POST /api/marketing/handoff attaches authorized CRM leads and Content assets without 501', async () => {
  const ws = 'ws-hardening-test';
  const crmContacts = [
    { id: 'crm-verified-1', name: 'Verified Corp 1', email: 'v1@corp.com', phone: '+919876543001', email_opt_in_status: 'granted', whatsapp_opt_in_status: 'granted', consent_evidence: { email: true, whatsapp: true } },
    { id: 'crm-verified-2', name: 'Verified Corp 2', email: 'v2@corp.com', phone: '+919876543002', email_opt_in_status: 'granted', whatsapp_opt_in_status: 'granted', consent_evidence: { email: true, whatsapp: true } }
  ];
  const contentAssets = [
    { id: 'asset-poster-101', kind: 'poster', title: 'Lakhotia Industrial 4K Masterplan' },
    { id: 'asset-reel-102', kind: 'reel', title: 'Heavy Trailer Frontage Video' }
  ];

  installMockFetch(crmContacts, contentAssets);

  const env = orchestrator.createHandoverEnvelope({
    workspace_id: ws,
    payload: { prompt: 'Launch logistics campaign', business_name: 'Lakhotia Logistics', project: 'lakhotia', profile_type: 'b2b_industrial' }
  });
  const task = await orchestrator.dispatchMarketingTask(env, { skip_ai: true });
  for (let i = 0; i < 50 && task.status !== 'draft_ready'; i++) await new Promise(r => setTimeout(r, 10));// 1. Authenticated Leads reverse handoff
  const leadsReq = mockHttp('POST', '/api/marketing/handoff', {
    workspace_id: ws,
    correlation_id: task.correlation_id,
    origin_module: 'leads',
    lead_ids: ['crm-verified-1']
  });
  await marketingApi(leadsReq.req, leadsReq.res);
  const leadsRes = leadsReq.get();

  assert.equal(leadsRes.status, 200);
  assert.equal(leadsRes.data.status, 'verified_handoff_attached');
  assert.equal(leadsRes.data.count, 1);
  assert.equal(task.audience_snapshot.total_count, 1);

  // 2. Authenticated Content reverse handoff
  const contentReq = mockHttp('POST', '/api/marketing/handoff', {
    workspace_id: ws,
    correlation_id: task.correlation_id,
    origin_module: 'content',
    asset_ids: ['asset-poster-101']
  });
  await marketingApi(contentReq.req, contentReq.res);
  const contentRes = contentReq.get();

  assert.equal(contentRes.status, 200);
  assert.equal(contentRes.data.status, 'verified_handoff_attached');
  assert.equal(contentRes.data.count, 1);
});

// ============================================================================
// FIX 7: SIGNED META WHATSAPP WEBHOOK HANDLER
// ============================================================================

test('Fix 7: GET /api/marketing/webhooks/whatsapp verifies hub challenge, POST processes signed STOP & CTWA opt-ins', async () => {
  const verifyToken = 'meta_whatsapp_webhook_secret_verify_token_99';
  const appSecret = 'app_secret_super_long_hmac_key_1234567890';
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = verifyToken;
  process.env.WHATSAPP_APP_SECRET = appSecret;

  try {
    // 1. GET challenge verification
    const challengeReq = mockHttp('GET', `/api/marketing/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=1122334455`);
    await marketingApi(challengeReq.req, challengeReq.res);
    assert.equal(challengeReq.get().status, 200);
    assert.equal(String(challengeReq.get().data), '1122334455');

    // Invalid verify token -> 403
    const badChallengeReq = mockHttp('GET', `/api/marketing/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=1122334455`);
    await marketingApi(badChallengeReq.req, badChallengeReq.res);
    assert.equal(badChallengeReq.get().status, 403);

    // Setup active task with contact
    const ws = 'ws-hardening-test';
    const env = orchestrator.createHandoverEnvelope({
      workspace_id: ws,
      payload: { prompt: 'WhatsApp Webhook Test Campaign', business_name: 'Webhook Corp', project: 'lakhotia', profile_type: 'b2b_industrial' }
    });
    const task = await orchestrator.dispatchMarketingTask(env, {
      skip_ai: true,
      audienceFixture: [
        {
          id: 'contact-wa-webhook',
          name: 'Target Contact',
          phone: '+919876543210',
          whatsapp_opt_in_status: 'granted',
          consent_evidence: { whatsapp: true },
          suppressed: false
        }
      ]
    });
    for (let i = 0; i < 50 && task.status !== 'draft_ready'; i++) await new Promise(r => setTimeout(r, 10));// 2. Inbound STOP message via signed POST
    const stopPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.inbound.stop1',
                    text: { body: 'STOP' },
                    type: 'text'
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    };

    const stopBodyStr = JSON.stringify(stopPayload);
    const stopSignature = 'sha256=' + createHmac('sha256', appSecret).update(Buffer.from(stopBodyStr, 'utf8')).digest('hex');

    const postStopReq = mockHttp('POST', '/api/marketing/webhooks/whatsapp', stopPayload);
    postStopReq.req.headers['x-hub-signature-256'] = stopSignature;
    await marketingApi(postStopReq.req, postStopReq.res);

    assert.equal(postStopReq.get().status, 200);
    assert.equal(postStopReq.get().data.status, 'processed');

    const contactAfterStop = task.audience_snapshot.contacts.find(c => c.id === 'contact-wa-webhook');
    assert.equal(contactAfterStop.suppressed, true);
    assert.equal(contactAfterStop.whatsapp_opt_in_status, 'revoked');

    // 3. Inbound CTWA Opt-In grant via signed POST
    const optInPayload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-1',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                messages: [
                  {
                    from: '919876543210',
                    id: 'wamid.inbound.optin1',
                    text: { body: 'Hello! I would like to receive updates on WhatsApp regarding the project.' },
                    type: 'text'
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    };

    const optInBodyStr = JSON.stringify(optInPayload);
    const optInSig = 'sha256=' + createHmac('sha256', appSecret).update(Buffer.from(optInBodyStr, 'utf8')).digest('hex');

    const postOptInReq = mockHttp('POST', '/api/marketing/webhooks/whatsapp', optInPayload);
    postOptInReq.req.headers['x-hub-signature-256'] = optInSig;
    await marketingApi(postOptInReq.req, postOptInReq.res);

    assert.equal(postOptInReq.get().status, 200);
    assert.equal(contactAfterStop.suppressed, false);
    assert.equal(contactAfterStop.whatsapp_opt_in_status, 'granted');
    assert.equal(contactAfterStop.consent_evidence.whatsapp.source, 'verified_whatsapp_inbound_webhook');
  } finally {
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    delete process.env.WHATSAPP_APP_SECRET;
  }
});
