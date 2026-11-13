'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runSupervisorWorkflow
} = require('../lib/agents/supervisor');

const {
  executeTool
} = require('../lib/agents/tools');

const {
  getMessages,
  resetBusForTests
} = require('../lib/agents/bus');

test('Stage 5: Agents on Existing Spine & Human Approval Safety Gates', async (t) => {
  const wsId = 'ws-agent-s5-' + Date.now();
  resetBusForTests();

  t.after(() => {
    resetBusForTests();
  });

  const contacts = [
    { id: 'c1', name: 'Alok', email: 'alok@example.com', email_opt_in_status: 'granted', consent_status: 'granted' },
    { id: 'c2', name: 'Preeti', email: 'preeti@example.com', email_opt_in_status: 'granted', consent_status: 'granted' },
    { id: 'c3', name: 'Rahul', email: 'rahul@example.com', email_opt_in_status: 'unconsented' },
    { id: 'c4', name: 'Sneha', email: 'optout@example.com', consent_status: 'granted', suppressed: true }
  ];

  await t.test('Supervisor dry run writes real bus rows and ends at awaiting_human_approval with 0 sends', async () => {
    const corrId = 'corr-supervisor-dryrun-01';
    const result = await runSupervisorWorkflow({
      workspaceId: wsId,
      correlationId: corrId,
      prompt: 'Send update about warehouse expansion',
      businessProfile: { businessName: 'Lakhotia Industrial', website: 'https://lakhotia.example.com', hasModel: true },
      contacts,
      approvalId: null // No human approval ID provided
    });

    assert.equal(result.status, 'awaiting_human_approval');
    assert.equal(result.sendsDispatched, 0, 'Must dispatch 0 sends before human approval');

    // Bus rows verification
    const messages = getMessages(wsId, corrId);
    assert.ok(messages.length >= 5, 'Every step must write a real row to the durable coordination bus');

    const researchMsg = messages.find(m => m.from_agent === 'supervisor_agent' && m.to_agent === 'research_agent');
    const audienceMsg = messages.find(m => m.from_agent === 'supervisor_agent' && m.to_agent === 'audience_agent');
    const contentMsg = messages.find(m => m.from_agent === 'supervisor_agent' && m.to_agent === 'content_agent');
    const complianceMsg = messages.find(m => m.from_agent === 'supervisor_agent' && m.to_agent === 'compliance_agent');
    const approvalMsg = messages.find(m => m.from_agent === 'supervisor_agent' && m.intent === 'awaiting_human_approval');

    assert.ok(researchMsg, 'Research step recorded on bus');
    assert.ok(audienceMsg, 'Audience step recorded on bus');
    assert.ok(contentMsg, 'Content step recorded on bus');
    assert.ok(complianceMsg, 'Compliance step recorded on bus');
    assert.ok(approvalMsg, 'Approval request recorded on bus');

    // Audience agent selected real eligible records only
    assert.equal(audienceMsg.payload.result.eligibleCount, 2, 'Only c1 and c2 are eligible');
  });

  await t.test('content_agent with no configured model returns NO_MODEL_CONFIGURED (no fabricated copy)', async () => {
    const origOpenAI = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const toolRes = await executeTool('generate_channel_copy', {
        channel: 'Email',
        businessName: 'NoModel Corp'
      }, {
        hasModel: false
      });

      assert.equal(toolRes.status, 'blocked');
      assert.equal(toolRes.code, 'NO_MODEL_CONFIGURED');
      assert.ok(toolRes.error.includes('No AI language model configured'));

      // Also verify via supervisor orchestrator
      const corrId = 'corr-nomodel-test';
      const supRes = await runSupervisorWorkflow({
        workspaceId: wsId,
        correlationId: corrId,
        prompt: 'Generate email copy',
        businessProfile: { businessName: 'NoModel Corp', hasModel: false },
        contacts
      });

      assert.equal(supRes.status, 'blocked');
      assert.equal(supRes.code, 'NO_MODEL_CONFIGURED');
      assert.equal(supRes.sendsDispatched, 0);
    } finally {
      if (origOpenAI) process.env.OPENAI_API_KEY = origOpenAI;
    }
  });

  await t.test('external_send tool without a server-verified approval ID is refused', async () => {
    // 1. Calling send_marketing_email without approvalId
    const resNoId = await executeTool('send_marketing_email', {
      recipients: ['test@example.com']
    }, {});
    assert.equal(resNoId.status, 'blocked');
    assert.equal(resNoId.code, 'HUMAN_APPROVAL_REQUIRED');

    // 2. Calling send_whatsapp_message with fake/unverified approvalId
    const resFakeId = await executeTool('send_whatsapp_message', {
      recipients: ['919999988888']
    }, {
      approvalId: 'fake_short'
    });
    assert.equal(resFakeId.status, 'blocked');
    assert.equal(resFakeId.code, 'HUMAN_APPROVAL_REQUIRED');

    // 3. Calling allocate_ad_spend (spend class) without approvalId
    const resSpend = await executeTool('allocate_ad_spend', {
      budget_inr: 50000
    }, {});
    assert.equal(resSpend.status, 'blocked');
    assert.equal(resSpend.code, 'HUMAN_APPROVAL_REQUIRED');
  });

  await t.test('compliance_agent rejects unapproved WhatsApp templates', async () => {
    const unapprovedRes = await executeTool('check_whatsapp_template_compliance', {
      template: { name: 'm360_draft_offer', status: 'PENDING' }
    });

    assert.equal(unapprovedRes.status, 'blocked');
    assert.equal(unapprovedRes.compliant, false);
    assert.equal(unapprovedRes.code, 'TEMPLATE_NOT_APPROVED');

    const approvedRes = await executeTool('check_whatsapp_template_compliance', {
      template: { name: 'm360_site_visit_invitation', status: 'APPROVED' }
    });
    assert.equal(approvedRes.status, 'success');
    assert.equal(approvedRes.data.compliant, true);
  });
});
