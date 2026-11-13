'use strict';

const { randomUUID, createHash } = require('node:crypto');

let parsePhoneNumberFromString;
try {
  ({ parsePhoneNumberFromString } = require('libphonenumber-js/max'));
} catch {
  try {
    ({ parsePhoneNumberFromString } = require('libphonenumber-js'));
  } catch {
    parsePhoneNumberFromString = null;
  }
}

const MAX_ROWS = 2000;
const HEADER_ALIASES = Object.freeze({
  name: ['name', 'contact_name', 'full_name', 'lead_name', 'prospect'],
  company_name: ['company', 'company_name', 'business', 'org', 'organization'],
  email: ['email', 'email_address', 'mail'],
  phone: [
    'phone',
    'mobile',
    'phone_number',
    'mobile_no',
    'mobile no',
    'contact',
    'whatsapp',
    'whatsapp_number',
    'whatsapp number',
    'cell'
  ],
  source: ['source', 'lead_source'],
  consent_email: ['consent_email', 'email_consent', 'opt_in_email'],
  consent_whatsapp: ['consent_whatsapp', 'whatsapp_consent', 'opt_in_whatsapp'],
  consent_sms: ['consent_sms', 'sms_consent', 'opt_in_sms'],
  consent_source: ['consent_source', 'opt_in_source', 'source_of_consent', 'consent_type'],
  consent_captured_at: ['consent_captured_at', 'opt_in_at', 'consent_date', 'opt_in_date']
});

function parseCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('CSV content is required');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function resolveHeaders(headers) {
  const rawHeaders = headers.map(h => String(h || '').trim().toLowerCase());
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((normVal, i) => {
      const rawVal = rawHeaders[i];
      return aliases.includes(normVal) || aliases.includes(rawVal) || aliases.some(a => normalizeHeader(a) === normVal);
    });
    if (index >= 0) mapping[field] = index;
  }
  if (mapping.name === undefined && mapping.company_name === undefined) throw new Error('CSV needs a name or company column');
  return mapping;
}

function truthy(value) { return /^(1|true|yes|granted|opted_in)$/i.test(String(value || '').trim()); }
function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }

function normalizePhoneNumber(rawPhone, defaultCountry = 'IN') {
  const raw = String(rawPhone ?? '').trim();
  if (!raw) {
    return { phone: '', raw_phone: '', is_valid: false, is_whatsapp_capable: false, phone_type: 'MISSING' };
  }
  if (parsePhoneNumberFromString) {
    try {
      const parsed = parsePhoneNumberFromString(raw, defaultCountry);
      if (parsed && parsed.isValid()) {
        const e164 = parsed.format('E.164');
        const type = parsed.getType ? parsed.getType() : 'UNKNOWN';
        const isLandline = type === 'FIXED_LINE';
        return {
          phone: e164,
          raw_phone: raw,
          is_valid: true,
          phone_type: type || 'UNKNOWN',
          is_whatsapp_capable: !isLandline
        };
      }
    } catch {}
  }
  const digits = raw.replace(/\D/g, '');
  const isValid = digits.length >= 8 && digits.length <= 15;
  const isLandlineGuess = /^(011|022|033|044|080)\d{7,8}$/.test(digits);
  return {
    phone: raw,
    raw_phone: raw,
    is_valid: isValid,
    phone_type: isLandlineGuess ? 'FIXED_LINE' : 'UNKNOWN',
    is_whatsapp_capable: isValid && !isLandlineGuess
  };
}

function importCsv(text, { workspaceId, defaultCountry = 'IN', testData = true, consentDeclaration = null } = {}) {
  if (!workspaceId) throw new Error('workspaceId is required');
  const parsed = parseCsv(text);
  if (parsed.length < 2) throw new Error('CSV needs a header and at least one data row');
  if (parsed.length - 1 > MAX_ROWS) throw new Error(`CSV exceeds the ${MAX_ROWS} row limit`);
  const mapping = resolveHeaders(parsed[0]);
  const records = [], errors = [], seen = new Set();

  const hasConsentSourceColumn = mapping.consent_source !== undefined;
  const fileLevelConsentSource = typeof consentDeclaration === 'string' && consentDeclaration.trim() ? consentDeclaration.trim() : null;
  const hasConsentDeclaration = Boolean(hasConsentSourceColumn || fileLevelConsentSource);

  const consentBypassed = process.env.M360_ENFORCE_CONSENT === 'false' || process.env.REQUIRE_EXPLICIT_CONSENT === 'false';
  const effectiveTestData = consentBypassed ? (testData === true) : Boolean(testData || !hasConsentDeclaration);

  parsed.slice(1).forEach((values, index) => {
    const rowNum = index + 2;
    const get = field => mapping[field] === undefined ? '' : clean(values[mapping[field]]);
    const name = get('name') || get('company_name');
    const company = get('company_name');
    const email = get('email').toLowerCase();
    const rawPhone = get('phone');
    const normPhone = normalizePhoneNumber(rawPhone, defaultCountry);

    const consentSource = get('consent_source') || fileLevelConsentSource || '';
    const consentCapturedAt = get('consent_captured_at') || new Date().toISOString();

    if (!name) {
      errors.push({ row: rowNum, code: 'NAME_REQUIRED', message: 'Name or company name is required' });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ row: rowNum, code: 'INVALID_EMAIL', message: `Invalid email address: ${email}` });
      return;
    }
    if (rawPhone && !normPhone.is_valid) {
      errors.push({ row: rowNum, code: 'INVALID_PHONE', message: `Invalid phone number: ${rawPhone}` });
      return;
    }

    // Deduplication within file: dedupe by email, or normalized phone, or name|company
    const dedupeKey = email ? `email:${email}` : (normPhone.is_valid ? `phone:${normPhone.phone}` : `identity:${name.toLowerCase()}|${company.toLowerCase()}`);
    if (seen.has(dedupeKey)) {
      errors.push({ row: rowNum, code: 'DUPLICATE', message: `Duplicate row detected: ${dedupeKey}` });
      return;
    }
    seen.add(dedupeKey);

    // Block purchased lists from WhatsApp/SMS
    const isPurchasedList = /purchased|bought|data_broker|scraped|cold_list/i.test(consentSource);
    if (isPurchasedList) {
      errors.push({
        row: rowNum,
        code: 'PURCHASED_LIST_FORBIDDEN',
        message: 'Purchased and scraped lists are strictly forbidden for WhatsApp and SMS outreach'
      });
    }

    const hasExplicitConsent = Boolean(consentSource && !isPurchasedList) || consentBypassed;
    const emailOptIn = hasExplicitConsent && (consentBypassed || truthy(get('consent_email'))) ? 'granted' : 'unknown';
    const waOptIn = hasExplicitConsent && !isPurchasedList && normPhone.is_whatsapp_capable && (consentBypassed || truthy(get('consent_whatsapp'))) ? 'granted' : (isPurchasedList ? 'blocked' : 'unknown');
    const smsOptIn = hasExplicitConsent && !isPurchasedList && normPhone.is_whatsapp_capable && (consentBypassed || truthy(get('consent_sms'))) ? 'granted' : (isPurchasedList ? 'blocked' : 'unknown');

    let consentEvidence = {};
    if (hasExplicitConsent && (emailOptIn === 'granted' || waOptIn === 'granted' || smsOptIn === 'granted')) {
      consentEvidence = {
        source: consentSource || 'csv_verified_import',
        captured_at: consentCapturedAt,
        email: emailOptIn === 'granted',
        whatsapp: waOptIn === 'granted',
        sms: smsOptIn === 'granted'
      };
    } else if (isPurchasedList) {
      consentEvidence = {
        source: consentSource,
        blocked: true,
        reason: 'PURCHASED_LIST_FORBIDDEN'
      };
    }

    records.push({
      id: `csv_${createHash('sha256').update(`${workspaceId}:${dedupeKey}`).digest('hex').slice(0, 16)}`,
      name,
      company_name: company,
      company,
      email,
      phone: normPhone.phone,
      raw_phone: normPhone.raw_phone,
      phone_type: normPhone.phone_type,
      is_whatsapp_capable: normPhone.is_whatsapp_capable,
      source: get('source') || consentSource || 'csv_import',
      test_data: effectiveTestData,
      outbound_blocked: consentBypassed ? false : (effectiveTestData || isPurchasedList),
      email_opt_in_status: emailOptIn,
      whatsapp_opt_in_status: waOptIn,
      sms_opt_in_status: smsOptIn,
      consent_status: (emailOptIn === 'granted' || waOptIn === 'granted' || smsOptIn === 'granted') ? 'granted' : (isPurchasedList ? 'blocked' : 'unknown'),
      consent_evidence: consentEvidence
    });
  });

  return {
    schema_version: '1.0',
    import_batch_id: randomUUID(),
    workspace_id: workspaceId,
    test_data: effectiveTestData,
    external_sending_blocked: effectiveTestData,
    input_count: parsed.length - 1,
    accepted_count: records.length,
    rejected_count: errors.length,
    records,
    errors
  };
}

module.exports = { parseCsv, importCsv, normalizePhoneNumber, MAX_ROWS };
