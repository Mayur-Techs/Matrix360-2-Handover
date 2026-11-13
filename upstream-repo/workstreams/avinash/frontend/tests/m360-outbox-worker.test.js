'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const outboxWorker = require('../lib/m360-outbox-worker');
const orchestrator = require('../lib/m360-marketing-orchestrator');

describe('Stage 8 (W1 & W2): Durable Outbox Worker & Honest Provider Sends', () => {
  beforeEach(() => {
    outboxWorker.resetOutboxStoreForTests();
    orchestrator.resetTaskStoreForTests();
  });

  it('Approval snapshots eligible audience into campaign_outbox with deterministic idempotency keys', async () => {
    const wsId = 'ws-' + randomUUID();
    const corrId = 'corr-' + randomUUID();
    const contacts = [
      { id: 'c1', name: 'Alice', email: 'alice@example.com', phone: '+919876543210' },
      { id: 'c2', name: 'Bob', email: 'bob@example.com', phone: '+919876543211', suppressed: true }, // Suppressed: must be excluded
      { id: 'c3', name: 'Charlie', email: 'charlie@example.com', phone: '+919876543212' }
    ];

    const draft = {
      subject: 'Special Offer',
      body: 'Check out our new space',
      version_hash: 'hash-abc-123',
      version: 1
    };

    const items = await outboxWorker.snapshotAudienceToOutbox({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'Email',
      draftVersion: draft,
      contacts
    });

    // Bob is suppressed, so only Alice and Charlie should be enqueued
    assert.equal(items.length, 2, 'Suppressed contact excluded from snapshot');
    assert.equal(items[0].contact_id, 'c1');
    assert.equal(items[1].contact_id, 'c3');
    assert.equal(items[0].status, 'queued');

    // Verify deterministic idempotency key
    const expectedKey1 = outboxWorker.computeIdempotencyKey(corrId, 'email', draft.version_hash, 'c1');
    assert.equal(items[0].idempotency_key, expectedKey1);

    // Re-snapshotting duplicates nothing
    const secondPass = await outboxWorker.snapshotAudienceToOutbox({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'Email',
      draftVersion: draft,
      contacts
    });
    assert.equal(secondPass.length, 0, 'Duplicate rows are not re-inserted');
  });

  it('Partial batch failure: Recipient 3 failure leaves 1-2 provider_accepted, 3 failed, and 4-5 queued', async () => {
    const wsId = 'ws-' + randomUUID();
    const corrId = 'corr-' + randomUUID();
    const contacts = [
      { id: 'c1', name: 'Lead 1', email: 'lead1@example.com' },
      { id: 'c2', name: 'Lead 2', email: 'lead2@example.com' },
      { id: 'c3', name: 'Lead 3', email: 'lead3@example.com' },
      { id: 'c4', name: 'Lead 4', email: 'lead4@example.com' },
      { id: 'c5', name: 'Lead 5', email: 'lead5@example.com' }
    ];

    const draft = { subject: 'Update', body: 'News', version_hash: 'hash-v1', version: 1 };
    await outboxWorker.snapshotAudienceToOutbox({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'email',
      draftVersion: draft,
      contacts
    });

    // Mock email adapter that fails on recipient 3 (lead3@example.com)
    let sendCalls = 0;
    const mockEmailAdapter = {
      execute: async (msg) => {
        sendCalls++;
        if (msg.to === 'lead3@example.com') {
          throw Object.assign(new Error('SMTP rate limit or rejection on lead3'), { code: 'SMTP_TEMP_FAILURE' });
        }
        return { provider_message_id: `brevo_msg_${sendCalls}` };
      }
    };

    // Process batch with limit 3 (simulating a crash or partial batch stop at failure)
    const pass1 = await outboxWorker.processOutboxBatch({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'email',
      emailAdapter: mockEmailAdapter,
      mode: 'live',
      limit: 3
    });

    assert.equal(pass1.length, 3);
    assert.equal(pass1[0].status, 'provider_accepted');
    assert.equal(pass1[0].provider_message_id, 'brevo_msg_1');
    assert.equal(pass1[1].status, 'provider_accepted');
    assert.equal(pass1[1].provider_message_id, 'brevo_msg_2');
    assert.equal(pass1[2].status, 'failed');
    assert.equal(pass1[2].last_error, 'SMTP_TEMP_FAILURE');

    // Check summary of entire outbox: 2 provider_accepted, 1 failed, 2 queued
    const summary = outboxWorker.getOutboxSummary(wsId, corrId);
    assert.equal(summary.provider_accepted, 2);
    assert.equal(summary.failed, 1);
    assert.equal(summary.queued, 2);

    // Rerun 2: Resume with recovering adapter
    const recoveringAdapter = {
      execute: async (msg) => {
        sendCalls++;
        return { provider_message_id: `brevo_msg_${sendCalls}` };
      }
    };

    const pass2 = await outboxWorker.processOutboxBatch({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'email',
      emailAdapter: recoveringAdapter,
      mode: 'live',
      limit: 5
    });

    // Rows 1 and 2 were NOT re-sent (they remain provider_accepted).
    // pass2 processed row 3 (retried) and rows 4 & 5 (newly processed)
    assert.equal(pass2.length, 3);
    assert.ok(pass2.every(r => r.status === 'provider_accepted'));

    const finalSummary = outboxWorker.getOutboxSummary(wsId, corrId);
    assert.equal(finalSummary.provider_accepted, 5);
    assert.equal(finalSummary.failed, 0);
    assert.equal(finalSummary.queued, 0);
  });

  it('WhatsApp honest sends (W1): Missing provider message id fails with NO_PROVIDER_ID and never generates fake wa_ id', async () => {
    const wsId = 'ws-' + randomUUID();
    const corrId = 'corr-' + randomUUID();
    const contacts = [
      { id: 'w1', name: 'Lead WA', phone: '+919876543210' }
    ];
    const draft = { body: 'Hello', version_hash: 'wa-hash-1', template_name: 'test_tpl' };

    await outboxWorker.snapshotAudienceToOutbox({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'whatsapp',
      draftVersion: draft,
      contacts
    });

    // Adapter returns empty message ID
    const badWhatsAppAdapter = {
      execute: async () => ({ provider_message_id: null })
    };

    const res = await outboxWorker.processOutboxBatch({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'whatsapp',
      whatsAppAdapter: badWhatsAppAdapter,
      mode: 'live'
    });

    assert.equal(res[0].status, 'failed');
    assert.equal(res[0].last_error, 'NO_PROVIDER_ID');
    assert.equal(res[0].provider_message_id, null);
    assert.ok(!String(res[0].provider_message_id || '').startsWith('wa_'));
  });

  it('executeMarketingChannel honest receipts (W2): Missing provider_message_id fails with NO_PROVIDER_ID and never synthesizes IDs', async () => {
    const wsId = 'ws-' + randomUUID();
    const corrId = 'corr-' + randomUUID();
    const priorEnv = Object.fromEntries(['MARKETING_LIVE_SEND_ENABLED', 'MARKETING_ALLOWED_RECIPIENT_MODE'].map(k => [k, process.env[k]]));
    try {
      process.env.MARKETING_LIVE_SEND_ENABLED = 'true';
      process.env.MARKETING_ALLOWED_RECIPIENT_MODE = 'all';

      const task = await orchestrator.dispatchMarketingTask(
        orchestrator.createHandoverEnvelope({
          workspace_id: wsId,
          payload: { prompt: 'WhatsApp honest receipts test', business_name: 'Biz', profile_type: 'b2b_industrial', project: 'p1' }
        }),
        { skip_ai: true, keylessTestMode: true, audienceFixture: [{ id: 'fix-1', test_data: true, outbound_blocked: true }] }
      );
      for (let i = 0; i < 20 && task.status !== 'draft_ready'; i++) await new Promise(r => setTimeout(r, 5));

      task.audience_snapshot = {
        test_data: false,
        outbound_blocked: false,
        contacts: [{ id: 'wa-lead-1', phone: '+919876543210', whatsapp_opt_in_status: 'granted', consent_evidence: { whatsapp: true } }]
      };
      task.connections = { whatsapp: true };
      const draft = task.channel_draft_versions.WhatsApp.versions.at(-1);
      orchestrator.approveChannelDraft(wsId, task.correlation_id, 'WhatsApp', draft.version_hash, 'marketing_operator');
      task.channel_readiness.WhatsApp.gates.gate2_audience = { passed: true, eligible_count: 1 };
      task.channel_readiness.WhatsApp.gates.gate3_provider = { passed: true, provider_name: 'WHATSAPP' };
      orchestrator.saveTasksToDisk();

      // Adapter returns null provider_message_id
      const badWhatsAppAdapter = {
        execute: async () => ({ provider_message_id: null })
      };

      const result = await orchestrator.executeMarketingChannel(wsId, task.correlation_id, 'WhatsApp', {
        mode: 'live',
        operatorApproved: true,
        approvalPhrase: 'SEND_APPROVED_WHATSAPP_CAMPAIGN',
        token: 'test-token',
        phoneNumberId: 'test-phone-id',
        whatsAppAdapter: badWhatsAppAdapter
      });

      assert.equal(result.status, 'failed');
      assert.equal(result.sent, false);
      assert.equal(result.accepted_count, 0);
      assert.equal(result.failed_count, 1);
      assert.equal(result.executions[0].status, 'failed');
      assert.equal(result.executions[0].last_error, 'NO_PROVIDER_ID');
      assert.equal(result.executions[0].provider_message_id, null);
      assert.deepEqual(result.executions[0].provider_message_ids, []);
    } finally {
      for (const [k, v] of Object.entries(priorEnv)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });

  it('Mode gating: draft_only keeps outbox queued; team_test dispatches only allowlisted recipients', async () => {
    const wsId = 'ws-' + randomUUID();
    const corrId = 'corr-' + randomUUID();
    const contacts = [
      { id: 'm1', name: 'Internal Tester', email: 'tester@agency.com' },
      { id: 'm2', name: 'Real Customer', email: 'customer@client.com' }
    ];
    const draft = { subject: 'Beta', body: 'Testing', version_hash: 'beta-v1' };

    await outboxWorker.snapshotAudienceToOutbox({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'email',
      draftVersion: draft,
      contacts
    });

    let sendsCount = 0;
    const adapter = {
      execute: async () => {
        sendsCount++;
        return { provider_message_id: 'ack_' + sendsCount };
      }
    };

    // 1. draft_only mode: zero sends, stays queued
    const draftOnlyRes = await outboxWorker.processOutboxBatch({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'email',
      emailAdapter: adapter,
      mode: 'draft_only'
    });
    assert.equal(sendsCount, 0, 'No sends in draft_only mode');
    assert.ok(draftOnlyRes.every(r => r.status === 'queued'));

    // 2. team_test mode: only tester@agency.com is allowed; customer@client.com is skipped
    const teamTestRes = await outboxWorker.processOutboxBatch({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'email',
      emailAdapter: adapter,
      mode: 'team_test',
      testRecipients: ['tester@agency.com']
    });

    assert.equal(sendsCount, 1, 'Only test recipient dispatched');
    const sentRow = teamTestRes.find(r => r.contact_id === 'm1');
    const skippedRow = teamTestRes.find(r => r.contact_id === 'm2');
    assert.equal(sentRow.status, 'provider_accepted');
    assert.equal(skippedRow.status, 'skipped');
    assert.equal(skippedRow.last_error, 'RECIPIENT_NOT_IN_TEST_ALLOWLIST');
  });

  it('Concurrency: Two workers claiming outbox never double-send the same row', () => {
    const wsId = 'ws-' + randomUUID();
    const corrId = 'corr-' + randomUUID();
    const contacts = [
      { id: 'u1', name: 'U1', email: 'u1@example.com' },
      { id: 'u2', name: 'U2', email: 'u2@example.com' }
    ];
    const draft = { subject: 'Hi', body: 'Msg', version_hash: 'v1' };

    outboxWorker.snapshotAudienceToOutbox({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'email',
      draftVersion: draft,
      contacts
    });

    // Worker 1 claims 2 rows
    const worker1Batch = outboxWorker.claimOutboxBatch({ workspaceId: wsId, correlationId: corrId, limit: 2 });
    assert.equal(worker1Batch.length, 2);
    assert.equal(worker1Batch[0].status, 'sending');

    // Worker 2 attempts to claim at the same time: should get 0 rows because they are in-flight
    const worker2Batch = outboxWorker.claimOutboxBatch({ workspaceId: wsId, correlationId: corrId, limit: 2 });
    assert.equal(worker2Batch.length, 0, 'In-flight rows are locked and never double-claimed');
  });
});
