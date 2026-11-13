'use strict';

/**
 * Matrix360 Phase 6: Cross-Channel Analytics Data Layer
 * Strictly aggregates real stored events (campaign_outbox + webhook delivery events).
 * Unbreakable Rule: Never fabricate. Honest zeros only.
 */

const { RATES, GST_RATE } = require('./m360-rates');
const { getOutboxRows } = require('./m360-outbox-worker');
const {
  getWhatsAppCampaignResults,
  getAllWhatsAppCampaignResults
} = require('./m360-whatsapp-onboarding');
const {
  getEmailCampaignResults,
  getAllEmailCampaignResults
} = require('./m360-email-onboarding');
const { getWorkspaceMarketingTasks } = require('./m360-marketing-orchestrator');

const SAFETY_THRESHOLDS = {
  EMAIL_BOUNCE_RATE: 0.05,     // 5% max acceptable bounce rate
  EMAIL_COMPLAINT_RATE: 0.001, // 0.1% max acceptable complaint rate (industry standard)
  WHATSAPP_OPT_OUT_RATE: 0.03  // 3% max acceptable opt-out rate
};

/**
 * Calculates spend strictly from real dispatched message counts and rate table.
 * Displays provider costs and Matrix360 platform fee separately.
 */
function calculateSpend(whatsappSent = 0, emailSent = 0) {
  const waCount = Math.max(0, Number(whatsappSent) || 0);
  const emCount = Math.max(0, Number(emailSent) || 0);

  const waBaseRate = RATES.WhatsApp?.marketing || 0.8631;
  const emBaseRate = RATES.Email?.standard || 0.01;

  const waCost = Number((waCount * waBaseRate * (1 + GST_RATE)).toFixed(4));
  const emCost = Number((emCount * emBaseRate * (1 + GST_RATE)).toFixed(4));
  const providerCost = Number((waCost + emCost).toFixed(4));

  // Matrix360 fee is explicitly transparent and separate (currently 0 for direct provider billing)
  const matrix360Fee = 0.0000;
  const totalSpend = Number((providerCost + matrix360Fee).toFixed(4));

  return {
    currency: 'INR',
    whatsapp_provider_cost: waCost,
    email_provider_cost: emCost,
    total_provider_cost: providerCost,
    matrix360_platform_fee: matrix360Fee,
    total_spend: totalSpend,
    breakdown_transparent: {
      provider: providerCost,
      platform: matrix360Fee
    }
  };
}

/**
 * Evaluates delivery health against safety thresholds.
 */
function evaluateDeliveryHealth({ emailSent = 0, emailBounced = 0, emailComplained = 0, whatsappSent = 0, whatsappOptedOut = 0 } = {}) {
  const emSent = Math.max(0, Number(emailSent) || 0);
  const emBounced = Math.max(0, Number(emailBounced) || 0);
  const emComplained = Math.max(0, Number(emailComplained) || 0);
  const waSent = Math.max(0, Number(whatsappSent) || 0);
  const waOptedOut = Math.max(0, Number(whatsappOptedOut) || 0);

  const bounceRate = emSent > 0 ? emBounced / emSent : 0;
  const complaintRate = emSent > 0 ? emComplained / emSent : 0;
  const optOutRate = waSent > 0 ? waOptedOut / waSent : 0;

  const warnings = [];

  if (bounceRate > SAFETY_THRESHOLDS.EMAIL_BOUNCE_RATE) {
    warnings.push({
      metric: 'email_bounce_rate',
      rate: Number((bounceRate * 100).toFixed(2)),
      threshold: Number((SAFETY_THRESHOLDS.EMAIL_BOUNCE_RATE * 100).toFixed(2)),
      severity: 'WARNING',
      message: `Email bounce rate is high (${(bounceRate * 100).toFixed(2)}% > ${(SAFETY_THRESHOLDS.EMAIL_BOUNCE_RATE * 100).toFixed(1)}%). Immediate list hygiene required.`
    });
  }

  if (complaintRate > SAFETY_THRESHOLDS.EMAIL_COMPLAINT_RATE) {
    warnings.push({
      metric: 'email_complaint_rate',
      rate: Number((complaintRate * 100).toFixed(3)),
      threshold: Number((SAFETY_THRESHOLDS.EMAIL_COMPLAINT_RATE * 100).toFixed(2)),
      severity: 'WARNING',
      message: `Email spam complaint rate exceeded threshold (${(complaintRate * 100).toFixed(3)}% > ${(SAFETY_THRESHOLDS.EMAIL_COMPLAINT_RATE * 100).toFixed(2)}%). Risk of sender domain suspension.`
    });
  }

  if (optOutRate > SAFETY_THRESHOLDS.WHATSAPP_OPT_OUT_RATE) {
    warnings.push({
      metric: 'whatsapp_opt_out_rate',
      rate: Number((optOutRate * 100).toFixed(2)),
      threshold: Number((SAFETY_THRESHOLDS.WHATSAPP_OPT_OUT_RATE * 100).toFixed(2)),
      severity: 'WARNING',
      message: `WhatsApp opt-out rate is elevated (${(optOutRate * 100).toFixed(2)}% > ${(SAFETY_THRESHOLDS.WHATSAPP_OPT_OUT_RATE * 100).toFixed(1)}%). Review messaging frequency and relevance.`
    });
  }

  const totalDispatches = emSent + waSent;
  const status = warnings.length > 0 ? 'WARNING' : (totalDispatches === 0 ? 'HEALTHY' : 'HEALTHY');

  return {
    status,
    rates: {
      email_bounce_rate_pct: Number((bounceRate * 100).toFixed(2)),
      email_complaint_rate_pct: Number((complaintRate * 100).toFixed(3)),
      whatsapp_opt_out_rate_pct: Number((optOutRate * 100).toFixed(2))
    },
    warnings,
    is_warning: warnings.length > 0
  };
}

/**
 * Computes analytics for a single campaign strictly within the specified workspace.
 */
async function getCampaignAnalytics(workspaceId, campaignId) {
  if (!workspaceId) throw new Error('workspace_id is required');
  if (!campaignId) throw new Error('campaign_id is required');

  // Verify campaign belongs to workspace
  const tasks = getWorkspaceMarketingTasks(workspaceId);
  const task = tasks.find(t => t.correlation_id === campaignId);

  // Read outbox rows for this workspace and campaign
  const outboxRows = getOutboxRows(workspaceId, campaignId);

  // Read webhook delivery results for WhatsApp and Email
  const waResults = getWhatsAppCampaignResults(workspaceId, campaignId);
  const emResults = getEmailCampaignResults(workspaceId, campaignId);

  // If task doesn't exist and there are no outbox rows and no webhook results, return null
  const hasData = task || outboxRows.length > 0 || waResults.events?.length > 0 || emResults.events?.length > 0;
  if (!hasData) {
    return null;
  }

  // Aggregate WhatsApp metrics:
  // Outbox sent count: provider_accepted or sent status
  const waOutboxAccepted = outboxRows.filter(r => r.channel === 'whatsapp' && (r.status === 'provider_accepted' || r.status === 'sent')).length;
  const waOutboxFailed = outboxRows.filter(r => r.channel === 'whatsapp' && r.status === 'failed').length;

  const waSentIds = new Set(
    waResults.events
      .filter(e => ['sent', 'delivered', 'read', 'replied', 'failed', 'opted_out'].includes(e.status))
      .map(e => e.messageId)
      .filter(Boolean)
  );
  const whatsappSent = Math.max(waOutboxAccepted, waResults.dispatched || 0, waSentIds.size);
  const whatsappDelivered = waResults.delivered || 0;
  const whatsappRead = waResults.read || 0;
  const whatsappReplied = waResults.replied || 0;
  const whatsappFailed = Math.max(waOutboxFailed, waResults.failed || 0);
  const whatsappOptedOut = waResults.opted_out || 0;

  // Aggregate Email metrics:
  const emOutboxAccepted = outboxRows.filter(r => r.channel === 'email' && (r.status === 'provider_accepted' || r.status === 'sent')).length;
  const emOutboxFailed = outboxRows.filter(r => r.channel === 'email' && r.status === 'failed').length;

  const emSentIds = new Set(
    emResults.events
      .filter(e => ['sent', 'delivered', 'opened', 'open', 'clicked', 'click', 'bounced', 'bounce', 'complained', 'complaint', 'unsubscribed'].includes(e.status))
      .map(e => e.messageId)
      .filter(Boolean)
  );
  const emailSent = Math.max(emOutboxAccepted, emResults.dispatched || 0, emSentIds.size);
  const emailDelivered = emResults.delivered || 0;
  const emailOpened = emResults.opened || 0;
  const emailClicked = emResults.clicked || 0;
  const emailBounced = emResults.bounced || 0;
  const emailComplained = emResults.complained || 0;
  const emailUnsubscribed = emResults.unsubscribed || 0;

  const spend = calculateSpend(whatsappSent, emailSent);
  const health = evaluateDeliveryHealth({
    emailSent,
    emailBounced,
    emailComplained,
    whatsappSent,
    whatsappOptedOut
  });

  return {
    workspace_id: workspaceId,
    campaign_id: campaignId,
    campaign_name: task?.project || task?.prompt || campaignId,
    channels: {
      whatsapp: {
        sent: whatsappSent,
        delivered: whatsappDelivered,
        read: whatsappRead,
        replied: whatsappReplied,
        failed: whatsappFailed,
        opted_out: whatsappOptedOut
      },
      email: {
        sent: emailSent,
        delivered: emailDelivered,
        opened: emailOpened,
        clicked: emailClicked,
        bounced: emailBounced,
        complained: emailComplained,
        unsubscribed: emailUnsubscribed
      }
    },
    spend,
    delivery_health: health,
    total_messages_sent: whatsappSent + emailSent,
    generated_at: new Date().toISOString()
  };
}

/**
 * Computes workspace-wide cross-channel analytics.
 * Strictly respects workspace isolation.
 */
async function getWorkspaceAnalytics(workspaceId) {
  if (!workspaceId) throw new Error('workspace_id is required');

  const tasks = getWorkspaceMarketingTasks(workspaceId);
  const outboxRows = getOutboxRows(workspaceId);
  const waCampaignResults = getAllWhatsAppCampaignResults(workspaceId);
  const emCampaignResults = getAllEmailCampaignResults(workspaceId);

  // Collect all unique campaign IDs for this workspace
  const campaignIdSet = new Set();
  for (const t of tasks) if (t.correlation_id) campaignIdSet.add(t.correlation_id);
  for (const r of outboxRows) if (r.campaign_id) campaignIdSet.add(r.campaign_id);
  for (const w of waCampaignResults) if (w.correlation_id) campaignIdSet.add(w.correlation_id);
  for (const e of emCampaignResults) if (e.correlation_id) campaignIdSet.add(e.correlation_id);

  const campaignSummaries = [];
  let totalWaSent = 0, totalWaDelivered = 0, totalWaRead = 0, totalWaReplied = 0, totalWaFailed = 0, totalWaOptedOut = 0;
  let totalEmSent = 0, totalEmDelivered = 0, totalEmOpened = 0, totalEmClicked = 0, totalEmBounced = 0, totalEmComplained = 0, totalEmUnsubscribed = 0;

  for (const campId of campaignIdSet) {
    const campAnalytics = await getCampaignAnalytics(workspaceId, campId);
    if (!campAnalytics) continue;

    campaignSummaries.push(campAnalytics);

    totalWaSent += campAnalytics.channels.whatsapp.sent;
    totalWaDelivered += campAnalytics.channels.whatsapp.delivered;
    totalWaRead += campAnalytics.channels.whatsapp.read;
    totalWaReplied += campAnalytics.channels.whatsapp.replied;
    totalWaFailed += campAnalytics.channels.whatsapp.failed;
    totalWaOptedOut += campAnalytics.channels.whatsapp.opted_out;

    totalEmSent += campAnalytics.channels.email.sent;
    totalEmDelivered += campAnalytics.channels.email.delivered;
    totalEmOpened += campAnalytics.channels.email.opened;
    totalEmClicked += campAnalytics.channels.email.clicked;
    totalEmBounced += campAnalytics.channels.email.bounced;
    totalEmComplained += campAnalytics.channels.email.complained;
    totalEmUnsubscribed += campAnalytics.channels.email.unsubscribed;
  }

  const spend = calculateSpend(totalWaSent, totalEmSent);
  const health = evaluateDeliveryHealth({
    emailSent: totalEmSent,
    emailBounced: totalEmBounced,
    emailComplained: totalEmComplained,
    whatsappSent: totalWaSent,
    whatsappOptedOut: totalWaOptedOut
  });

  return {
    workspace_id: workspaceId,
    overview: {
      channels: {
        whatsapp: {
          sent: totalWaSent,
          delivered: totalWaDelivered,
          read: totalWaRead,
          replied: totalWaReplied,
          failed: totalWaFailed,
          opted_out: totalWaOptedOut
        },
        email: {
          sent: totalEmSent,
          delivered: totalEmDelivered,
          opened: totalEmOpened,
          clicked: totalEmClicked,
          bounced: totalEmBounced,
          complained: totalEmComplained,
          unsubscribed: totalEmUnsubscribed
        }
      },
      total_messages_sent: totalWaSent + totalEmSent,
      spend,
      delivery_health: health
    },
    campaign_count: campaignSummaries.length,
    campaigns: campaignSummaries,
    has_activity: (totalWaSent + totalEmSent) > 0,
    generated_at: new Date().toISOString()
  };
}

module.exports = {
  SAFETY_THRESHOLDS,
  calculateSpend,
  evaluateDeliveryHealth,
  getCampaignAnalytics,
  getWorkspaceAnalytics
};
