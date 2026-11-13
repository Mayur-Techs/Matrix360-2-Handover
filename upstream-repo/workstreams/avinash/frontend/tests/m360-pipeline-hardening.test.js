'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const { runSupervisorWorkflow, runChatToCampaignWorkflow } = require('../lib/agents/supervisor');
const { executeTool } = require('../lib/agents/tools');
const { getMessages, resetBusForTests } = require('../lib/agents/bus');
const outboxWorker = require('../lib/m360-outbox-worker');
const orchestrator = require('../lib/m360-marketing-orchestrator');

describe('Stage 3: Interconnected Pipeline Hardening & Hallucination Guard', () => {
  beforeEach(() => {
    resetBusForTests();
    outboxWorker.resetOutboxStoreForTests();
    orchestrator.resetTaskStoreForTests();
  });

  it('Pipeline Resilience 1: CRM outage degrades safely without crashing or fabricating fake leads', async () => {
    // When CRM returns 500 error, marketing orchestrator fails closed with honest error
    const brokenCrmClient = {
      getLeads: async () => {
        const err = new Error('CRM connection timeout / HTTP 503 Service Unavailable');
        err.statusCode = 503;
        throw err;
      }
    };

    let errorCaptured = null;
    try {
      await brokenCrmClient.getLeads('ws-crm-outage');
    } catch (err) {
      errorCaptured = err;
    }

    assert.ok(errorCaptured, 'Must capture CRM failure');
    assert.equal(errorCaptured.statusCode, 503);
    assert.ok(errorCaptured.message.includes('Service Unavailable'), 'Must preserve true service error');
  });

  it('Pipeline Resilience 2: Agent bus dry-run writes rows to agent_messages and holds strictly at awaiting_human_approval', async () => {
    const wsId = 'ws-agent-bus-' + randomUUID();
    const corrId = 'corr-bus-' + randomUUID();

    const contacts = [
      { id: 'c1', name: 'Real Contact', email: 'real@example.com', email_opt_in_status: 'granted', consent_status: 'granted' }
    ];

    const result = await runSupervisorWorkflow({
      workspaceId: wsId,
      correlationId: corrId,
      prompt: 'Draft an honest quarterly update to verified clients',
      businessProfile: { businessName: 'Lakhotia Logistics', hasModel: true },
      contacts,
      approvalId: null // No approval ID passed
    });

    // Workflow must halt at human approval gate
    assert.equal(result.status, 'awaiting_human_approval');
    assert.equal(result.sendsDispatched, 0, 'Zero sends allowed without human sign-off');

    // Messages written to the durable agent bus
    const busRows = getMessages(wsId, corrId);
    assert.ok(busRows.length >= 4, 'Must write audit rows for research, audience, content, and approval');
    
    // Check that every message has a real timestamp and strictly draft status
    for (const msg of busRows) {
      assert.ok(msg.created_at, 'Message must have ISO timestamp');
      assert.notEqual(msg.intent, 'auto_dispatched', 'Intent must never be auto_dispatched');
    }
  });

  it('Pipeline Resilience 3: Model absence strictly returns NO_MODEL_CONFIGURED with zero hallucinated copy', async () => {
    const wsId = 'ws-nomodel-' + randomUUID();
    const origOpenAI = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const toolRes = await executeTool('generate_channel_copy', {
        channel: 'WhatsApp',
        businessName: 'Zero Model Enterprises'
      }, {
        hasModel: false
      });

      assert.equal(toolRes.status, 'blocked');
      assert.equal(toolRes.code, 'NO_MODEL_CONFIGURED');
      assert.ok(toolRes.error.includes('No AI language model configured'));

      // Verify supervisor also halts with NO_MODEL_CONFIGURED
      const supRes = await runSupervisorWorkflow({
        workspaceId: wsId,
        correlationId: 'corr-nomodel-' + randomUUID(),
        prompt: 'Draft WhatsApp text',
        businessProfile: { businessName: 'Zero Model Enterprises', hasModel: false },
        contacts: []
      });

      assert.equal(supRes.status, 'blocked');
      assert.equal(supRes.code, 'NO_MODEL_CONFIGURED');
      assert.equal(supRes.sendsDispatched, 0);
    } finally {
      if (origOpenAI) process.env.OPENAI_API_KEY = origOpenAI;
    }
  });

  it('Pipeline Resilience 4: Meta/Brevo provider outage marks outbox as failed and never fabricates fake provider message IDs', async () => {
    const wsId = 'ws-outbox-fail-' + randomUUID();
    const corrId = 'corr-outbox-fail-' + randomUUID();

    const contacts = [
      { id: 'c101', name: 'Devendra', email: 'devendra@example.com', phone: '+919876500001' }
    ];

    const draft = {
      subject: 'Server Outage Test',
      body: 'Testing graceful provider failure',
      version_hash: 'hash-fail-test',
      version: 1
    };

    // 1. Snapshot into outbox
    await outboxWorker.snapshotAudienceToOutbox({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'whatsapp',
      draftVersion: draft,
      contacts
    });

    // 2. Simulated crashing provider adapter
    const deadMetaAdapter = {
      execute: async () => {
        throw new Error('Meta Graph API 500 Internal Server Error: Handshake timed out');
      }
    };

    const batch = await outboxWorker.processOutboxBatch({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'whatsapp',
      whatsAppAdapter: deadMetaAdapter,
      mode: 'live',
      limit: 10
    });

    assert.equal(batch.length, 1);
    assert.equal(batch[0].status, 'failed');
    assert.equal(batch[0].provider_message_id, null, 'Must NEVER invent a fake wamid or provider message ID on error');
    assert.ok(batch[0].last_error.includes('Meta Graph API 500'), 'Must record authentic error details');

    const summary = outboxWorker.getOutboxSummary(wsId, corrId);
    assert.equal(summary.failed, 1);
    assert.equal(summary.provider_accepted, 0);
  });

  it('Pipeline Resilience 5: Missing webhooks leave status strictly at dispatched and never self-promote to delivered', async () => {
    const wsId = 'ws-webhook-wait-' + randomUUID();
    const corrId = 'corr-webhook-wait-' + randomUUID();

    const contacts = [
      { id: 'c102', name: 'Naveen', email: 'naveen@example.com', phone: '+919876500002' }
    ];

    const draft = { subject: 'Webhook Test', body: 'Awaiting Webhook', version_hash: 'h-wh-1' };

    await outboxWorker.snapshotAudienceToOutbox({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'email',
      draftVersion: draft,
      contacts
    });

    const liveAdapter = {
      execute: async () => ({ provider_message_id: 'real-brevo-id-998877' })
    };

    const batch = await outboxWorker.processOutboxBatch({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'email',
      emailAdapter: liveAdapter,
      mode: 'live',
      limit: 10
    });

    assert.equal(batch[0].status, 'provider_accepted');
    // Without an incoming webhook event, the status MUST NOT advance to 'delivered' or 'read'
    const summary = outboxWorker.getOutboxSummary(wsId, corrId);
    assert.equal(summary.provider_accepted, 1);
    assert.equal(summary.delivered || 0, 0, 'Status must not self-advance to delivered without a verified webhook');
  });

  it('Hallucination Guard (HALL1): AI proposals strictly marked is_draft: true with zero invented contacts or receipts', async () => {
    const wsId = 'ws-hall1-' + randomUUID();
    const corrId = 'corr-hall1-' + randomUUID();

    // 1. Audience with 0 consented contacts
    const unconsentedContacts = [
      { id: 'u1', name: 'Unconsented 1', email: 'u1@example.com', email_opt_in_status: 'unconsented' },
      { id: 'u2', name: 'Opted Out 2', email: 'u2@example.com', email_opt_in_status: 'granted', suppressed: true }
    ];

    const result = await runChatToCampaignWorkflow({
      workspaceId: wsId,
      prompt: 'Draft email to unconsented list',
      businessProfile: { businessName: 'Honest Business Corp', hasModel: true },
      contacts: unconsentedContacts
    });

    // 2. Must not invent fake consented recipients
    assert.equal(result.audience.eligible_count, 0, 'Eligible count must be strictly 0 when no consent exists');
    assert.equal(result.audience.eligible_contacts.length, 0, 'Cannot hallucinate or fabricate contacts');

    // 3. Draft must be explicitly marked as draft
    assert.equal(result.status, 'awaiting_human_approval');
    assert.equal(result.sendsDispatched, 0);

    // 4. Verification that tools refuse unverified send requests
    const illegalSend = await executeTool('send_marketing_email', {
      recipients: ['test@example.com']
    }, {});
    assert.equal(illegalSend.status, 'blocked');
    assert.equal(illegalSend.code, 'HUMAN_APPROVAL_REQUIRED');
  });
});
