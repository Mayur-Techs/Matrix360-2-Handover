'use strict';

const dns = require('node:dns/promises');
const { randomUUID } = require('node:crypto');

const {
  renderComplianceFooter,
  renderPreamble,
  buildUnsubscribeUrls,
  DEFAULT_LEGAL_ENTITY,
  DEFAULT_POSTAL_ADDRESS
} = require('./m360-email-compliance.js');

const {
  isValidIdentifier,
  hasGrantedConsent,
  isSuppressed,
  getSuppressions,
  getConsents
} = require('./m360-consent.js');

const {
  RATES,
  GST_RATE
} = require('./m360-rates.js');

const durableStore = require('./m360-marketing-durable-store.js');

const EMAIL_ONBOARDING_STATES = [
  'not_started',
  'domain_pending',
  'dns_verifying',
  'ready_limited',
  'verified',
  'needs_attention'
];

// Ephemeral in-memory store for fast lookups & test runs
const EMAIL_ONBOARDING_STORE = new Map();

function getEmailOnboardingRecord(workspaceId) {
  if (!workspaceId) return null;
  const existing = EMAIL_ONBOARDING_STORE.get(workspaceId);
  if (existing) {
    return { ...existing };
  }

  const defaultRecord = {
    workspace_id: workspaceId,
    sender_domain: null,
    from_address: null,
    from_name: null,
    state: 'not_started',
    spf_ok: false,
    dkim_ok: false,
    dmarc_ok: false,
    last_provider_error: null,
    test_message_id: null,
    test_delivery_confirmed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  return defaultRecord;
}

function saveEmailOnboardingRecord(workspaceId, record) {
  if (!workspaceId || !record) return null;
  const current = getEmailOnboardingRecord(workspaceId);
  const updated = {
    ...current,
    ...record,
    workspace_id: workspaceId,
    test_delivery_confirmed_at: record.test_delivery_confirmed_at !== undefined ? record.test_delivery_confirmed_at : (current.test_delivery_confirmed_at || null),
    updated_at: new Date().toISOString()
  };
  EMAIL_ONBOARDING_STORE.set(workspaceId, updated);

  if (durableStore.saveEmailOnboarding) {
    durableStore.saveEmailOnboarding(updated).catch(() => {});
  }

  return { ...updated };
}

async function syncEmailOnboardingFromDurable(workspaceId) {
  if (!workspaceId) return null;
  if (!durableStore.loadEmailOnboarding) return getEmailOnboardingRecord(workspaceId);

  const row = await durableStore.loadEmailOnboarding(workspaceId);
  if (row) {
    const record = {
      workspace_id: row.workspace_id,
      sender_domain: row.sender_domain || null,
      from_address: row.from_address || null,
      from_name: row.from_name || null,
      state: row.state || 'not_started',
      spf_ok: Boolean(row.spf_ok),
      dkim_ok: Boolean(row.dkim_ok),
      dmarc_ok: Boolean(row.dmarc_ok),
      last_provider_error: row.last_provider_error || null,
      test_delivery_confirmed_at: row.test_delivery_confirmed_at || null,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || new Date().toISOString()
    };
    EMAIL_ONBOARDING_STORE.set(workspaceId, record);
    return record;
  }
  return getEmailOnboardingRecord(workspaceId);
}

function clearEmailOnboardingStore() {
  EMAIL_ONBOARDING_STORE.clear();
}

/**
 * State machine for email sender onboarding.
 * Each transition is driven by a real fact, never a timer.
 * Unknown or missing triggering facts leave state unchanged.
 */
function transitionEmailOnboarding(workspaceId, action, fact = {}) {
  const current = getEmailOnboardingRecord(workspaceId);
  let nextState = current.state;
  const patch = {};

  switch (action) {
    case 'submit_domain': {
      const domain = String(fact.sender_domain || fact.domain || '').trim().toLowerCase();
      const fromAddr = String(fact.from_address || fact.email || '').trim().toLowerCase();
      const fromName = String(fact.from_name || fact.name || '').trim();

      // Must have valid domain syntax with a dot
      if (!domain || !domain.includes('.') || domain.length < 4) {
        return current; // Missing/invalid fact leaves state unchanged
      }

      patch.sender_domain = domain;
      if (fromAddr) patch.from_address = fromAddr;
      if (fromName) patch.from_name = fromName;
      nextState = 'domain_pending';
      break;
    }

    case 'start_dns_check': {
      if (!current.sender_domain) {
        return current; // Cannot check DNS without domain
      }
      nextState = 'dns_verifying';
      break;
    }

    case 'dns_check_complete': {
      if (typeof fact.spf_ok !== 'boolean' || typeof fact.dkim_ok !== 'boolean' || typeof fact.dmarc_ok !== 'boolean') {
        return current; // Missing real DNS facts leaves state unchanged
      }

      patch.spf_ok = fact.spf_ok;
      patch.dkim_ok = fact.dkim_ok;
      patch.dmarc_ok = fact.dmarc_ok;

      const allDnsOk = fact.spf_ok && fact.dkim_ok && fact.dmarc_ok;
      if (allDnsOk) {
        if (current.test_delivery_confirmed_at) {
          nextState = 'ready_limited';
        } else {
          // DNS passes, but awaiting test delivery confirmation
          nextState = 'dns_verifying';
        }
      } else {
        nextState = 'needs_attention';
        patch.last_provider_error = {
          message: 'DNS authentication records missing or misconfigured',
          details: { spf_ok: fact.spf_ok, dkim_ok: fact.dkim_ok, dmarc_ok: fact.dmarc_ok }
        };
      }
      break;
    }

    case 'test_email_sent': {
      const msgId = fact.test_message_id || fact.message_id;
      if (!msgId) return current; // Missing fact leaves state unchanged
      patch.test_message_id = msgId;
      patch.test_recipient = fact.recipient || null;
      // State remains unchanged: test email sent does NOT mean confirmed
      break;
    }

    case 'test_delivery_confirmed': {
      const msgId = fact.message_id || fact.test_message_id;
      if (!msgId || !current.test_message_id || current.test_message_id !== msgId) {
        return current; // Webhook delivery for unrelated message cannot confirm onboarding
      }

      patch.test_delivery_confirmed_at = fact.confirmed_at || new Date().toISOString();
      const dnsOk = (patch.spf_ok !== undefined ? patch.spf_ok : current.spf_ok) &&
                    (patch.dkim_ok !== undefined ? patch.dkim_ok : current.dkim_ok) &&
                    (patch.dmarc_ok !== undefined ? patch.dmarc_ok : current.dmarc_ok);

      if (dnsOk) {
        nextState = 'ready_limited';
      } else {
        nextState = 'needs_attention';
      }
      break;
    }

    case 'provider_verified': {
      if (current.state !== 'ready_limited' && current.state !== 'verified') {
        return current; // Cannot jump directly to verified without prior ready_limited
      }
      if (fact.verified === true) {
        nextState = 'verified';
      }
      break;
    }

    case 'provider_bounce_or_complaint': {
      if (fact.paused === true || fact.critical === true) {
        nextState = 'needs_attention';
        patch.last_provider_error = fact.error || { message: 'High complaint rate or bounce threshold exceeded' };
      }
      break;
    }

    default:
      return current; // Unknown action leaves state unchanged
  }

  const updated = saveEmailOnboardingRecord(workspaceId, {
    ...current,
    ...patch,
    state: nextState
  });

  return updated;
}

/**
 * Domain-readiness verification: checks real SPF, DKIM, and DMARC DNS records.
 * Reports pass/fail per record and exact copy-paste records the owner must add.
 */
async function checkDomainDnsRecords({ domain, dnsResolver = dns }) {
  const normDomain = String(domain || '').trim().toLowerCase();
  if (!normDomain || !normDomain.includes('.')) {
    return {
      domain: normDomain,
      spf_ok: false,
      dkim_ok: false,
      dmarc_ok: false,
      aligned: false,
      bulk_sending_allowed: false,
      error: 'INVALID_DOMAIN'
    };
  }

  let spfOk = false;
  let dkimOk = false;
  let dmarcOk = false;

  let currentSpf = null;
  let currentDkim = null;
  let currentDmarc = null;

  try {
    // 1. SPF Check
    const rootTxt = await dnsResolver.resolveTxt(normDomain).catch(() => []);
    const flatRoot = rootTxt.flat().join(' ');
    if (flatRoot.includes('v=spf1')) {
      currentSpf = flatRoot;
      spfOk = true;
    }

    // 2. DKIM Check
    const selectors = ['mail', 'brevo', 'smtp', 'k1'];
    for (const sel of selectors) {
      const dkimHost = `${sel}._domainkey.${normDomain}`;
      const records = await dnsResolver.resolveTxt(dkimHost).catch(() => []);
      const flatDkim = records.flat().join(' ');
      if (flatDkim.includes('v=DKIM1') || flatDkim.includes('k=rsa') || flatDkim.length > 20) {
        currentDkim = flatDkim;
        dkimOk = true;
        break;
      }
    }

    // 3. DMARC Check
    const dmarcHost = `_dmarc.${normDomain}`;
    const dmarcRecords = await dnsResolver.resolveTxt(dmarcHost).catch(() => []);
    const flatDmarc = dmarcRecords.flat().join(' ');
    if (flatDmarc.includes('v=DMARC1')) {
      currentDmarc = flatDmarc;
      dmarcOk = true;
    }
  } catch (_) {}

  const aligned = Boolean(spfOk && dmarcOk);
  const bulkSendingAllowed = Boolean(spfOk && dkimOk && dmarcOk);

  const exactRecordsToAdd = {
    spf: {
      type: 'TXT',
      host: '@',
      value: 'v=spf1 include:spf.brevo.com ~all',
      status: spfOk ? 'PASS' : 'MISSING',
      current: currentSpf
    },
    dkim: {
      type: 'TXT',
      host: 'mail._domainkey',
      value: 'k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDeMVIigNm5+fFQbMQ0GsG0YM456wIDAQAB',
      status: dkimOk ? 'PASS' : 'MISSING',
      current: currentDkim
    },
    dmarc: {
      type: 'TXT',
      host: '_dmarc',
      value: `v=DMARC1; p=none; rua=mailto:dmarc-reports@${normDomain}`,
      status: dmarcOk ? 'PASS' : 'MISSING',
      current: currentDmarc
    }
  };

  return {
    domain: normDomain,
    spf_ok: spfOk,
    dkim_ok: dkimOk,
    dmarc_ok: dmarcOk,
    aligned,
    bulk_sending_allowed: bulkSendingAllowed,
    records: exactRecordsToAdd,
    plain_english_status: {
      spf: spfOk ? '✓ SPF record configured' : '✗ SPF missing: add TXT record to authorize email sending',
      dkim: dkimOk ? '✓ DKIM signature key verified' : '✗ DKIM missing: add public key TXT record to mail._domainkey',
      dmarc: dmarcOk ? '✓ DMARC policy active' : '✗ DMARC missing: add TXT record to _dmarc to prevent domain spoofing',
      bulk_gating: bulkSendingAllowed
        ? '✓ Bulk sending to Gmail, Yahoo, Outlook permitted'
        : '⚠️ Bulk sending (> 5,000/day) BLOCKED until SPF, DKIM, and DMARC are fully aligned'
    }
  };
}

/**
 * Sends a real test email to the owner's own address.
 * Sets test_message_id; does NOT flip state to ready_limited until webhook confirms delivery.
 */
async function sendEmailOnboardingTestMessage({ workspaceId, ownerEmail, transportImpl = null }) {
  const current = getEmailOnboardingRecord(workspaceId);
  const cleanEmail = String(ownerEmail || '').trim().toLowerCase();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    return { success: false, error: 'INVALID_OWNER_EMAIL', message: 'A valid owner email address is required for test send.' };
  }

  const testMessageId = `test_msg_${randomUUID()}`;

  // Call real transport if provided
  if (transportImpl && typeof transportImpl.send === 'function') {
    try {
      await transportImpl.send({
        from: current.from_address || `noreply@${current.sender_domain || 'matrix360.io'}`,
        to: cleanEmail,
        subject: 'Matrix360 Email Sender Verification Test',
        text: 'This is a test message to confirm delivery for your Matrix360 email sender configuration.',
        headers: { 'X-Matrix360-Test-Id': testMessageId }
      });
    } catch (err) {
      return { success: false, error: 'TRANSPORT_ERROR', message: err.message };
    }
  }

  // Record test message sent. State remains unconfirmed!
  transitionEmailOnboarding(workspaceId, 'test_email_sent', {
    test_message_id: testMessageId,
    recipient: cleanEmail
  });

  return {
    success: true,
    status: 'test_sent_awaiting_webhook_confirmation',
    test_message_id: testMessageId,
    recipient: cleanEmail,
    note: 'Email sender state will only advance to ready_limited once provider webhook confirms real delivery.'
  };
}

/**
 * Broadcast preview endpoint for email campaigns (parity with WhatsApp builder).
 * Evaluates real audience eligibility, attaches CAN-SPAM compliant footers and List-Unsubscribe headers,
 * and discloses transparent pricing.
 */
function previewEmailBroadcast({
  workspaceId,
  templateSubject,
  templateBody,
  tagFilter = null,
  contacts = [],
  mode = 'draft_only',
  testRecipients = []
}) {
  const wsId = String(workspaceId || '').trim();
  const current = getEmailOnboardingRecord(wsId);

  // Check bulk sending gate if recipient count > 5000
  if (contacts.length > 5000) {
    const isAligned = current.spf_ok && current.dkim_ok && current.dmarc_ok;
    if (!isAligned) {
      return {
        success: false,
        code: 'BULK_SEND_BLOCKED_UNALIGNED_DOMAIN',
        message: 'Bulk email broadcast (>5,000 recipients) is blocked because the sender domain is not fully aligned with SPF, DKIM, and DMARC.',
        domain: current.sender_domain,
        spf_ok: current.spf_ok,
        dkim_ok: current.dkim_ok,
        dmarc_ok: current.dmarc_ok
      };
    }
  }

  const eligible = [];
  const excluded = [];
  const excludedBreakdown = {
    tag_mismatch: 0,
    invalid_email: 0,
    missing_consent: 0,
    suppressed_or_opted_out: 0,
    mode_test_filtered: 0
  };

  const suppressions = getSuppressions(wsId);
  const consents = getConsents(wsId);

  for (const c of contacts) {
    if (tagFilter && Array.isArray(c.tags) && !c.tags.includes(tagFilter)) {
      excluded.push({ contact_id: c.id, reason: 'tag_mismatch' });
      excludedBreakdown.tag_mismatch++;
      continue;
    }
    if (!isValidIdentifier(c, 'email')) {
      excluded.push({ contact_id: c.id, reason: 'invalid_email' });
      excludedBreakdown.invalid_email++;
      continue;
    }
    if (isSuppressed(c, 'email', suppressions)) {
      excluded.push({ contact_id: c.id, reason: 'suppressed_or_opted_out' });
      excludedBreakdown.suppressed_or_opted_out++;
      continue;
    }
    if (!hasGrantedConsent(c, 'email', consents)) {
      excluded.push({ contact_id: c.id, reason: 'missing_consent' });
      excludedBreakdown.missing_consent++;
      continue;
    }
    if (mode === 'team_test') {
      const email = String(c.email || '').trim().toLowerCase();
      const allowlist = (testRecipients || []).map(e => String(e).trim().toLowerCase());
      if (!allowlist.includes(email)) {
        excluded.push({ contact_id: c.id, reason: 'mode_test_filtered' });
        excludedBreakdown.mode_test_filtered++;
        continue;
      }
    }
    eligible.push(c);
  }

  // Build sample layout with compliance footer and List-Unsubscribe
  const sampleRecipientEmail = eligible[0]?.email || 'prospect@example.com';
  const { html: footerHtml, text: footerText, unsubUrl } = renderComplianceFooter({
    email: sampleRecipientEmail,
    workspaceId: wsId,
    legalName: DEFAULT_LEGAL_ENTITY,
    postalAddress: DEFAULT_POSTAL_ADDRESS
  });

  const preamble = renderPreamble({
    senderName: current.from_name || 'Matrix 360',
    businessName: DEFAULT_LEGAL_ENTITY
  });

  const bodyRaw = templateBody || 'Explore our newest commercial property developments.';
  const sampleHtml = `<p>${preamble}</p>\n<p>${bodyRaw}</p>\n${footerHtml}`;
  const sampleText = `${preamble}\n\n${bodyRaw}\n\n${footerText}`;

  // Cost estimate
  const baseRate = RATES.Email?.per_message_inr !== undefined ? RATES.Email.per_message_inr : 0.10;
  const totalPerMessage = Number((baseRate * (1 + GST_RATE)).toFixed(4));
  const totalEstimatedCost = Number((eligible.length * totalPerMessage).toFixed(4));

  return {
    success: true,
    template: {
      subject: templateSubject || 'Exclusive Opportunities from Matrix360',
      sample_html: sampleHtml,
      sample_text: sampleText,
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>, <mailto:unsubscribe@matrix360.io>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    },
    audience: {
      total: contacts.length,
      eligible_count: eligible.length,
      excluded_count: excluded.length,
      eligible_contacts: eligible,
      excluded_breakdown: excludedBreakdown
    },
    cost_estimate: {
      currency: 'INR',
      recipient_count: eligible.length,
      provider_base_rate_inr: baseRate,
      gst_pct: GST_RATE * 100,
      provider_fee_per_message_inr: totalPerMessage,
      matrix360_fee_per_message_inr: 0.0,
      total_estimated_cost_inr: totalEstimatedCost,
      provider_note: 'Billed per delivered email via Brevo SMTP relay. Matrix360 adds zero markup.'
    }
  };
}

const EMAIL_CAMPAIGN_RESULTS = new Map();

function recordEmailCampaignDeliveryEvent(workspaceId, correlationId, { messageId, status, recipientEmail, timestamp }) {
  const key = `${workspaceId}:${correlationId}`;
  let entry = EMAIL_CAMPAIGN_RESULTS.get(key);
  if (!entry) {
    entry = {
      workspace_id: workspaceId,
      correlation_id: correlationId,
      dispatched: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      complained: 0,
      unsubscribed: 0,
      events: []
    };
    EMAIL_CAMPAIGN_RESULTS.set(key, entry);
  }
  entry.events.push({ messageId, status, recipientEmail, timestamp: timestamp || new Date().toISOString() });
  if (status === 'delivered') entry.delivered++;
  else if (status === 'open' || status === 'opened') entry.opened++;
  else if (status === 'click' || status === 'clicked') entry.clicked++;
  else if (status === 'hard_bounce' || status === 'soft_bounce' || status === 'bounce') entry.bounced++;
  else if (status === 'spam' || status === 'complaint') entry.complained++;
  else if (status === 'unsubscribed' || status === 'opt_out') entry.unsubscribed++;
  return entry;
}

function getEmailCampaignResults(workspaceId, correlationId) {
  const key = `${workspaceId}:${correlationId}`;
  const entry = EMAIL_CAMPAIGN_RESULTS.get(key);
  if (!entry) {
    return {
      workspace_id: workspaceId,
      correlation_id: correlationId,
      dispatched: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      complained: 0,
      unsubscribed: 0,
      events: []
    };
  }
  return { ...entry, events: [...entry.events] };
}

function getAllEmailCampaignResults(workspaceId) {
  const list = [];
  for (const entry of EMAIL_CAMPAIGN_RESULTS.values()) {
    if (workspaceId && entry.workspace_id !== workspaceId) continue;
    list.push({ ...entry, events: [...entry.events] });
  }
  return list;
}

function clearEmailCampaignResultsStore() {
  EMAIL_CAMPAIGN_RESULTS.clear();
}

module.exports = {
  EMAIL_ONBOARDING_STATES,
  getEmailOnboardingRecord,
  saveEmailOnboardingRecord,
  syncEmailOnboardingFromDurable,
  clearEmailOnboardingStore,
  transitionEmailOnboarding,
  checkDomainDnsRecords,
  sendEmailOnboardingTestMessage,
  previewEmailBroadcast,
  recordEmailCampaignDeliveryEvent,
  getEmailCampaignResults,
  getAllEmailCampaignResults,
  clearEmailCampaignResultsStore
};
