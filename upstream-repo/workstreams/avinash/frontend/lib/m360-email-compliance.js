'use strict';

const dns = require('node:dns/promises');
const { recordSuppression } = require('./m360-consent');

const SOFT_BOUNCES = new Map();
const WORKSPACE_STATS = new Map();

const DEFAULT_LEGAL_ENTITY = 'Lakhotia Industrial Park Private Limited';
const DEFAULT_POSTAL_ADDRESS = '101 Industrial Estate, NH-6, Howrah, West Bengal 711302, India';
const DEFAULT_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://matrix360.io';

function buildUnsubscribeUrls(email, workspaceId = 'default') {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const base = DEFAULT_APP_URL.replace(/\/$/, '');
  const url = `${base}/api/marketing/unsubscribe?email=${encodeURIComponent(cleanEmail)}&workspace_id=${encodeURIComponent(workspaceId)}`;
  const mailto = `mailto:unsubscribe@matrix360.io?subject=unsubscribe:${encodeURIComponent(cleanEmail)}`;
  return { url, mailto };
}

function renderComplianceFooter({
  email,
  workspaceId = 'default',
  legalName = DEFAULT_LEGAL_ENTITY,
  postalAddress = DEFAULT_POSTAL_ADDRESS,
  privacyUrl = `${DEFAULT_APP_URL}/privacy`,
  termsUrl = `${DEFAULT_APP_URL}/terms`
} = {}) {
  const { url: unsubUrl } = buildUnsubscribeUrls(email, workspaceId);

  const html = `
<div class="m360-compliance-footer" style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b;line-height:1.5;">
  <p style="margin:0 0 8px 0;"><strong>${legalName}</strong><br>${postalAddress}</p>
  <p style="margin:0 0 8px 0;">You received this communication because you expressed interest or consented to updates regarding our commercial and industrial opportunities.</p>
  <p style="margin:0;">
    <a href="${unsubUrl}" style="color:#0284c7;text-decoration:underline;">Unsubscribe</a> &bull;
    <a href="${privacyUrl}" style="color:#64748b;text-decoration:underline;">Privacy Policy</a> &bull;
    <a href="${termsUrl}" style="color:#64748b;text-decoration:underline;">Terms</a>
  </p>
</div>`;

  const text = `
---
${legalName}
${postalAddress}
You received this communication because you expressed interest or consented to updates regarding our commercial and industrial opportunities.
Unsubscribe: ${unsubUrl}
Privacy: ${privacyUrl} | Terms: ${termsUrl}`;

  return { html, text, unsubUrl };
}

function renderPreamble({ senderName, businessName = 'Matrix 360' } = {}) {
  const name = senderName || businessName;
  return `This is a verified commercial communication from ${name} regarding commercial properties and services.`;
}

/**
 * Handles Brevo delivery & complaint webhook events:
 * - hard_bounce + complaint -> suppress immediately
 * - soft_bounce -> suppress after 3
 * - checks complaint rate (> 0.3% -> pause workspace)
 */
async function handleBrevoWebhookEvent(eventPayload = {}) {
  const rawEvent = String(eventPayload.event || eventPayload['event'] || '').toLowerCase();
  const email = String(eventPayload.email || eventPayload['email'] || '').trim().toLowerCase();
  const workspaceId = String(eventPayload.workspace_id || 'default').trim();

  if (!email) return { processed: false, reason: 'missing_email' };

  // Update workspace send/complaint counters
  const stats = WORKSPACE_STATS.get(workspaceId) || { totalSends: 0, complaints: 0, paused: false };
  if (rawEvent === 'request' || rawEvent === 'delivered') {
    stats.totalSends += 1;
    WORKSPACE_STATS.set(workspaceId, stats);
  }

  // 1. Hard bounce or spam complaint -> immediate suppression
  if (['hard_bounce', 'spam', 'complaint'].includes(rawEvent)) {
    stats.complaints += 1;

    await recordSuppression(workspaceId, {
      email,
      channel: 'email',
      reason: rawEvent === 'hard_bounce' ? 'hard_bounce' : 'spam_complaint',
      source: 'brevo_webhook'
    });

    // Check complaint rate threshold (0.3% = 0.003)
    const complaintRate = stats.totalSends > 0 ? (stats.complaints / stats.totalSends) : 1.0;
    if (complaintRate > 0.003) {
      stats.paused = true;
    }
    WORKSPACE_STATS.set(workspaceId, stats);

    return { processed: true, action: 'suppressed_immediate', event: rawEvent, email, workspacePaused: stats.paused };
  }

  // 2. Soft bounce: suppress after 3 occurrences
  if (rawEvent === 'soft_bounce') {
    const key = `${workspaceId}:${email}`;
    const count = (SOFT_BOUNCES.get(key) || 0) + 1;
    SOFT_BOUNCES.set(key, count);

    if (count >= 3) {
      await recordSuppression(workspaceId, {
        email,
        channel: 'email',
        reason: 'soft_bounce_threshold_exceeded',
        source: 'brevo_webhook'
      });
      return { processed: true, action: 'suppressed_soft_bounce_threshold', count, email };
    }
    return { processed: true, action: 'soft_bounce_recorded', count, email };
  }

  return { processed: true, action: 'event_recorded', event: rawEvent };
}

function isWorkspaceMarketingPaused(workspaceId = 'default') {
  return Boolean(WORKSPACE_STATS.get(workspaceId)?.paused);
}

/**
 * Domain-readiness verification: checks SPF, DKIM, and DMARC TXT records
 */
async function verifyDomainDnsReadiness(domain) {
  const normDomain = String(domain || '').trim().toLowerCase();
  if (!normDomain || !normDomain.includes('.')) {
    return { aligned: false, spf: false, dkim: false, dmarc: false, bulkSendingAllowed: false, reason: 'INVALID_DOMAIN' };
  }

  let spf = false;
  let dmarc = false;
  let dkim = false;

  try {
    // 1. SPF check on root domain
    const rootTxt = await dns.resolveTxt(normDomain).catch(() => []);
    const flatRoot = rootTxt.flat().join(' ');
    spf = flatRoot.includes('v=spf1');

    // 2. DMARC check at _dmarc.<domain>
    const dmarcTxt = await dns.resolveTxt(`_dmarc.${normDomain}`).catch(() => []);
    const flatDmarc = dmarcTxt.flat().join(' ');
    dmarc = flatDmarc.includes('v=DMARC1');

    // 3. DKIM selector check (e.g. mail._domainkey or brevo._domainkey)
    const dkimSelectors = ['mail._domainkey.', 'brevo._domainkey.', 'smtp._domainkey.', 'k1._domainkey.'];
    for (const sel of dkimSelectors) {
      const records = await dns.resolveTxt(`${sel}${normDomain}`).catch(() => []);
      if (records.flat().join(' ').includes('v=DKIM1') || records.length > 0) {
        dkim = true;
        break;
      }
    }
  } catch (_) {}

  // If testing with mock domains or local test, fallback to configurable or true
  const aligned = Boolean(spf && dmarc);
  const bulkSendingAllowed = aligned && dkim;

  return {
    domain: normDomain,
    spf,
    dmarc,
    dkim,
    aligned,
    bulkSendingAllowed,
    maxDailyToMajorBulk: bulkSendingAllowed ? 100000 : 5000
  };
}

function resetComplianceStateForTests() {
  SOFT_BOUNCES.clear();
  WORKSPACE_STATS.clear();
}

module.exports = {
  buildUnsubscribeUrls,
  renderComplianceFooter,
  renderPreamble,
  handleBrevoWebhookEvent,
  isWorkspaceMarketingPaused,
  verifyDomainDnsReadiness,
  resetComplianceStateForTests,
  DEFAULT_LEGAL_ENTITY,
  DEFAULT_POSTAL_ADDRESS
};
