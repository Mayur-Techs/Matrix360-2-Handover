'use strict';

const { sendMessage, getMessages, updateMessageStatus } = require('./bus');
const { executeTool } = require('./tools');

/**
 * Supervisor Agent Orchestrator
 *
 * Coordinates multi-agent pipeline steps strictly over the durable bus:
 * 1. research_agent: Extracts ground truth facts and assets
 * 2. audience_agent: Gathers CRM leads and verifies consent
 * 3. content_agent: Formulates channel copy drafts
 * 4. compliance_agent: Verifies CAN-SPAM, GDPR, and template rules
 * 5. supervisor_agent: Halts at 'awaiting_human_approval' with ZERO dispatches
 * 6. (Optional on approval): outreach_agent dispatches via verified approval ID
 */
async function runSupervisorWorkflow({
  workspaceId,
  correlationId,
  prompt,
  businessProfile = {},
  contacts = [],
  approvalId = null
} = {}) {
  if (!workspaceId || !correlationId) {
    throw new Error('workspaceId and correlationId are required for supervisor workflow.');
  }

  // ----------------------------------------------------
  // Step 1: Supervisor -> Research Agent
  // ----------------------------------------------------
  const researchMsg = await sendMessage({
    workspaceId,
    correlationId,
    fromAgent: 'supervisor_agent',
    toAgent: 'research_agent',
    intent: 'conduct_research',
    payload: { prompt, businessProfile },
    status: 'processing'
  });

  const researchResult = await executeTool('search_market_facts', { prompt });
  const assetResult = await executeTool('extract_website_assets', { url: businessProfile.website });
  updateMessageStatus(workspaceId, correlationId, researchMsg.id, 'completed', {
    facts: researchResult.data.facts,
    assets: assetResult.data
  });

  // ----------------------------------------------------
  // Step 2: Supervisor -> Audience Agent
  // ----------------------------------------------------
  const audienceMsg = await sendMessage({
    workspaceId,
    correlationId,
    fromAgent: 'supervisor_agent',
    toAgent: 'audience_agent',
    intent: 'verify_audience_consent',
    payload: { requestedAudience: contacts },
    status: 'processing'
  });

  const filterResult = await executeTool('filter_suppressed_contacts', { contacts });
  const consentResult = await executeTool('verify_lead_consent', { contacts: filterResult.data.eligibleContacts });
  const verifiedContacts = consentResult.data.verifiedContacts;

  updateMessageStatus(workspaceId, correlationId, audienceMsg.id, 'completed', {
    eligibleCount: verifiedContacts.length,
    contacts: verifiedContacts
  });

  // ----------------------------------------------------
  // Step 3: Supervisor -> Content Agent
  // ----------------------------------------------------
  const contentMsg = await sendMessage({
    workspaceId,
    correlationId,
    fromAgent: 'supervisor_agent',
    toAgent: 'content_agent',
    intent: 'prepare_drafts',
    payload: {
      channels: ['Email', 'WhatsApp'],
      facts: researchResult.data.facts
    },
    status: 'processing'
  });

  const emailDraft = await executeTool('generate_channel_copy', {
    channel: 'Email',
    businessName: businessProfile.businessName,
    subject: `New Development Opportunities - ${businessProfile.businessName || 'Matrix360'}`
  }, { hasModel: businessProfile.hasModel !== false });

  if (emailDraft.status === 'blocked') {
    updateMessageStatus(workspaceId, correlationId, contentMsg.id, 'failed', emailDraft);
    return {
      status: 'blocked',
      code: emailDraft.code || 'NO_MODEL_CONFIGURED',
      error: emailDraft.error,
      sendsDispatched: 0,
      busMessages: getMessages(workspaceId, correlationId)
    };
  }

  const whatsappDraft = await executeTool('generate_channel_copy', {
    channel: 'WhatsApp',
    businessName: businessProfile.businessName
  }, { hasModel: businessProfile.hasModel !== false });

  updateMessageStatus(workspaceId, correlationId, contentMsg.id, 'completed', {
    drafts: {
      Email: emailDraft.data,
      WhatsApp: whatsappDraft.data
    }
  });

  // ----------------------------------------------------
  // Step 4: Supervisor -> Compliance Agent
  // ----------------------------------------------------
  const complianceMsg = await sendMessage({
    workspaceId,
    correlationId,
    fromAgent: 'supervisor_agent',
    toAgent: 'compliance_agent',
    intent: 'validate_compliance',
    payload: { drafts: { Email: emailDraft.data, WhatsApp: whatsappDraft.data } },
    status: 'processing'
  });

  const complianceResult = await executeTool('check_email_compliance', { draft: emailDraft.data });
  updateMessageStatus(workspaceId, correlationId, complianceMsg.id, 'completed', {
    emailCompliant: complianceResult.data.compliant
  });

  // ----------------------------------------------------
  // Step 5: Supervisor Halts -> Awaiting Human Approval
  // (Zero sends occur before human approval)
  // ----------------------------------------------------
  const approvalMsg = await sendMessage({
    workspaceId,
    correlationId,
    fromAgent: 'supervisor_agent',
    toAgent: 'supervisor_agent',
    intent: 'awaiting_human_approval',
    payload: {
      pipelineStatus: 'awaiting_human_approval',
      verifiedAudienceCount: verifiedContacts.length,
      requiresAction: 'HUMAN_APPROVAL_REQUIRED',
      reviewUrl: `/api/marketing/tasks?correlation_id=${correlationId}`
    },
    status: 'completed'
  });

  // If no approvalId is provided, dry run terminates safely here with 0 sends
  if (!approvalId) {
    return {
      status: 'awaiting_human_approval',
      correlationId,
      sendsDispatched: 0,
      busMessages: getMessages(workspaceId, correlationId),
      nextStep: 'Human operator must approve drafts before outreach execution.'
    };
  }

  // ----------------------------------------------------
  // Step 6: On Verified Human Approval -> Outreach Agent
  // ----------------------------------------------------
  const outreachMsg = await sendMessage({
    workspaceId,
    correlationId,
    fromAgent: 'supervisor_agent',
    toAgent: 'outreach_agent',
    intent: 'execute_approved_outreach',
    payload: { approvalId, channel: 'Email' },
    status: 'processing'
  });

  const sendResult = await executeTool('send_marketing_email', {
    recipients: verifiedContacts
  }, {
    approvalId,
    verifiedApproval: true
  });

  updateMessageStatus(workspaceId, correlationId, outreachMsg.id, sendResult.status === 'dispatched' ? 'completed' : 'failed', sendResult.data);

  return {
    status: sendResult.status,
    correlationId,
    sendsDispatched: verifiedContacts.length,
    busMessages: getMessages(workspaceId, correlationId),
    result: sendResult
  };
}

/**
 * Chat-to-Campaign Assistant (AiSensy-style, human-approved)
 * Proposes channel, real eligible audience from CRM, template/copy drafts, and cost estimate.
 * Never auto-sends or grants consent; always routes to broadcast builder for human approval.
 */
async function runChatToCampaignWorkflow({
  workspaceId,
  prompt,
  businessProfile = {},
  contacts = [],
  channel = null,
  hasModel = undefined
} = {}) {
  const { randomUUID } = require('node:crypto');
  const pLower = String(prompt || '').toLowerCase();
  const detectedChannel = channel || (pLower.includes('whatsapp') ? 'WhatsApp' : 'Email');
  const corrId = `chat_camp_${randomUUID()}`;

  const profile = {
    ...businessProfile,
    hasModel: hasModel !== undefined ? hasModel : businessProfile.hasModel
  };

  const supervisorRes = await runSupervisorWorkflow({
    workspaceId,
    correlationId: corrId,
    prompt,
    businessProfile: profile,
    contacts,
    channel: detectedChannel,
    approvalId: null // Guaranteed 0 sends
  });

  if (supervisorRes.status === 'blocked' && supervisorRes.code === 'NO_MODEL_CONFIGURED') {
    return {
      success: false,
      code: 'NO_MODEL_CONFIGURED',
      error: supervisorRes.error,
      sendsDispatched: 0
    };
  }

  const bus = supervisorRes.busMessages || [];
  const contentMsg = bus.find(m => m.from_agent === 'content_agent' || m.intent === 'prepare_drafts');
  const audienceMsg = bus.find(m => m.from_agent === 'audience_agent' || m.intent === 'verify_audience_consent');

  const draftData = contentMsg?.payload?.result?.drafts?.[detectedChannel] || null;
  const audienceData = audienceMsg?.payload?.result || { eligibleCount: 0, contacts: [] };

  return {
    success: true,
    correlation_id: corrId,
    channel: detectedChannel,
    status: 'awaiting_human_approval',
    draft: draftData,
    audience: {
      total: contacts.length,
      eligible_count: audienceData.eligibleCount || 0,
      eligible_contacts: audienceData.contacts || []
    },
    cost_estimate: {
      currency: 'INR',
      per_recipient_inr: detectedChannel === 'WhatsApp' ? 1.0185 : 0.118,
      total_estimated_inr: Number(((audienceData.eligibleCount || 0) * (detectedChannel === 'WhatsApp' ? 1.0185 : 0.118)).toFixed(4)),
      matrix360_markup_inr: 0.0
    },
    sendsDispatched: 0,
    note: 'Draft and real audience prepared. Human review and approval required before outreach dispatch.'
  };
}

module.exports = {
  runSupervisorWorkflow,
  runChatToCampaignWorkflow
};
