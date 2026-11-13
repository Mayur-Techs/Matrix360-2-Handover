'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

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

test('Autonomous Directives: Export verification and Direct Email prepares safe draft', async () => {
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

  let sendCalls = 0;
  const emailAdapter = {
    name: 'brevo_smtp',
    validateConfig: () => ({ valid: true, missing: [] }),
    verifyConnection: async () => ({ account_verified: true, verified: true }),
    execute: async () => {
      sendCalls++;
      return { provider: 'brevo_smtp', accepted: true, provider_message_id: 'test-auto-email-msg-001' };
    }
  };

  await marketingApi(req, res, { emailAdapter });
  const result = get();

  assert.equal(result.status, 202);
  assert.equal(result.body.status, 'ready_for_review');
  assert.equal(sendCalls, 0, 'Zero send adapter calls from chat');
  assert.ok(result.body.conversation);

  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && m.content.includes('Campaign drafts have been prepared'));
  assert.ok(assistantMsg, 'Assistant must report drafts ready for review');
  assert.match(assistantMsg.content, /Target Audience Summary/i);
  assert.match(assistantMsg.content, /Cost Estimate/i);

  global.fetch = originalFetch;
});

test('Autonomous Directives: Direct WhatsApp prompt prepares draft for review without auto-dispatch', async () => {
  installMockFetch();

  const { req, res, get } = mockHttp('POST', '/api/marketing?action=conversations', {
    workspace_id: 'ws-autonomous-test',
    prompt: 'send a whatsapp message to +919876543210 telling about our company features'
  });

  let sendCalls = 0;
  const emailAdapter = {
    name: 'brevo_smtp',
    validateConfig: () => ({ valid: true, missing: [] }),
    verifyConnection: async () => ({ account_verified: true, verified: true }),
    execute: async () => {
      sendCalls++;
      return { provider: 'brevo_smtp', accepted: true, provider_message_id: 'test-auto-email-msg-001' };
    }
  };

  await marketingApi(req, res, { emailAdapter });
  const result = get();

  assert.equal(result.status, 202);
  assert.equal(result.body.status, 'ready_for_review');
  assert.equal(sendCalls, 0, 'Zero sends from chat prompt');

  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && m.content.includes('Campaign drafts have been prepared'));
  assert.ok(assistantMsg, 'Assistant must report drafts ready for review');
  assert.match(assistantMsg.content, /Cost Estimate \(WhatsApp\)/i);

  global.fetch = originalFetch;
});

test('Autonomous Directives: Social campaign prompt prepares drafts for review', async () => {
  installMockFetch();

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

  await marketingApi(req, res, { emailAdapter });
  const result = get();

  assert.equal(result.status, 202);
  assert.equal(result.body.status, 'ready_for_review');

  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && m.content.includes('Campaign drafts have been prepared'));
  assert.ok(assistantMsg, 'Assistant must report drafts ready for review');

  global.fetch = originalFetch;
});

test('Autonomous Directives: Multi-Email Prompt Ingestion prepares drafts with zero auto-send', async () => {
  installMockFetch();
  process.env.M360_MARKETING_AI_ENABLED = 'true';
  process.env.MARKETING_LIVE_SEND_ENABLED = 'true';
  process.env.MARKETING_ALLOWED_EMAILS = '*';
  process.env.MARKETING_ALLOWED_RECIPIENT_MODE = 'all';

  const recipients = [
    'test1@example.com',
    'test2@example.com',
    'test3@example.com',
    'test4@example.com'
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
  assert.equal(result.body.status, 'ready_for_review');
  assert.ok(result.body.conversation);

  // 1. Verify 0 dispatches were executed from chat
  assert.equal(executedDispatches.length, 0, 'Zero dispatches executed from chat prompt');

  // 2. Verify assistant response reports drafts ready for review
  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && m.content.includes('Campaign drafts have been prepared'));
  assert.ok(assistantMsg, 'Assistant must report drafts ready for review');

  // 3. Verify task exists with drafts in draft_for_review
  const task = orchestrator.getMarketingTask('ws-autonomous-test', result.body.correlation_id);
  assert.ok(task, 'Task must exist in durable memory');
  assert.equal(task.status, 'draft_ready');

  // Verify none of the prompt emails were injected with fabricated consent
  const contacts = task.audience_snapshot?.contacts || [];
  for (const r of recipients) {
    assert.equal(contacts.some(c => c.email === r), false, `Recipient ${r} must not be injected with fabricated consent`);
  }

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

  let sendCalls = 0;
  const emailAdapter = {
    name: 'brevo_smtp',
    validateConfig: () => ({ valid: true, missing: [] }),
    verifyConnection: async () => ({ account_verified: true, verified: true }),
    execute: async () => {
      sendCalls++;
      return { provider: 'brevo_smtp', accepted: true, provider_message_id: 'test-auto-email-msg-001' };
    }
  };

  await marketingApi(req, res, { emailAdapter });
  const result = get();

  assert.equal(result.status, 202);
  assert.equal(result.body.status, 'ready_for_review');
  assert.equal(sendCalls, 0, 'Zero sends executed from chat');

  // 1. Verify assistant message confirms drafts ready
  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && m.content.includes('Campaign drafts have been prepared'));
  assert.ok(assistantMsg, 'Assistant must confirm drafts ready for review');

  // 2. Verify calendar event is created with scheduled status
  const task = orchestrator.getMarketingTask('ws-autonomous-test', result.body.correlation_id);
  assert.ok(task, 'Task must exist');
  assert.ok(task.calendar_events?.length > 0, 'Calendar events must exist');
  const scheduledEvent = task.calendar_events.find(e => e.status === 'scheduled');
  assert.ok(scheduledEvent, 'A scheduled calendar event must be present');
  assert.equal(scheduledEvent.channel, 'Email');

  global.fetch = originalFetch;
});

test('Autonomous Directives: Multi-Phone WhatsApp Campaign prepares drafts without auto-dispatch', async () => {
  installMockFetch();

  const { req, res, get } = mockHttp('POST', '/api/marketing?action=conversations', {
    workspace_id: 'ws-autonomous-test',
    prompt: 'Send WhatsApp campaign to +919876543210 and +919876543211 with our product announcement'
  });

  let sendCalls = 0;
  const emailAdapter = {
    name: 'brevo_smtp',
    validateConfig: () => ({ valid: true, missing: [] }),
    verifyConnection: async () => ({ account_verified: true, verified: true }),
    execute: async () => {
      sendCalls++;
      return { provider: 'brevo_smtp', accepted: true, provider_message_id: 'test-auto-email-msg-001' };
    }
  };

  await marketingApi(req, res, { emailAdapter });
  const result = get();

  assert.equal(result.status, 202);
  assert.equal(result.body.status, 'ready_for_review');
  assert.equal(sendCalls, 0, 'Zero sends from chat');

  const assistantMsg = result.body.conversation.messages.find(m => m.role === 'assistant' && m.content.includes('Campaign drafts have been prepared'));
  assert.ok(assistantMsg, 'Assistant must report drafts ready for review');

  global.fetch = originalFetch;
});
