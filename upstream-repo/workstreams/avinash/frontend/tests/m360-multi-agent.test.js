'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { listAgents, getAgent, isToolAllowed } = require('../lib/agents/registry');
const { listTools, getTool, executeTool, TOOL_CLASSES } = require('../lib/agents/tools');
const { sendMessage, getMessages, resetBusForTests } = require('../lib/agents/bus');
const { runSupervisorWorkflow } = require('../lib/agents/supervisor');

describe('Stage 10: Multi-Agent Coordination Spine & Tool Governance', () => {
  beforeEach(() => {
    resetBusForTests();
  });

  it('Agent Registry: 6 specialized agents configured with distinct purposes and tools', () => {
    const agents = listAgents();
    assert.equal(agents.length, 6, 'Exactly 6 core agents registered');

    const expected = ['research_agent', 'audience_agent', 'content_agent', 'compliance_agent', 'supervisor_agent', 'outreach_agent'];
    for (const name of expected) {
      const agent = getAgent(name);
      assert.ok(agent, `Agent ${name} must be present`);
      assert.ok(agent.purpose.length > 10, 'Agent has documented purpose');
      assert.ok(Array.isArray(agent.allowedTools) && agent.allowedTools.length > 0, 'Agent has allowed tools');
    }

    // Tool permissions
    assert.equal(isToolAllowed('research_agent', 'search_market_facts'), true);
    assert.equal(isToolAllowed('research_agent', 'send_marketing_email'), false, 'research_agent cannot send emails');
    assert.equal(isToolAllowed('outreach_agent', 'send_marketing_email'), true);
  });

  it('Tool Governance: external_send and spend tools require server-verified human approval ID', async () => {
    // 1. Calling external_send without approval ID returns blocked
    const sendWithoutApproval = await executeTool('send_marketing_email', { recipients: ['test@example.com'] }, {});
    assert.equal(sendWithoutApproval.status, 'blocked');
    assert.equal(sendWithoutApproval.code, 'HUMAN_APPROVAL_REQUIRED');

    // 2. Calling spend without approval ID returns blocked
    const spendWithoutApproval = await executeTool('allocate_ad_spend', { amount: 500 }, {});
    assert.equal(spendWithoutApproval.status, 'blocked');
    assert.equal(spendWithoutApproval.code, 'HUMAN_APPROVAL_REQUIRED');

    // 3. Model cannot self-grant approval (requires server-verified flag or valid UUID)
    const validApprovalId = 'appr-' + randomUUID();
    const approvedSend = await executeTool('send_marketing_email', { recipients: ['test@example.com'] }, {
      approvalId: validApprovalId,
      verifiedApproval: true
    });
    assert.equal(approvedSend.status, 'dispatched');
    assert.equal(approvedSend.data.approvalId, validApprovalId);

    // 4. Missing credentials returns blocked, never a fake success
    const missingCredsResult = await executeTool('send_marketing_email', {}, {
      approvalId: validApprovalId,
      verifiedApproval: true,
      hasCredentials: false
    });
    assert.equal(missingCredsResult.status, 'blocked');
    assert.equal(missingCredsResult.code, 'CREDENTIALS_MISSING');
  });

  it('Durable Message Bus: Dispatches ordered immutable messages between registered agents only', async () => {
    const wsId = 'ws-' + randomUUID();
    const corrId = 'corr-' + randomUUID();

    // 1. Rejects unregistered sender or receiver
    await assert.rejects(
      async () => sendMessage({ workspaceId: wsId, correlationId: corrId, fromAgent: 'rogue_agent', toAgent: 'supervisor_agent', intent: 'ping' }),
      /not registered/
    );

    // 2. Dispatches and sequences messages
    const m1 = await sendMessage({
      workspaceId: wsId,
      correlationId: corrId,
      fromAgent: 'supervisor_agent',
      toAgent: 'research_agent',
      intent: 'gather_specs'
    });
    assert.equal(m1.sequence, 1);
    assert.equal(m1.from_agent, 'supervisor_agent');

    const m2 = await sendMessage({
      workspaceId: wsId,
      correlationId: corrId,
      fromAgent: 'research_agent',
      toAgent: 'supervisor_agent',
      intent: 'specs_ready',
      payload: { plotCount: 15 }
    });
    assert.equal(m2.sequence, 2);

    const busMessages = getMessages(wsId, corrId);
    assert.equal(busMessages.length, 2);
    assert.equal(busMessages[0].sequence, 1);
    assert.equal(busMessages[1].sequence, 2);
  });

  it('Supervisor Orchestration: End-to-end dry run writes real bus rows and terminates at awaiting_human_approval with 0 sends', async () => {
    const wsId = 'ws-' + randomUUID();
    const corrId = 'corr-' + randomUUID();
    const contacts = [
      { id: 'c1', name: 'Buyer 1', email: 'buyer1@industrial.com', email_opt_in_status: 'granted', consent_status: 'granted' },
      { id: 'c2', name: 'Buyer 2', email: 'buyer2@industrial.com', email_opt_in_status: 'granted', consent_status: 'granted' }
    ];

    // Dry run without human approval ID
    const dryRun = await runSupervisorWorkflow({
      workspaceId: wsId,
      correlationId: corrId,
      prompt: 'Prepare Q4 industrial leasing launch for Lakhotia',
      businessProfile: { businessName: 'Lakhotia Industrial Park', website: 'https://lakhotia.example.com' },
      contacts
    });

    // Acceptance checks:
    // 1. Status is awaiting_human_approval
    assert.equal(dryRun.status, 'awaiting_human_approval');
    // 2. Sends dispatched is strictly ZERO
    assert.equal(dryRun.sendsDispatched, 0, 'Zero sends allowed before human approval');
    // 3. Real bus rows written for every phase
    assert.ok(dryRun.busMessages.length >= 5, 'Real bus rows recorded for each agent phase');
    const intents = dryRun.busMessages.map(m => m.intent);
    assert.ok(intents.includes('conduct_research'));
    assert.ok(intents.includes('verify_audience_consent'));
    assert.ok(intents.includes('prepare_drafts'));
    assert.ok(intents.includes('validate_compliance'));
    assert.ok(intents.includes('awaiting_human_approval'));
  });

  it('Supervisor Orchestration: Dispatches outreach only after verified human approval ID is supplied', async () => {
    const wsId = 'ws-' + randomUUID();
    const corrId = 'corr-' + randomUUID();
    const contacts = [
      { id: 'c1', name: 'Buyer 1', email: 'buyer1@industrial.com', email_opt_in_status: 'granted', consent_status: 'granted' }
    ];
    const validApprovalId = 'human-appr-' + randomUUID();

    const approvedRun = await runSupervisorWorkflow({
      workspaceId: wsId,
      correlationId: corrId,
      prompt: 'Approved launch',
      businessProfile: { businessName: 'Lakhotia' },
      contacts,
      approvalId: validApprovalId
    });

    assert.equal(approvedRun.status, 'dispatched');
    assert.equal(approvedRun.sendsDispatched, 1);
    assert.ok(approvedRun.busMessages.some(m => m.intent === 'execute_approved_outreach'));
  });
});
