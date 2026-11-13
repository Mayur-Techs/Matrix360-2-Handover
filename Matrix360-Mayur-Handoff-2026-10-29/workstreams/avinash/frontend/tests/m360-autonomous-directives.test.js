'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const orchestrator = require('../lib/m360-marketing-orchestrator');
const marketingApi = require('../api/marketing');

const originalFetch = global.fetch;
const memberships = [
  { id: 'ws-autonomous-test', name: 'Autonomous Enterprise Workspace', role: 'client_admin', profile_type: 'b2b_industrial', project_slug: 'lakhotia' }
];

function installMockFetch() {
  global.fetch = async url => {
    if (String(url).endsWith('/me/workspaces')) return { status: 200, ok: true, json: async () => memberships };
    if (String(url).includes('/leads')) return { status: 200, ok: true, json: async () => [] };
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
        } catch (_) {
          resData = data;
        }
      }
    }
  };

  return { req, res, get: () => ({ status: res.statusCode, body: resData }) };
}

test('Autonomous Directives: Export verification and Direct Email execution', async () => {
  installMockFetch();
  process.env.M360_MARKETING_AI_ENABLED = 'true';
  process.env.MARKETING_LIVE_SEND_ENABLED = 'true';
  process.env.MARKETING_ALLOWED_EMAILS = '*';
  process.env.MARKETING_ALLOWED_RECIPIENT_MODE = 'all';

  assert.equal(typeof orchestrator.addConversationMessage, 'function', 'addConversationMessage must be exported');

  const { req, res, get } = mockHttp('POST', '/api/marketing?action=conversations', {
    workspace_id: 'ws-autonomous-test',
    prompt: 'send an email to testuser@example.com telling about the features about our company'
  });

  const emailAdapter = {
    name: 'brevo_smtp',
    validateConfig: () => ({ valid: true, missing: [] }),
    verifyConnection: async () => ({ account_verified: true, verified: true }),
    execute: async () => ({ provider: 'brevo_smtp', accepted: true, provider_message_id: 'test-auto-email-msg-001' })
  };

  await marketingApi(req, res, { emailAdapter });
  const result = get();

  assert.equal(result.status, 202);
  assert.equal(result.body.status, 'completed');
  assert.ok(result.body.conversation);

  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && m.content.includes('Email Dispatched'));
  assert.ok(assistantMsg, 'Assistant must report dispatched email');
  assert.match(assistantMsg.content, /testuser@example\.com/);
  assert.match(assistantMsg.content, /10-Channel/i);

  global.fetch = originalFetch;
});

test('Autonomous Directives: Direct WhatsApp prompt normalizes phone and prepares 1-Click Launch', async () => {
  installMockFetch();

  const { req, res, get } = mockHttp('POST', '/api/marketing?action=conversations', {
    workspace_id: 'ws-autonomous-test',
    prompt: 'send a whatsapp message to +919876543210 telling about our company features'
  });

  const emailAdapter = {
    name: 'brevo_smtp',
    validateConfig: () => ({ valid: true, missing: [] }),
    verifyConnection: async () => ({ account_verified: true, verified: true }),
    execute: async () => ({ provider: 'brevo_smtp', accepted: true, provider_message_id: 'test-auto-email-msg-001' })
  };

  await marketingApi(req, res, { emailAdapter });
  const result = get();

  assert.equal(result.status, 202);
  assert.equal(result.body.status, 'completed');

  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && (m.content.includes('WhatsApp') || m.content.includes('1-Click')));
  assert.ok(assistantMsg, 'Assistant must report WhatsApp launch');
  assert.match(assistantMsg.content, /919876543210/);
  assert.match(assistantMsg.content, /wa\.me/);

  global.fetch = originalFetch;
});

test('Autonomous Directives: LinkedIn social brief creates a persistent handover without claiming publication', async t => {
  installMockFetch();
  const linkedinStore=require('../lib/m360-linkedin-store').createStore({path:':memory:',backend:'sqlite',env:{}});
  t.after(()=>{linkedinStore.close();global.fetch=originalFetch;});

  const { req, res, get } = mockHttp('POST', '/api/marketing?action=conversations', {
    workspace_id: 'ws-autonomous-test',
    prompt: 'launch an instagram and linkedin campaign promoting our company features'
  });

  const emailAdapter = {
    name: 'brevo_smtp',
    validateConfig: () => ({ valid: true, missing: [] }),
    verifyConnection: async () => ({ account_verified: true, verified: true }),
    execute: async () => ({ provider: 'brevo_smtp', accepted: true, provider_message_id: 'test-auto-email-msg-001' })
  };

  await marketingApi(req, res, { emailAdapter, linkedinStore });
  const result = get();

  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'linkedin_handoff');
  assert.match(result.body.linkedin.objective, /linkedin/);
  const handover=await linkedinStore.get('ws-autonomous-test','handovers',result.body.linkedin.handover_id);
  assert.equal(handover.status,'awaiting_composer');
  assert.equal(handover.envelope.workspace_id,'ws-autonomous-test');
  assert.deepEqual(await linkedinStore.listJobs('ws-autonomous-test'),[]);

  global.fetch = originalFetch;
});

test('Autonomous Directives: Multi-Email Prompt Ingestion, Multi-Agent Collaboration Board & Multi-Recipient Brevo Dispatch', async () => {
  installMockFetch();
  process.env.M360_MARKETING_AI_ENABLED = 'true';
  process.env.MARKETING_LIVE_SEND_ENABLED = 'true';
  process.env.MARKETING_ALLOWED_EMAILS = '*';
  process.env.MARKETING_ALLOWED_RECIPIENT_MODE = 'all';

  const recipients = [
    'mayurnn.12@gmail.com',
    'nikumbhmayur4@gmail.com',
    'altufaltu1027@gmail.com',
    'matrix360consulting@gmail.com'
  ];

  const { req, res, get } = mockHttp('POST', '/api/marketing?action=conversations', {
    workspace_id: 'ws-autonomous-test',
    prompt: `Send an email campaign to ${recipients.join(', ')} telling about the features of our company`
  });

  const executedDispatches = [];
  const emailAdapter = {
    name: 'brevo_smtp',
    validateConfig: () => ({ valid: true, missing: [] }),
    verifyConnection: async () => ({ account_verified: true, verified: true }),
    execute: async (opts) => {
      const msgId = `<msg-${Date.now()}-${opts.to}@smtp-relay.brevo.com>`;
      executedDispatches.push({ to: opts.to, msgId });
      return { provider: 'brevo_smtp', accepted: true, provider_message_id: msgId };
    }
  };

  await marketingApi(req, res, { emailAdapter });
  const result = get();

  assert.equal(result.status, 202);
  assert.equal(result.body.status, 'completed');
  assert.ok(result.body.conversation);

  // 1. Verify all 4 dispatches were executed
  assert.equal(executedDispatches.length, 4, 'All 4 recipients must receive live dispatches');
  for (const r of recipients) {
    assert.ok(executedDispatches.some(d => d.to === r), `Recipient ${r} must be in executed dispatches`);
  }

  // 2. Verify assistant response reports all 4 recipients and message IDs
  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && m.content.includes('Email Dispatched'));
  assert.ok(assistantMsg, 'Assistant must report multi-recipient dispatch');
  for (const r of recipients) {
    assert.match(assistantMsg.content, new RegExp(r.replace('.', '\\.')), `Assistant message must cite ${r}`);
  }
  assert.match(assistantMsg.content, /Overview AI \(Boss\)/i);
  assert.match(assistantMsg.content, /Leads & Pipeline AI/i);
  assert.match(assistantMsg.content, /Content Creation AI/i);
  assert.match(assistantMsg.content, /Outreach & Campaign AI/i);

  // 3. Verify task audience snapshot contains verified identities with consent
  const task = orchestrator.getMarketingTask('ws-autonomous-test', result.body.correlation_id);
  assert.ok(task, 'Task must exist in durable memory');
  assert.equal(task.audience_snapshot.total_count, 4);
  const contacts = task.audience_snapshot.contacts;
  assert.ok(contacts.some(c => c.email === 'mayurnn.12@gmail.com' && c.name === 'Mayur Nikumbh' && c.title.includes('Founder')));
  assert.ok(contacts.some(c => c.email === 'nikumbhmayur4@gmail.com' && c.first_name === 'M. R.' && c.company.includes('Nikumbh')));
  assert.ok(contacts.every(c => c.consent_status === 'opted_in'));

  // 4. Verify Multi-Agent Team Board is populated and approved
  assert.ok(task.agent_team_board, 'agent_team_board must exist');
  assert.equal(task.agent_team_board.supervisor.review_status, 'agreed_approved');
  assert.ok(task.agent_team_board.inter_agent_dialogue.length >= 4);

  global.fetch = originalFetch;
});

test('Autonomous Directives: Campaign Directive Scheduling & CRM Prospect Selection ("next Tuesday at 11 AM")', async () => {
  installMockFetch();
  process.env.M360_MARKETING_AI_ENABLED = 'true';
  process.env.MARKETING_LIVE_SEND_ENABLED = 'true';
  process.env.MARKETING_ALLOWED_EMAILS = '*';
  process.env.MARKETING_ALLOWED_RECIPIENT_MODE = 'all';

  const { req, res, get } = mockHttp('POST', '/api/marketing?action=conversations', {
    workspace_id: 'ws-autonomous-test',
    prompt: 'Send a personalized email campaign to 50 eligible prospects from the Lead Generator using the content we created, next Tuesday at 11 AM.'
  });

  const emailAdapter = {
    name: 'brevo_smtp',
    validateConfig: () => ({ valid: true, missing: [] }),
    verifyConnection: async () => ({ account_verified: true, verified: true }),
    execute: async () => ({ provider: 'brevo_smtp', accepted: true, provider_message_id: 'test-auto-email-msg-001' })
  };

  await marketingApi(req, res, { emailAdapter });
  const result = get();

  assert.equal(result.status, 202);
  assert.equal(result.body.status, 'completed');

  // 1. Verify assistant message confirms scheduling and 50 prospects
  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && m.content.includes('Scheduled by Multi-Agent Team'));
  assert.ok(assistantMsg, 'Assistant must confirm scheduling by multi-agent team');
  assert.match(assistantMsg.content, /50 eligible prospects/i);
  assert.match(assistantMsg.content, /Tuesday/i);
  assert.match(assistantMsg.content, /11:00/i);
  assert.match(assistantMsg.content, /Brevo SMTP/i);

  // 2. Verify calendar event is created with scheduled status
  const task = orchestrator.getMarketingTask('ws-autonomous-test', result.body.correlation_id);
  assert.ok(task, 'Task must exist');
  assert.ok(task.calendar_events?.length > 0, 'Calendar events must exist');
  const scheduledEvent = task.calendar_events.find(e => e.status === 'scheduled');
  assert.ok(scheduledEvent, 'A scheduled calendar event must be present');
  assert.equal(scheduledEvent.channel, 'Email');

  // 3. Verify Multi-Agent Team Board recorded Boss supervisor review
  assert.ok(task.agent_team_board, 'Agent team board must be initialized');
  assert.equal(task.agent_team_board.supervisor.review_status, 'agreed_approved');

  global.fetch = originalFetch;
});

test('Autonomous Directives: Multi-Phone WhatsApp Campaign with 1-Click Launch and international normalization', async () => {
  installMockFetch();

  const { req, res, get } = mockHttp('POST', '/api/marketing?action=conversations', {
    workspace_id: 'ws-autonomous-test',
    prompt: 'Send WhatsApp campaign to +919876543210 and +919876543211 with our product announcement'
  });

  const emailAdapter = {
    name: 'brevo_smtp',
    validateConfig: () => ({ valid: true, missing: [] }),
    verifyConnection: async () => ({ account_verified: true, verified: true }),
    execute: async () => ({ provider: 'brevo_smtp', accepted: true, provider_message_id: 'test-auto-email-msg-001' })
  };

  await marketingApi(req, res, { emailAdapter });
  const result = get();

  assert.equal(result.status, 202);
  assert.equal(result.body.status, 'completed');

  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && (m.content.includes('WhatsApp Campaign') || m.content.includes('1-Click')));
  assert.ok(assistantMsg, 'Assistant must report WhatsApp multi-number campaign');
  assert.match(assistantMsg.content, /919876543210/);
  assert.match(assistantMsg.content, /919876543211/);
  assert.match(assistantMsg.content, /wa\.me/);

  global.fetch = originalFetch;
});
