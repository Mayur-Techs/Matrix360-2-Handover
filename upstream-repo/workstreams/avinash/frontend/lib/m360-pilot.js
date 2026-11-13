'use strict';

/**
 * Matrix360 Phase 6: Guided One-Client Pilot Flow Runner
 * Walks a client through end-to-end pilot with mandatory human approval and hard audience cap (<= 20).
 * Unbreakable Rules: Never fabricate. Never bypass approval gate.
 */

const { randomUUID, createHash } = require('node:crypto');
const { getWhatsAppOnboardingRecord } = require('./m360-whatsapp-onboarding');
const { getEmailOnboardingRecord } = require('./m360-email-onboarding');
const { isSuppressed, isEligible } = require('./m360-consent');
const {
  snapshotAudienceToOutbox,
  processOutboxBatch,
  getOutboxRows
} = require('./m360-outbox-worker');
const { getCampaignAnalytics } = require('./m360-analytics');

const MAX_PILOT_AUDIENCE_SIZE = 20;

// In-memory approval and campaign state store for pilot
const PILOT_APPROVALS = new Map();
const PILOT_CAMPAIGNS = new Map();

function resetPilotStateForTests() {
  PILOT_APPROVALS.clear();
  PILOT_CAMPAIGNS.clear();
}

/**
 * Step 1: Channel Connect Status
 */
async function getPilotConnectionStatus(workspaceId) {
  if (!workspaceId) throw new Error('workspace_id is required');

  const waRecord = getWhatsAppOnboardingRecord(workspaceId) || { state: 'not_started' };
  const emRecord = getEmailOnboardingRecord(workspaceId) || { state: 'not_started' };

  const waReady = ['ready_limited', 'verified'].includes(waRecord.state);
  const emReady = ['ready_limited', 'verified'].includes(emRecord.state);

  return {
    workspace_id: workspaceId,
    channels: {
      whatsapp: {
        state: waRecord.state,
        ready: waReady,
        phone_number_id: waRecord.phone_number_id || null,
        display_phone_number: waRecord.display_phone_number || null,
        verified_name: waRecord.verified_name || null,
        next_action: waRecord.next_action || (waReady ? 'Ready to send templates' : 'Complete Embedded Signup')
      },
      email: {
        state: emRecord.state,
        ready: emReady,
        sender_domain: emRecord.sender_domain || null,
        from_address: emRecord.from_address || null,
        dns_status: {
          spf: emRecord.spf_ok === true,
          dkim: emRecord.dkim_ok === true,
          dmarc: emRecord.dmarc_ok === true
        },
        next_action: emReady ? 'Ready for test delivery' : 'Verify DNS TXT records'
      }
    },
    pilot_ready: waReady || emReady
  };
}

/**
 * Step 2: Audience Import with hard <= 20 cap and consent checks
 */
async function importPilotAudience({ workspaceId, campaignId, contacts = [] } = {}) {
  if (!workspaceId) throw new Error('workspace_id is required');
  if (!campaignId) throw new Error('campaign_id is required');

  if (!Array.isArray(contacts)) {
    throw Object.assign(new Error('contacts must be an array'), { code: 'INVALID_AUDIENCE' });
  }

  // Hard Cap Enforcement: <= 20 recipients
  if (contacts.length > MAX_PILOT_AUDIENCE_SIZE) {
    throw Object.assign(
      new Error(`Pilot audience size of ${contacts.length} exceeds maximum limit of ${MAX_PILOT_AUDIENCE_SIZE}.`),
      { code: 'PILOT_AUDIENCE_EXCEEDED', max_allowed: MAX_PILOT_AUDIENCE_SIZE }
    );
  }

  const eligible = [];
  const suppressed = [];

  for (const c of contacts) {
    if (!c) continue;
    const email = String(c.email || '').trim().toLowerCase();
    const phone = String(c.phone || c.whatsapp || '').replace(/[^\d+]/g, '');

    const contactId = c.id || email || phone || randomUUID();
    const contactObj = {
      id: contactId,
      name: c.name || '',
      email: email || null,
      phone: phone || null,
      company: c.company || c.company_name || ''
    };

    // Check suppression
    const isEmailSuppressed = email ? isSuppressed(workspaceId, email, 'email') : false;
    const isWaSuppressed = phone ? isSuppressed(workspaceId, phone, 'whatsapp') : false;

    if (isEmailSuppressed || isWaSuppressed || c.suppressed === true) {
      suppressed.push({ ...contactObj, reason: 'SUPPRESSED_OR_OPTED_OUT' });
    } else {
      eligible.push(contactObj);
    }
  }

  const campKey = `${workspaceId}:${campaignId}`;
  const existing = PILOT_CAMPAIGNS.get(campKey) || { workspace_id: workspaceId, campaign_id: campaignId };
  existing.audience = eligible;
  existing.suppressed = suppressed;
  existing.audience_updated_at = new Date().toISOString();
  PILOT_CAMPAIGNS.set(campKey, existing);

  return {
    workspace_id: workspaceId,
    campaign_id: campaignId,
    total_received: contacts.length,
    eligible_count: eligible.length,
    suppressed_count: suppressed.length,
    eligible_contacts: eligible,
    cap_enforced: true,
    max_cap: MAX_PILOT_AUDIENCE_SIZE
  };
}

/**
 * Step 3: AI Campaign Drafting / Template Preview
 */
async function draftPilotCampaign({ workspaceId, campaignId, channel = 'WhatsApp', templateName, subject, body } = {}) {
  if (!workspaceId) throw new Error('workspace_id is required');
  if (!campaignId) throw new Error('campaign_id is required');

  const normChannel = String(channel).trim().toLowerCase();
  let draftSubject = String(subject || '').trim();
  let draftBody = String(body || '').trim();
  let draftTemplate = String(templateName || '').trim();

  if (normChannel === 'whatsapp' && !draftTemplate) {
    draftTemplate = 'marketing_starter_v1';
    draftBody = draftBody || 'Hello {{1}}, explore Matrix360 commercial opportunities. Reply STOP to opt out.';
  } else if (normChannel === 'email' && !draftSubject) {
    draftSubject = 'Exclusive Pilot Invitation — Matrix360';
    draftBody = draftBody || 'Hi {{name}},\n\nWelcome to the Matrix360 pilot. Click here to unsubscribe.';
  }

  const contentToHash = `${normChannel}:${draftTemplate}:${draftSubject}:${draftBody}`;
  const versionHash = 'draft_' + createHash('sha256').update(contentToHash).digest('hex').slice(0, 12);

  const draft = {
    version: 1,
    version_hash: versionHash,
    channel: normChannel,
    template_name: draftTemplate || null,
    subject: draftSubject || null,
    body: draftBody,
    created_at: new Date().toISOString()
  };

  const campKey = `${workspaceId}:${campaignId}`;
  const existing = PILOT_CAMPAIGNS.get(campKey) || { workspace_id: workspaceId, campaign_id: campaignId };
  existing.draft = draft;
  existing.draft_updated_at = new Date().toISOString();
  PILOT_CAMPAIGNS.set(campKey, existing);

  return {
    workspace_id: workspaceId,
    campaign_id: campaignId,
    draft,
    preview: {
      channel: normChannel,
      template_name: draft.template_name,
      subject: draft.subject,
      sample_body: draft.body.replace('{{1}}', 'Alex').replace('{{name}}', 'Alex')
    }
  };
}

/**
 * Step 4: Human Approval Gate
 * Server issues cryptographic approval ID appr_...; cannot send without this ID.
 */
async function approvePilotDraft({ workspaceId, campaignId, versionHash, approvedBy = 'client_admin' } = {}) {
  if (!workspaceId) throw new Error('workspace_id is required');
  if (!campaignId) throw new Error('campaign_id is required');
  if (!versionHash) throw new Error('version_hash is required for approval');

  const campKey = `${workspaceId}:${campaignId}`;
  const campaign = PILOT_CAMPAIGNS.get(campKey);
  if (!campaign || !campaign.draft) {
    throw Object.assign(new Error('No draft found to approve for this campaign.'), { code: 'DRAFT_NOT_FOUND' });
  }

  if (campaign.draft.version_hash !== versionHash) {
    throw Object.assign(new Error('Version hash mismatch. You must approve the latest draft version.'), { code: 'VERSION_MISMATCH' });
  }

  const approvalId = 'appr_' + randomUUID().replace(/-/g, '').slice(0, 16);
  const approvalRecord = {
    approval_id: approvalId,
    workspace_id: workspaceId,
    campaign_id: campaignId,
    version_hash: versionHash,
    approved_by: approvedBy,
    approved_at: new Date().toISOString()
  };

  PILOT_APPROVALS.set(campKey, approvalRecord);
  campaign.approval = approvalRecord;
  PILOT_CAMPAIGNS.set(campKey, campaign);

  return {
    success: true,
    approval_id: approvalId,
    approved_at: approvalRecord.approved_at,
    approved_by: approvedBy,
    version_hash: versionHash,
    message: 'Draft approved. Ready for controlled pilot dispatch.'
  };
}

/**
 * Step 5 & 6: Dispatch Pilot Campaign with Gate Checks
 */
async function dispatchPilotCampaign({
  workspaceId,
  campaignId,
  approvalId,
  mode = 'team_test',
  clientConfirmed = false,
  testRecipients = [],
  emailAdapter,
  whatsAppAdapter
} = {}) {
  if (!workspaceId) throw new Error('workspace_id is required');
  if (!campaignId) throw new Error('campaign_id is required');

  const campKey = `${workspaceId}:${campaignId}`;
  const campaign = PILOT_CAMPAIGNS.get(campKey);
  if (!campaign || !campaign.draft) {
    throw Object.assign(new Error('Campaign or draft not found.'), { code: 'CAMPAIGN_NOT_FOUND' });
  }

  // Mandatory Gate: Verify Human Approval
  const approval = PILOT_APPROVALS.get(campKey);
  if (!approval || !approvalId || approval.approval_id !== approvalId) {
    throw Object.assign(
      new Error('APPROVAL_REQUIRED: Human approval is mandatory before dispatching pilot campaign.'),
      { code: 'APPROVAL_REQUIRED' }
    );
  }

  // Hard Cap: Ensure audience <= 20
  const contacts = campaign.audience || [];
  if (contacts.length === 0) {
    throw Object.assign(new Error('Pilot audience is empty. Please import eligible contacts.'), { code: 'EMPTY_AUDIENCE' });
  }
  if (contacts.length > MAX_PILOT_AUDIENCE_SIZE) {
    throw Object.assign(
      new Error(`Pilot audience size (${contacts.length}) exceeds safety cap of ${MAX_PILOT_AUDIENCE_SIZE}.`),
      { code: 'PILOT_AUDIENCE_EXCEEDED' }
    );
  }

  // Mode Selection Security Gate:
  let effectiveMode = 'team_test';
  if (mode === 'live') {
    const isLiveAllowed = process.env.M360_MARKETING_MODE === 'live';
    if (!isLiveAllowed) {
      throw Object.assign(
        new Error('Live dispatch blocked: M360_MARKETING_MODE is not configured to live.'),
        { code: 'LIVE_MODE_BLOCKED' }
      );
    }
    if (clientConfirmed !== true) {
      throw Object.assign(
        new Error('Live dispatch requires explicit client confirmation: "I understand real messages will go to external contacts."'),
        { code: 'CONFIRMATION_REQUIRED' }
      );
    }
    effectiveMode = 'live';
  }

  // Snapshot to outbox
  await snapshotAudienceToOutbox({
    workspaceId,
    correlationId: campaignId,
    channel: campaign.draft.channel,
    draftVersion: campaign.draft,
    contacts,
    mode: effectiveMode
  });

  // Process dispatch via outbox batch
  const dispatchResults = await processOutboxBatch({
    workspaceId,
    correlationId: campaignId,
    channel: campaign.draft.channel,
    emailAdapter,
    whatsAppAdapter,
    mode: effectiveMode,
    testRecipients,
    limit: MAX_PILOT_AUDIENCE_SIZE
  });

  const acceptedCount = dispatchResults.filter(r => r.status === 'provider_accepted').length;
  const skippedCount = dispatchResults.filter(r => r.status === 'skipped').length;
  const failedCount = dispatchResults.filter(r => r.status === 'failed').length;

  return {
    success: true,
    workspace_id: workspaceId,
    campaign_id: campaignId,
    mode: effectiveMode,
    approval_id: approvalId,
    total_recipients: contacts.length,
    dispatched_count: acceptedCount,
    skipped_count: skippedCount,
    failed_count: failedCount,
    results: dispatchResults.map(r => ({
      contact_id: r.contact_id,
      status: r.status,
      provider_message_id: r.provider_message_id || null,
      last_error: r.last_error || null
    }))
  };
}

module.exports = {
  MAX_PILOT_AUDIENCE_SIZE,
  resetPilotStateForTests,
  getPilotConnectionStatus,
  importPilotAudience,
  draftPilotCampaign,
  approvePilotDraft,
  dispatchPilotCampaign
};
