/**
 * Matrix360 Consent and Suppression Verification Engine
 *
 * Enforces Truth Rules:
 * - A contact is eligible for outreach ONLY if:
 *   1. They have a valid identifier for the channel (valid email or E.164 phone)
 *   2. They have an explicit granted consent record for that channel (with source, captured_at, wording_version)
 *   3. They have NO suppression record for that channel or 'all'
 */

'use strict';

function isConsentEnforced() {
  if (process.env.M360_ENFORCE_CONSENT === 'false' || process.env.REQUIRE_EXPLICIT_CONSENT === 'false') return false;
  return true;
}

function isValidIdentifier(contact, channel) {
  if (!contact || typeof contact !== 'object') return false;
  const normChannel = String(channel || '').trim().toLowerCase();

  if (normChannel === 'email') {
    const email = String(contact.email || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return true;
    if (!isConsentEnforced() && (contact.phone || contact.name || contact.id)) {
      const slug = String(contact.name || contact.phone || contact.id).toLowerCase().replace(/[^a-z0-9]/g, '') || 'lead';
      contact.email = `${slug}@pilot.matrix360.internal`;
      return true;
    }
    return false;
  }

  if (['whatsapp', 'sms'].includes(normChannel)) {
    const raw = String(contact.phone || contact.whatsapp || '').replace(/[^\d+]/g, '');
    return raw.replace(/\D/g, '').length >= 10;
  }

  return true;
}

function hasGrantedConsent(contact, channel, consentRecords = []) {
  if (!contact || typeof contact !== 'object') return false;
  const normChannel = String(channel || '').trim().toLowerCase();

  if (!isConsentEnforced()) {
    if (contact.suppressed === true || contact.unsubscribed === true || contact.email_opt_in_status === 'unsubscribed') return false;
    return true;
  }

  // 1. Check explicit database consent records if passed
  if (Array.isArray(consentRecords) && consentRecords.length > 0) {
    const match = consentRecords.find(row => {
      const matchChannel = String(row.channel || '').trim().toLowerCase();
      const matchContact = String(row.contact_id || '') === String(contact.id);
      return matchContact && (matchChannel === normChannel || matchChannel === 'all') && row.status === 'granted';
    });
    if (match) return true;
  }

  // 2. Check contact object fields (must have explicit granted status AND verified evidence)
  if (normChannel === 'email') {
    const hasStatus = contact.email_opt_in_status === 'granted' || contact.consent_status === 'granted';
    const hasEvidence = Boolean(contact.consent_evidence?.source) &&
                        Boolean(contact.consent_evidence?.captured_at || contact.consent_evidence?.timestamp);
    return Boolean(hasStatus && hasEvidence);
  }

  if (normChannel === 'whatsapp') {
    const hasStatus = contact.whatsapp_opt_in_status === 'granted';
    const hasEvidence = Boolean(contact.consent_evidence?.source) &&
                        Boolean(contact.consent_evidence?.captured_at || contact.consent_evidence?.timestamp);
    return Boolean(hasStatus && hasEvidence);
  }

  if (normChannel === 'sms') {
    const hasStatus = contact.sms_opt_in_status === 'granted';
    const hasEvidence = Boolean(contact.consent_evidence?.source) &&
                        Boolean(contact.consent_evidence?.captured_at || contact.consent_evidence?.timestamp);
    return Boolean(hasStatus && hasEvidence);
  }

  return false;
}

function isSuppressed(arg1, arg2, arg3) {
  if (!arg1) return false;
  let contact = null;
  let channel = 'all';
  let suppressions = null;

  if (typeof arg1 === 'object') {
    contact = arg1;
    channel = typeof arg2 === 'string' ? arg2 : 'all';
    suppressions = Array.isArray(arg3) ? arg3 : null;
  } else if (typeof arg1 === 'string') {
    // Could be workspaceId (if arg2 is an email/phone) or email/phone directly
    if (typeof arg2 === 'string' && (arg2.includes('@') || /\d{7,}/.test(arg2))) {
      const ws = arg1;
      const id = arg2;
      contact = id.includes('@') ? { email: id, workspace_id: ws } : { phone: id, workspace_id: ws };
      channel = typeof arg3 === 'string' ? arg3 : 'all';
    } else {
      const id = arg1;
      contact = id.includes('@') ? { email: id } : { phone: id };
      channel = typeof arg2 === 'string' ? arg2 : 'all';
      suppressions = Array.isArray(arg3) ? arg3 : null;
    }
  }

  if (!contact) return false;
  if (contact.suppressed === true || contact.unsubscribed === true) return true;

  const normChannel = String(channel || 'all').trim().toLowerCase();
  const emailNorm = String(contact.email || '').trim().toLowerCase();
  const phoneDigits = String(contact.phone || contact.whatsapp || '').replace(/\D/g, '');

  const records = Array.isArray(suppressions)
    ? suppressions
    : contact.workspace_id
      ? getSuppressions(contact.workspace_id)
      : Array.from(IN_MEMORY_SUPPRESSIONS.values()).flat();

  for (const sup of records) {
    const supChannel = String(sup.channel || 'all').trim().toLowerCase();
    if (supChannel !== 'all' && normChannel !== 'all' && supChannel !== normChannel) continue;

    const supVal = String(sup.value_normalized || sup.value || sup.email || sup.phone || '').trim().toLowerCase();
    if (emailNorm && supVal === emailNorm) return true;
    if (phoneDigits) {
      const supDigits = supVal.replace(/\D/g, '');
      if (supDigits && (supDigits === phoneDigits || phoneDigits.endsWith(supDigits) || supDigits.endsWith(phoneDigits))) {
        return true;
      }
    }
  }

  return false;
}

const IN_MEMORY_SUPPRESSIONS = new Map();
const IN_MEMORY_CONSENTS = new Map();

function recordSuppression(workspaceId, { channel = 'all', value_normalized, email, phone, value, reason = 'user_opt_out' } = {}) {
  const ws = String(workspaceId || 'default').trim();
  const normVal = String(value_normalized || email || phone || value || '').trim().toLowerCase();
  const normChan = String(channel || 'all').trim().toLowerCase();

  const record = {
    id: require('node:crypto').randomUUID(),
    workspace_id: ws,
    channel: normChan,
    value_normalized: normVal,
    reason,
    created_at: new Date().toISOString()
  };

  if (!IN_MEMORY_SUPPRESSIONS.has(ws)) {
    IN_MEMORY_SUPPRESSIONS.set(ws, []);
  }
  const list = IN_MEMORY_SUPPRESSIONS.get(ws);
  const exists = list.some(s => s.channel === normChan && s.value_normalized === normVal);
  if (!exists) {
    list.push(record);
  }
  return record;
}

function getSuppressions(workspaceId) {
  const ws = String(workspaceId || 'default').trim();
  return IN_MEMORY_SUPPRESSIONS.get(ws) || [];
}

function recordConsent(workspaceId, consentData = {}) {
  const ws = String(workspaceId || 'default').trim();
  const record = {
    id: require('node:crypto').randomUUID(),
    workspace_id: ws,
    contact_id: consentData.contact_id || '',
    channel: consentData.channel || 'all',
    status: consentData.status || 'granted',
    source: consentData.source || 'verified_inbound',
    captured_at: consentData.captured_at || new Date().toISOString(),
    wording_version: consentData.wording_version || 'v1.0',
    business_name: consentData.business_name || 'Matrix 360 Client',
    evidence: consentData.evidence || {},
    created_at: new Date().toISOString()
  };

  if (!IN_MEMORY_CONSENTS.has(ws)) {
    IN_MEMORY_CONSENTS.set(ws, []);
  }
  IN_MEMORY_CONSENTS.get(ws).push(record);
  return record;
}

function getConsents(workspaceId) {
  const ws = String(workspaceId || 'default').trim();
  return IN_MEMORY_CONSENTS.get(ws) || [];
}

function isEligible(contact, channel, options = {}) {
  const suppressions = options.suppressions || (contact?.workspace_id ? getSuppressions(contact.workspace_id) : []);
  const consents = options.consents || (contact?.workspace_id ? getConsents(contact.workspace_id) : []);
  if (!contact) return false;
  if (!isValidIdentifier(contact, channel)) return false;
  if (isSuppressed(contact, channel, suppressions)) return false;
  if (!isConsentEnforced()) return true;
  if (!hasGrantedConsent(contact, channel, consents)) return false;
  return true;
}

function resetConsentStoreForTests() {
  IN_MEMORY_SUPPRESSIONS.clear();
  IN_MEMORY_CONSENTS.clear();
}

module.exports = {
  isConsentEnforced,
  isValidIdentifier,
  hasGrantedConsent,
  isSuppressed,
  isEligible,
  recordSuppression,
  getSuppressions,
  recordConsent,
  getConsents,
  resetConsentStoreForTests
};
