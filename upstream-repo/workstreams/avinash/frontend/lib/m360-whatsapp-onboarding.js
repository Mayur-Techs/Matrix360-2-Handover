/**
 * Matrix360 Phase 3: Meta Tech Provider & WhatsApp Embedded Signup Onboarding
 *
 * Implements the WhatsApp onboarding state machine and Meta Graph API integration.
 * Each transition is strictly gated on a confirmed Meta fact (Graph response or webhook callback).
 * Tokens are vault-encrypted per workspace (AES-256-GCM) and never written to disk or logs.
 */

const {
  configureMarketingProvider,
  getStoredProviderCredentials,
  findWorkspaceByWhatsAppPhoneNumberId,
  decryptSecret
} = require('./m360-marketing-orchestrator.js');

const {
  isValidIdentifier,
  hasGrantedConsent,
  isSuppressed,
  isEligible,
  getSuppressions,
  getConsents
} = require('./m360-consent.js');

const {
  RATES,
  GST_RATE,
  estimateChannelCostInr
} = require('./m360-rates.js');

const durableStore = require('./m360-marketing-durable-store.js');

const WHATSAPP_ONBOARDING_STATES = [
  'not_started',
  'awaiting_client_login',
  'number_registering',
  'templates_in_review',
  'ready_limited',
  'verified',
  'needs_attention'
];

const ONBOARDING_TIERS = [
  'tier_unverified',
  'tier_250',
  'tier_1k',
  'tier_10k',
  'tier_100k',
  'tier_unlimited'
];

// In-memory tenant store for WhatsApp onboarding states (keyed by workspace_id)
const WORKSPACE_ONBOARDING_STORE = new Map();

function getInitialOnboardingRecord(workspaceId) {
  return {
    workspace_id: String(workspaceId || '').trim(),
    waba_id: null,
    phone_number_id: null,
    display_phone_number: null,
    verified_name: null,
    state: 'not_started',
    tier: 'tier_250',
    last_meta_error: null,
    templates: [],
    test_delivery_confirmed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function getWhatsAppOnboardingRecord(workspaceId) {
  if (!workspaceId) return null;
  const wsId = String(workspaceId).trim();
  let record = WORKSPACE_ONBOARDING_STORE.get(wsId);
  if (!record) {
    record = getInitialOnboardingRecord(wsId);
    WORKSPACE_ONBOARDING_STORE.set(wsId, record);
  }
  return { ...record };
}

function saveWhatsAppOnboardingRecord(workspaceId, patch) {
  if (!workspaceId) throw new Error('workspace_id is required');
  const wsId = String(workspaceId).trim();
  const current = getWhatsAppOnboardingRecord(wsId);
  const updated = {
    ...current,
    ...patch,
    workspace_id: wsId,
    updated_at: new Date().toISOString()
  };
  WORKSPACE_ONBOARDING_STORE.set(wsId, updated);
  if (durableStore && typeof durableStore.saveWhatsAppOnboarding === 'function') {
    durableStore.saveWhatsAppOnboarding(updated).catch(() => {});
  }
  return { ...updated };
}

async function syncWhatsAppOnboardingFromDurable(workspaceId) {
  if (!workspaceId) return null;
  const wsId = String(workspaceId).trim();
  if (durableStore && typeof durableStore.loadWhatsAppOnboarding === 'function' && durableStore.enabled()) {
    try {
      const persisted = await durableStore.loadWhatsAppOnboarding(wsId);
      if (persisted) {
        const current = WORKSPACE_ONBOARDING_STORE.get(wsId) || getInitialOnboardingRecord(wsId);
        const merged = { ...current, ...persisted, workspace_id: wsId };
        WORKSPACE_ONBOARDING_STORE.set(wsId, merged);
        return { ...merged };
      }
    } catch (_) {}
  }
  return getWhatsAppOnboardingRecord(wsId);
}

function clearWhatsAppOnboardingStore() {
  WORKSPACE_ONBOARDING_STORE.clear();
}

/**
 * Returns Meta configuration for Embedded Signup.
 * Names any missing configuration variables plainly rather than inventing values.
 */
function getMetaOnboardingConfig() {
  const appId = String(process.env.META_APP_ID || '').trim();
  const configId = String(process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || '').trim();
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  const graphVersion = String(process.env.META_GRAPH_VERSION || 'v21.0').trim();

  const missing = [];
  if (!appId) missing.push('META_APP_ID');
  if (!configId) missing.push('META_EMBEDDED_SIGNUP_CONFIG_ID');
  if (!appSecret) missing.push('META_APP_SECRET');

  return {
    configured: missing.length === 0,
    meta_app_id: appId || null,
    meta_embedded_signup_config_id: configId || null,
    meta_graph_version: graphVersion,
    missing_config: missing
  };
}

/**
 * State machine for WhatsApp onboarding transitions.
 * Strictly requires the triggering Meta fact; missing or invalid facts leave state unchanged.
 */
function transitionWhatsAppOnboarding(workspaceId, action, metaFact = {}) {
  if (!workspaceId) throw new Error('workspace_id is required');
  const wsId = String(workspaceId).trim();
  const current = getWhatsAppOnboardingRecord(wsId);
  let nextState = current.state;
  let lastMetaError = current.last_meta_error;
  const patch = {};

  switch (action) {
    case 'start_signup': {
      // Allowed from 'not_started' or 'needs_attention'
      if (['not_started', 'needs_attention'].includes(current.state)) {
        nextState = 'awaiting_client_login';
        lastMetaError = null;
      }
      break;
    }

    case 'exchange_success': {
      // Must have genuine waba_id, phone_number_id, and access_token from Meta Graph
      const wabaId = String(metaFact.waba_id || metaFact.wabaId || '').trim();
      const phoneId = String(metaFact.phone_number_id || metaFact.phoneId || metaFact.phoneNumberId || '').trim();
      const token = String(metaFact.access_token || metaFact.token || '').trim();
      const displayPhone = String(metaFact.display_phone_number || metaFact.displayPhone || '').trim();
      const verifiedName = String(metaFact.verified_name || metaFact.verifiedName || '').trim();

      if (!wabaId || !phoneId || !token) {
        throw new Error('Meta exchange requires genuine waba_id, phone_number_id, and access_token');
      }

      // Configure provider securely: token is vault-encrypted per workspace; tenant routing is mapped
      configureMarketingProvider(wsId, 'whatsapp', {
        token,
        phone_number_id: phoneId,
        waba_id: wabaId,
        display_phone_number: displayPhone,
        business_name: verifiedName
      });

      patch.waba_id = wabaId;
      patch.phone_number_id = phoneId;
      if (displayPhone) patch.display_phone_number = displayPhone;
      if (verifiedName) patch.verified_name = verifiedName;
      lastMetaError = null;

      // Only advance state if currently at awaiting_client_login or not_started
      if (['awaiting_client_login', 'not_started', 'needs_attention'].includes(current.state)) {
        nextState = 'number_registering';
      }
      break;
    }

    case 'exchange_failed': {
      // Meta Graph exchange failed: record error honestly and do NOT advance state
      lastMetaError = metaFact.error || { message: 'Meta authorization exchange failed', code: 'EXCHANGE_FAILED' };
      patch.last_meta_error = lastMetaError;
      // State stays at current (e.g. awaiting_client_login)
      break;
    }

    case 'register_and_subscribe_success': {
      // Requires confirmed registration and app subscription
      if (!metaFact.registered || !metaFact.subscribed) {
        throw new Error('Registration transition requires both registered:true and subscribed:true Meta facts');
      }
      lastMetaError = null;
      // Advance to templates_in_review, or ready_limited if templates already approved + test delivery confirmed
      const allApproved = Array.isArray(current.templates) && current.templates.length > 0 &&
        current.templates.every(t => t.status === 'APPROVED');
      if (allApproved && current.test_delivery_confirmed_at) {
        nextState = 'ready_limited';
      } else {
        nextState = 'templates_in_review';
      }
      break;
    }

    case 'register_and_subscribe_failed': {
      lastMetaError = metaFact.error || { message: 'Phone registration or app subscription failed' };
      patch.last_meta_error = lastMetaError;
      // State remains at number_registering
      break;
    }

    case 'templates_updated': {
      // Updates stored templates from Meta Graph inspection
      const incomingTemplates = Array.isArray(metaFact.templates) ? metaFact.templates : [];
      patch.templates = incomingTemplates;

      const hasRejected = incomingTemplates.some(t => t.status === 'REJECTED');
      if (hasRejected) {
        const rej = incomingTemplates.find(t => t.status === 'REJECTED');
        nextState = 'needs_attention';
        lastMetaError = {
          message: `Template '${rej.name}' was rejected by Meta: ${rej.rejection_reason || 'Guidelines violation'}`
        };
        patch.last_meta_error = lastMetaError;
      } else {
        const allApproved = incomingTemplates.length > 0 && incomingTemplates.every(t => t.status === 'APPROVED');
        if (allApproved && current.test_delivery_confirmed_at && current.state === 'templates_in_review') {
          nextState = 'ready_limited';
        }
      }
      break;
    }

    case 'test_delivery_confirmed': {
      // Confirmed delivery callback received from Meta webhook
      if (!metaFact.confirmed) {
        throw new Error('test_delivery_confirmed transition requires confirmed:true from webhook');
      }
      const confirmedAt = metaFact.confirmed_at || new Date().toISOString();
      patch.test_delivery_confirmed_at = confirmedAt;

      const allApproved = Array.isArray(current.templates) && current.templates.length > 0 &&
        current.templates.every(t => t.status === 'APPROVED');

      // Turns state into ready_limited only if templates are also approved
      if (allApproved && ['templates_in_review', 'number_registering'].includes(current.state)) {
        nextState = 'ready_limited';
      }
      break;
    }

    case 'tier_raised_verified': {
      // Meta raised tier post-business verification
      const newTier = String(metaFact.tier || '').trim();
      if (!newTier && !metaFact.business_verified) {
        throw new Error('tier_raised_verified requires explicit tier or business_verified:true from Meta');
      }
      if (newTier && ONBOARDING_TIERS.includes(newTier)) {
        patch.tier = newTier;
      }
      if (['ready_limited', 'templates_in_review'].includes(current.state) && (metaFact.business_verified || newTier !== 'tier_250')) {
        nextState = 'verified';
      }
      break;
    }

    case 'meta_error': {
      lastMetaError = metaFact.error || { message: 'Meta reported an unexpected error' };
      patch.last_meta_error = lastMetaError;
      if (metaFact.fatal) {
        nextState = 'needs_attention';
      }
      break;
    }

    default:
      throw new Error(`Unknown onboarding action: ${action}`);
  }

  patch.state = nextState;
  patch.last_meta_error = lastMetaError;

  return saveWhatsAppOnboardingRecord(wsId, patch);
}

/**
 * Server-side exchange of the authorization code returned by Meta Embedded Signup.
 * Exchanges code for access_token, inspects token to obtain waba_id and phone_number_id.
 */
async function exchangeEmbeddedSignupCode({ code, workspaceId, selectedPhoneNumberId, fetchImpl = globalThis.fetch }) {
  if (!code || typeof code !== 'string') {
    return { success: false, error: 'MISSING_AUTH_CODE', message: 'Authorization code is required' };
  }
  if (!workspaceId) {
    return { success: false, error: 'MISSING_WORKSPACE', message: 'workspace_id is required' };
  }

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const version = process.env.META_GRAPH_VERSION || 'v21.0';

  if (!appId || !appSecret) {
    return {
      success: false,
      error: 'META_CONFIG_MISSING',
      message: 'Server missing META_APP_ID or META_APP_SECRET configuration'
    };
  }

  // 1. Exchange authorization code for User / WABA Access Token
  const tokenUrl = `https://graph.facebook.com/${version}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;

  let tokenData;
  try {
    const res = await fetchImpl(tokenUrl, { method: 'GET' });
    tokenData = await res.json();
    if (!res.ok || tokenData.error) {
      const err = tokenData?.error || { message: `Meta Graph error (${res.status})` };
      transitionWhatsAppOnboarding(workspaceId, 'exchange_failed', { error: err });
      return { success: false, error: 'GRAPH_EXCHANGE_FAILED', message: err.message, meta_error: err };
    }
  } catch (netErr) {
    const err = { message: netErr.message || 'Network failure during Meta Graph exchange', code: 'NETWORK_ERROR' };
    transitionWhatsAppOnboarding(workspaceId, 'exchange_failed', { error: err });
    return { success: false, error: 'NETWORK_ERROR', message: err.message, meta_error: err };
  }

  const accessToken = tokenData.access_token;
  if (!accessToken) {
    const err = { message: 'Meta did not return an access_token in exchange response' };
    transitionWhatsAppOnboarding(workspaceId, 'exchange_failed', { error: err });
    return { success: false, error: 'NO_ACCESS_TOKEN', message: err.message, meta_error: err };
  }

  // 2. Inspect token or debug token to extract WABA ID and Phone Number ID
  let wabaId = tokenData.waba_id;
  let phoneId = tokenData.phone_number_id;
  let displayPhone = tokenData.display_phone_number;
  let verifiedName = tokenData.verified_name;

  if (!wabaId || !phoneId) {
    try {
      const debugUrl = `https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appId + '|' + appSecret)}`;
      const debugRes = await fetchImpl(debugUrl, { method: 'GET' });
      const debugData = await debugRes.json();
      if (debugRes.ok && debugData.data) {
        // Granular scopes and target IDs are returned in granular_scopes
        const scopes = debugData.data.granular_scopes || [];
        for (const s of scopes) {
          if (s.scope === 'whatsapp_business_management' && Array.isArray(s.target_ids) && s.target_ids.length > 0) {
            wabaId = wabaId || s.target_ids[0];
          }
        }
      }
    } catch (_) {}
  }

  // If WABA ID is known but phone ID is not, query the phone_numbers endpoint of the WABA
  if (wabaId && !phoneId) {
    try {
      const phonesUrl = `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/phone_numbers?access_token=${encodeURIComponent(accessToken)}`;
      const phonesRes = await fetchImpl(phonesUrl, { method: 'GET' });
      const phonesData = await phonesRes.json();
      if (phonesRes.ok && Array.isArray(phonesData.data) && phonesData.data.length > 0) {
        if (phonesData.data.length > 1 && !selectedPhoneNumberId) {
          // Multiple numbers found: do not silently take the first. Return options for owner selection.
          return {
            success: false,
            status: 'multiple_phone_numbers',
            error: 'MULTIPLE_PHONE_NUMBERS',
            message: 'Multiple WhatsApp phone numbers found for this WABA. Please select which phone number to connect.',
            waba_id: wabaId,
            available_phone_numbers: phonesData.data.map(p => ({
              id: p.id,
              display_phone_number: p.display_phone_number,
              verified_name: p.verified_name
            }))
          };
        }

        const selected = selectedPhoneNumberId
          ? phonesData.data.find(p => p.id === selectedPhoneNumberId) || phonesData.data[0]
          : phonesData.data[0];

        phoneId = selected.id;
        displayPhone = displayPhone || selected.display_phone_number;
        verifiedName = verifiedName || selected.verified_name;
      }
    } catch (_) {}
  }

  if (!wabaId || !phoneId) {
    const err = {
      message: 'Meta exchange succeeded but failed to locate WABA ID or Phone Number ID in shared account',
      waba_id: wabaId || null,
      phone_number_id: phoneId || null
    };
    transitionWhatsAppOnboarding(workspaceId, 'exchange_failed', { error: err });
    return { success: false, error: 'NO_WABA_OR_PHONE_RETURNED', message: err.message, meta_error: err };
  }

  // 3. Advance state machine to number_registering and store credentials in vault
  const updatedRecord = transitionWhatsAppOnboarding(workspaceId, 'exchange_success', {
    waba_id: wabaId,
    phone_number_id: phoneId,
    access_token: accessToken,
    display_phone_number: displayPhone,
    verified_name: verifiedName
  });

  return {
    success: true,
    state: updatedRecord.state,
    waba_id: wabaId,
    phone_number_id: phoneId,
    display_phone_number: updatedRecord.display_phone_number,
    verified_name: updatedRecord.verified_name
  };
}

const STARTER_TEMPLATES = [
  {
    name: 'm360_site_visit_invitation',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      {
        type: 'BODY',
        text: 'Hello {{1}}, thank you for your interest in {{2}}. We invite you to schedule an exclusive on-site tour. Reply YES to choose a convenient time slot.'
      }
    ]
  },
  {
    name: 'm360_booking_confirmation',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      {
        type: 'BODY',
        text: 'Hello {{1}}, your booking inquiry for {{2}} (Ref: {{3}}) has been received. Our relationship executive will contact you shortly.'
      }
    ]
  },
  {
    name: 'm360_exclusive_launch_offer',
    category: 'MARKETING',
    language: 'en_US',
    components: [
      {
        type: 'BODY',
        text: 'Hello {{1}}, explore newly released commercial & industrial units at {{2}}. Download our detailed project brochure or reply STOP to opt out.'
      }
    ]
  },
  {
    name: 'm360_site_tour_reminder',
    category: 'UTILITY',
    language: 'en_US',
    components: [
      {
        type: 'BODY',
        text: 'Reminder: Hello {{1}}, your scheduled site visit to {{2}} is confirmed for {{3}}. Please let us know if you need to reschedule.'
      }
    ]
  }
];

function getClientWhatsAppToken(workspaceId) {
  const stored = getStoredProviderCredentials(workspaceId, 'whatsapp');
  if (!stored) return null;
  if (stored.encryptedToken) {
    try {
      return decryptSecret(stored.encryptedToken, workspaceId);
    } catch (_) {}
  }
  return stored.token || process.env.WHATSAPP_API_TOKEN || null;
}

/**
 * Stage 3: Registers client phone number and subscribes Matrix360 app to WABA
 */
async function registerPhoneNumberAndSubscribeWaba({ workspaceId, pin, fetchImpl = globalThis.fetch }) {
  if (!workspaceId) throw new Error('workspace_id is required');
  const wsId = String(workspaceId).trim();
  const record = getWhatsAppOnboardingRecord(wsId);
  const token = getClientWhatsAppToken(wsId);
  const stored = getStoredProviderCredentials(wsId, 'whatsapp') || {};
  const phoneId = record.phone_number_id || stored.phoneNumberId;
  const wabaId = record.waba_id || stored.wabaId;
  const version = process.env.META_GRAPH_VERSION || 'v21.0';

  if (!token || !phoneId || !wabaId) {
    const err = { message: 'Missing phone_number_id, waba_id, or decrypted token. Complete exchange first.' };
    transitionWhatsAppOnboarding(wsId, 'register_and_subscribe_failed', { error: err });
    return { success: false, error: 'MISSING_CREDENTIALS', message: err.message };
  }

  // 1. Register Phone Number with 6-digit PIN
  let registered = false;
  let alreadyRegistered = false;
  try {
    const regUrl = `https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}/register`;
    const regRes = await fetchImpl(regUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        pin: String(pin || '123456')
      })
    });
    const regData = await regRes.json();
    if (regRes.ok && (regData.success || regData.id)) {
      registered = true;
    } else if (regData.error) {
      const msg = String(regData.error.message || '').toLowerCase();
      const code = regData.error.code;
      if (code === 133010 || code === 133016 || msg.includes('already registered')) {
        registered = true;
        alreadyRegistered = true;
      } else if (code === 133005 || msg.includes('two-step') || msg.includes('pin required') || msg.includes('pin')) {
        const err = { message: 'Two-step verification PIN is required to register this phone number. Please enter your 6-digit PIN.', code: 133005, raw: regData.error };
        transitionWhatsAppOnboarding(wsId, 'register_and_subscribe_failed', { error: err });
        return { success: false, error: 'PIN_REQUIRED', message: err.message, meta_error: regData.error };
      } else if (code === 4 || code === 17 || code === 613 || code === 80007 || msg.includes('rate limit') || msg.includes('too many requests')) {
        const err = { message: 'Meta Graph API rate limit exceeded. Please wait a few minutes before retrying.', code: code || 4, raw: regData.error };
        transitionWhatsAppOnboarding(wsId, 'register_and_subscribe_failed', { error: err });
        return { success: false, error: 'RATE_LIMIT_EXCEEDED', message: err.message, meta_error: regData.error };
      } else {
        transitionWhatsAppOnboarding(wsId, 'register_and_subscribe_failed', { error: regData.error });
        return { success: false, error: 'REGISTRATION_FAILED', message: regData.error.message || 'WhatsApp registration failed', meta_error: regData.error };
      }
    }
  } catch (err) {
    const metaErr = { message: err.message, code: 'NETWORK_ERROR' };
    transitionWhatsAppOnboarding(wsId, 'register_and_subscribe_failed', { error: metaErr });
    return { success: false, error: 'REGISTRATION_NETWORK_ERROR', message: err.message };
  }

  // 2. Subscribe Matrix360 App to client's WABA
  let subscribed = false;
  try {
    const subUrl = `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/subscribed_apps`;
    const subRes = await fetchImpl(subUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const subData = await subRes.json();
    if (subRes.ok && (subData.success || subData.id)) {
      subscribed = true;
    } else {
      const err = subData?.error || { message: 'Failed to subscribe app to client WABA' };
      transitionWhatsAppOnboarding(wsId, 'register_and_subscribe_failed', { error: err });
      return { success: false, error: 'SUBSCRIPTION_FAILED', message: err.message, meta_error: err };
    }
  } catch (err) {
    const metaErr = { message: err.message, code: 'NETWORK_ERROR' };
    transitionWhatsAppOnboarding(wsId, 'register_and_subscribe_failed', { error: metaErr });
    return { success: false, error: 'SUBSCRIPTION_NETWORK_ERROR', message: err.message };
  }

  // 3. Both confirmed: advance state
  const updated = transitionWhatsAppOnboarding(wsId, 'register_and_subscribe_success', {
    registered: true,
    subscribed: true
  });

  return {
    success: true,
    registered: true,
    already_registered: alreadyRegistered,
    subscribed: true,
    state: updated.state,
    waba_id: wabaId,
    phone_number_id: phoneId,
    message: alreadyRegistered ? 'Phone number is already registered with WhatsApp Cloud API.' : 'Phone number registered successfully.'
  };
}

/**
 * Stage 4: Submits starter templates to Meta Graph
 */
async function submitStarterTemplates({ workspaceId, templates = STARTER_TEMPLATES, fetchImpl = globalThis.fetch }) {
  if (!workspaceId) throw new Error('workspace_id is required');
  const wsId = String(workspaceId).trim();
  const record = getWhatsAppOnboardingRecord(wsId);
  const token = getClientWhatsAppToken(wsId);
  const stored = getStoredProviderCredentials(wsId, 'whatsapp') || {};
  const wabaId = record.waba_id || stored.wabaId;
  const version = process.env.META_GRAPH_VERSION || 'v21.0';

  if (!token || !wabaId) {
    return { success: false, error: 'MISSING_WABA_CREDENTIALS', message: 'WABA ID or token missing' };
  }

  const existingTemplates = record.templates || [];
  const results = [];

  for (const tpl of templates) {
    const tplUrl = `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/message_templates`;
    try {
      const res = await fetchImpl(tplUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(tpl)
      });
      const data = await res.json();
      if (res.ok && data.id) {
        results.push({
          id: data.id,
          name: tpl.name,
          category: tpl.category,
          language: tpl.language,
          status: data.status || 'PENDING',
          components: tpl.components,
          rejection_reason: null,
          updated_at: new Date().toISOString()
        });
      } else if (data.error && (data.error.code === 100 || String(data.error.message).includes('already exists'))) {
        const found = existingTemplates.find(e => e.name === tpl.name);
        results.push(found || {
          id: 'existing_' + tpl.name,
          name: tpl.name,
          category: tpl.category,
          language: tpl.language,
          status: 'PENDING',
          components: tpl.components,
          rejection_reason: null,
          updated_at: new Date().toISOString()
        });
      } else {
        results.push({
          id: null,
          name: tpl.name,
          category: tpl.category,
          language: tpl.language,
          status: 'REJECTED',
          components: tpl.components,
          rejection_reason: data?.error?.message || 'Meta rejected template submission',
          updated_at: new Date().toISOString()
        });
      }
    } catch (err) {
      results.push({
        id: null,
        name: tpl.name,
        category: tpl.category,
        language: tpl.language,
        status: 'REJECTED',
        components: tpl.components,
        rejection_reason: err.message,
        updated_at: new Date().toISOString()
      });
    }
  }

  transitionWhatsAppOnboarding(wsId, 'templates_updated', { templates: results });

  return {
    success: true,
    templates: results
  };
}

/**
 * Stage 4: Syncs real template statuses from Meta Graph
 */
async function syncTemplateStatuses({ workspaceId, fetchImpl = globalThis.fetch }) {
  if (!workspaceId) throw new Error('workspace_id is required');
  const wsId = String(workspaceId).trim();
  const record = getWhatsAppOnboardingRecord(wsId);
  const token = getClientWhatsAppToken(wsId);
  const stored = getStoredProviderCredentials(wsId, 'whatsapp') || {};
  const wabaId = record.waba_id || stored.wabaId;
  const version = process.env.META_GRAPH_VERSION || 'v21.0';

  if (!token || !wabaId) {
    return { success: false, error: 'MISSING_WABA_CREDENTIALS', message: 'WABA ID or token missing' };
  }

  const queryUrl = `https://graph.facebook.com/${version}/${encodeURIComponent(wabaId)}/message_templates?fields=name,status,category,language,rejected_reason`;
  try {
    const res = await fetchImpl(queryUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.data)) {
      const err = data?.error || { message: 'Failed to read template statuses from Meta Graph' };
      return { success: false, error: 'GRAPH_STATUS_FAILED', message: err.message };
    }

    const currentTemplates = record.templates || [];
    const updatedTemplates = currentTemplates.map(cur => {
      const metaItem = data.data.find(m => m.name === cur.name);
      if (!metaItem) return cur;
      return {
        ...cur,
        status: metaItem.status,
        category: metaItem.category || cur.category,
        rejection_reason: metaItem.rejected_reason || cur.rejection_reason || null,
        updated_at: new Date().toISOString()
      };
    });

    for (const metaItem of data.data) {
      if (!updatedTemplates.some(t => t.name === metaItem.name)) {
        updatedTemplates.push({
          id: metaItem.id || ('meta_' + metaItem.name),
          name: metaItem.name,
          category: metaItem.category,
          language: metaItem.language,
          status: metaItem.status,
          rejection_reason: metaItem.rejected_reason || null,
          updated_at: new Date().toISOString()
        });
      }
    }

    const updatedRecord = transitionWhatsAppOnboarding(wsId, 'templates_updated', { templates: updatedTemplates });

    return {
      success: true,
      templates: updatedTemplates,
      state: updatedRecord.state,
      all_approved: updatedTemplates.length > 0 && updatedTemplates.every(t => t.status === 'APPROVED')
    };
  } catch (err) {
    return { success: false, error: 'STATUS_SYNC_NETWORK_ERROR', message: err.message };
  }
}

/**
 * Stage 5: Sends a single template message to the owner's own number.
 * No fabricated IDs: missing or failed Meta response fails with NO_PROVIDER_ID.
 * State is NOT advanced to ready_limited here — only a webhook delivery receipt can advance state.
 */
async function sendOnboardingTestMessage({ workspaceId, templateName, ownerPhone, fetchImpl = globalThis.fetch }) {
  if (!workspaceId) throw new Error('workspace_id is required');
  const wsId = String(workspaceId).trim();
  const record = getWhatsAppOnboardingRecord(wsId);
  const token = getClientWhatsAppToken(wsId);
  const stored = getStoredProviderCredentials(wsId, 'whatsapp') || {};
  const phoneId = record.phone_number_id || stored.phoneNumberId;
  const version = process.env.META_GRAPH_VERSION || 'v21.0';

  if (!token || !phoneId) {
    return { success: false, error: 'MISSING_CREDENTIALS', message: 'Token or phone_number_id missing' };
  }

  const recipientPhone = String(ownerPhone || record.display_phone_number || stored.displayPhoneNumber || '').replace(/[^\d+]/g, '');
  if (!recipientPhone || recipientPhone.replace(/\D/g, '').length < 10) {
    return { success: false, error: 'INVALID_OWNER_PHONE', message: 'A valid owner phone number is required for test delivery' };
  }

  const targetTemplate = templateName || (record.templates.find(t => t.status === 'APPROVED')?.name) || 'm360_site_visit_invitation';
  const foundTpl = (record.templates || []).find(t => t.name === targetTemplate);
  if (foundTpl && foundTpl.status !== 'APPROVED') {
    return {
      success: false,
      status: 'template_not_approved',
      error: 'TEMPLATE_NOT_APPROVED',
      message: `Template '${targetTemplate}' is not approved (status: ${foundTpl.status}). Non-approved templates cannot be sent.`
    };
  }
  const cleanDigits = recipientPhone.replace(/\D/g, '');
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}/messages`;

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanDigits,
        type: 'template',
        template: {
          name: targetTemplate,
          language: { code: 'en_US' }
        }
      })
    });

    const data = await res.json();
    const messageId = data?.messages?.[0]?.id;

    if (!res.ok || !messageId) {
      const err = data?.error || { message: 'Meta returned no message id', code: 'NO_PROVIDER_ID' };
      saveWhatsAppOnboardingRecord(wsId, { last_meta_error: err });
      return {
        success: false,
        status: 'failed',
        provider_message_id: null,
        error: 'NO_PROVIDER_ID',
        message: err.message,
        meta_error: err
      };
    }

    // Save test_message_id. State is NOT advanced here — waiting for webhook delivery!
    saveWhatsAppOnboardingRecord(wsId, { test_message_id: messageId, last_meta_error: null });

    return {
      success: true,
      status: 'dispatched',
      provider_message_id: messageId,
      template_name: targetTemplate,
      recipient: cleanDigits,
      message: 'Test message dispatched to owner phone. Awaiting webhook delivery callback.'
    };
  } catch (err) {
    saveWhatsAppOnboardingRecord(wsId, { last_meta_error: { message: err.message, code: 'NETWORK_ERROR' } });
    return {
      success: false,
      status: 'failed',
      provider_message_id: null,
      error: 'NETWORK_ERROR',
      message: err.message
    };
  }
}

function getOnboardingNextAction(record) {
  if (!record || record.state === 'not_started') {
    return {
      step: 1,
      title: 'Meta Embedded Signup',
      action: 'Click "Connect WhatsApp Number" to select or create your WhatsApp Business Account.'
    };
  }
  if (record.state === 'awaiting_client_login') {
    return {
      step: 1,
      title: 'Complete Meta Login',
      action: 'Finish the Meta popup login to link your business portfolio.'
    };
  }
  if (record.state === 'number_registering') {
    return {
      step: 2,
      title: 'Register Phone Number',
      action: 'Enter your 6-digit registration PIN to register your number with WhatsApp.'
    };
  }
  if (record.state === 'templates_in_review') {
    if (!record.test_delivery_confirmed_at) {
      return {
        step: 3,
        title: 'Send & Confirm Test Delivery',
        action: 'Templates submitted to Meta. Dispatch a test message to your registered number to confirm delivery.'
      };
    }
    return {
      step: 3,
      title: 'Awaiting Template Approval',
      action: 'Test delivery confirmed! Waiting for Meta to finish reviewing your message templates (expected 2-24 hours).'
    };
  }
  if (record.state === 'ready_limited') {
    return {
      step: 4,
      title: 'Ready for Outreach (Tier 250)',
      action: 'Your WhatsApp number is ready for outreach up to 250 conversations/day. Complete Meta Business Verification in Meta Business Suite to unlock 2,000+/day.'
    };
  }
  if (record.state === 'verified') {
    return {
      step: 5,
      title: 'Fully Verified (Tier 2,000+)',
      action: 'Your account is verified and ready for high-volume broadcasts.'
    };
  }
  return {
    step: 0,
    title: 'Needs Attention',
    action: record.last_meta_error?.message || 'Check the error message and retry or contact support.'
  };
}

function getWhatsAppRateDisclosure() {
  return {
    marketing: {
      base_inr: 0.8631,
      gst_pct: 18,
      total_inr: 1.0185,
      description: 'Promotional, offers, newsletters, and announcements'
    },
    utility: {
      base_inr: 0.1150,
      gst_pct: 18,
      total_inr: 0.1357,
      description: 'Booking confirmations, reminders, and updates'
    },
    service: {
      base_inr: 0.0,
      gst_pct: 0,
      total_inr: 0.0,
      description: 'Inbound customer care replies within 24-hour service window (Free)'
    },
    provider_note: 'Billed directly by Meta per delivered message. Matrix360 adds zero markup.'
  };
}

/**
 * Stage 3: Guarded WhatsApp self-test for platform_owner.
 * Runs real flow end-to-end against Meta for ONE workspace and ONE owner phone number.
 * Refuses to run if any required env var is missing.
 * Never sends to anyone but the specified owner phone.
 * Stops and returns the real error if any Graph call fails.
 * Redacts tokens from all outputs.
 */
async function runGuardedWhatsAppSelfTest({ workspaceId, ownerPhone, fetchImpl = globalThis.fetch }) {
  if (!workspaceId) throw new Error('workspace_id is required');
  const wsId = String(workspaceId).trim();

  // Validate E.164 phone
  const cleanPhone = String(ownerPhone || '').trim().replace(/[\s-]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(cleanPhone)) {
    return {
      success: false,
      status: 'invalid_phone',
      error: 'Owner phone must be a valid E.164 phone number starting with +'
    };
  }

  // Check required Meta environment variables
  const appId = String(process.env.META_APP_ID || '').trim();
  const appSecret = String(process.env.META_APP_SECRET || '').trim();
  const systemToken = String(process.env.META_SYSTEM_USER_TOKEN || '').trim();
  const vaultKey = String(process.env.M360_TENANT_ENCRYPTION_KEY || '').trim();
  const version = String(process.env.META_GRAPH_VERSION || 'v21.0').trim();

  const missing = [];
  if (!appId) missing.push('META_APP_ID');
  if (!appSecret) missing.push('META_APP_SECRET');
  if (!systemToken) missing.push('META_SYSTEM_USER_TOKEN');
  if (!vaultKey) missing.push('M360_TENANT_ENCRYPTION_KEY');

  if (missing.length > 0) {
    return {
      success: false,
      status: 'missing_keys',
      error: 'Required Meta environment variables are missing',
      missing_keys: missing,
      skipped: true,
      reason: 'Keys not set in environment. Set META_APP_ID, META_APP_SECRET, META_SYSTEM_USER_TOKEN, and M360_TENANT_ENCRYPTION_KEY to run live self-test.'
    };
  }

  const logSteps = [];

  // Step 1: Verify Meta System User Token
  try {
    const meRes = await fetchImpl(`https://graph.facebook.com/${version}/me?fields=id,name`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${systemToken}` }
    });
    const meData = await meRes.json();
    if (!meRes.ok) {
      return {
        success: false,
        status: 'system_token_failed',
        step: 'verify_system_user',
        error: meData.error || { message: 'System user token rejected by Meta Graph' },
        steps_completed: logSteps
      };
    }
    logSteps.push({ step: 'verify_system_user', status: 'ok', meta_app: meData });
  } catch (err) {
    return {
      success: false,
      status: 'network_error',
      step: 'verify_system_user',
      error: { message: err.message },
      steps_completed: logSteps
    };
  }

  // Step 2: Retrieve workspace onboarding record & client token
  const record = getWhatsAppOnboardingRecord(wsId);
  const clientToken = getClientWhatsAppToken(wsId);
  const wabaId = record.waba_id;
  const phoneId = record.phone_number_id;

  if (!clientToken || !wabaId || !phoneId) {
    return {
      success: false,
      status: 'workspace_not_onboarded',
      step: 'check_workspace_credentials',
      error: { message: 'Workspace has not completed Embedded Signup (missing client token, WABA ID, or Phone ID)' },
      steps_completed: logSteps
    };
  }
  logSteps.push({ step: 'check_workspace_credentials', status: 'ok', waba_id: wabaId, phone_number_id: phoneId });

  // Step 3: Check Phone Number Status on Meta Graph
  try {
    const phoneRes = await fetchImpl(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneId)}?fields=id,verified_name,display_phone_number,quality_rating,code_verification_status`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${clientToken}` }
    });
    const phoneData = await phoneRes.json();
    if (!phoneRes.ok) {
      return {
        success: false,
        status: 'phone_status_failed',
        step: 'query_phone_status',
        error: phoneData.error || { message: 'Phone status lookup failed on Meta Graph' },
        steps_completed: logSteps
      };
    }
    logSteps.push({ step: 'query_phone_status', status: 'ok', phone_details: phoneData });
  } catch (err) {
    return {
      success: false,
      status: 'network_error',
      step: 'query_phone_status',
      error: { message: err.message },
      steps_completed: logSteps
    };
  }

  // Step 4: Dispatch test template message to specified owner phone ONLY
  const sendResult = await sendOnboardingTestMessage({
    workspaceId: wsId,
    templateName: 'm360_site_visit_invitation',
    ownerPhone: cleanPhone,
    fetchImpl
  });

  if (!sendResult.success) {
    return {
      success: false,
      status: 'test_send_failed',
      step: 'send_test_message',
      error: sendResult.meta_error || { message: sendResult.message },
      steps_completed: logSteps
    };
  }

  logSteps.push({
    step: 'send_test_message',
    status: 'dispatched',
    provider_message_id: sendResult.provider_message_id,
    recipient: cleanPhone
  });

  return {
    success: true,
    status: 'completed',
    recipient: cleanPhone,
    provider_message_id: sendResult.provider_message_id,
    steps_completed: logSteps,
    message: 'Guarded self-test completed successfully. Awaiting webhook delivery callback.'
  };
}

/**
 * Stage 5: Preview WhatsApp broadcast with AiSensy-style audience filtering and rate estimation.
 */
function previewWhatsAppBroadcast({ workspaceId, templateName, templateVariables = [], tagFilter = null, contacts = [] }) {
  if (!workspaceId) throw new Error('workspace_id is required');
  const wsId = String(workspaceId).trim();
  const record = getWhatsAppOnboardingRecord(wsId);

  // Validate template is APPROVED
  const tpl = (record.templates || []).find(t => t.name === templateName);
  if (!tpl) {
    return {
      success: false,
      code: 'TEMPLATE_NOT_FOUND',
      message: `Template '${templateName}' not found in workspace templates.`
    };
  }
  if (tpl.status !== 'APPROVED') {
    return {
      success: false,
      code: 'TEMPLATE_NOT_APPROVED',
      message: `Template '${templateName}' has status '${tpl.status}'. Only APPROVED templates can be used for broadcasts.`
    };
  }

  // Filter contacts by tag, phone validity, consent, and suppression
  const eligible = [];
  const excluded = [];
  const excludedBreakdown = {
    tag_mismatch: 0,
    invalid_phone: 0,
    missing_consent: 0,
    suppressed_or_opted_out: 0
  };

  const suppressions = getSuppressions(wsId);
  const consents = getConsents(wsId);

  for (const c of contacts) {
    if (tagFilter && Array.isArray(c.tags) && !c.tags.includes(tagFilter)) {
      excluded.push({ contact_id: c.id, reason: 'tag_mismatch' });
      excludedBreakdown.tag_mismatch++;
      continue;
    }
    if (!isValidIdentifier(c, 'whatsapp')) {
      excluded.push({ contact_id: c.id, reason: 'invalid_phone' });
      excludedBreakdown.invalid_phone++;
      continue;
    }
    if (isSuppressed(c, 'whatsapp', suppressions)) {
      excluded.push({ contact_id: c.id, reason: 'suppressed_or_opted_out' });
      excludedBreakdown.suppressed_or_opted_out++;
      continue;
    }
    if (!hasGrantedConsent(c, 'whatsapp', consents)) {
      excluded.push({ contact_id: c.id, reason: 'missing_consent' });
      excludedBreakdown.missing_consent++;
      continue;
    }
    eligible.push(c);
  }

  // Generate sample preview text with variable substitution
  let samplePreview = '';
  const bodyComponent = (tpl.components || []).find(comp => comp.type === 'BODY');
  if (bodyComponent && bodyComponent.text) {
    samplePreview = bodyComponent.text;
    templateVariables.forEach((val, idx) => {
      samplePreview = samplePreview.replaceAll(`{{${idx + 1}}}`, String(val));
    });
  }

  // Cost calculation based on real rates
  const cat = String(tpl.category || 'MARKETING').toLowerCase();
  const baseRate = RATES.WhatsApp[cat] !== undefined ? RATES.WhatsApp[cat] : RATES.WhatsApp.marketing;
  const totalPerMessage = Number((baseRate * (1 + GST_RATE)).toFixed(4));
  const totalEstimatedCost = Number((eligible.length * totalPerMessage).toFixed(4));

  return {
    success: true,
    template: {
      name: tpl.name,
      category: tpl.category,
      language: tpl.language,
      status: tpl.status
    },
    sample_preview: samplePreview,
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
      category: cat,
      meta_base_rate_inr: baseRate,
      gst_pct: GST_RATE * 100,
      meta_fee_per_message_inr: totalPerMessage,
      matrix360_fee_per_message_inr: 0.0,
      total_estimated_cost_inr: totalEstimatedCost,
      provider_note: 'Billed directly by Meta per delivered message. Matrix360 adds zero markup.'
    }
  };
}

const WHATSAPP_CAMPAIGN_RESULTS = new Map();

function recordWhatsAppCampaignDeliveryEvent(workspaceId, correlationId, { messageId, status, recipientId, timestamp }) {
  const key = `${workspaceId}:${correlationId}`;
  let entry = WHATSAPP_CAMPAIGN_RESULTS.get(key);
  if (!entry) {
    entry = {
      workspace_id: workspaceId,
      correlation_id: correlationId,
      dispatched: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
      opted_out: 0,
      events: []
    };
    WHATSAPP_CAMPAIGN_RESULTS.set(key, entry);
  }
  entry.events.push({ messageId, status, recipientId, timestamp: timestamp || new Date().toISOString() });
  if (status === 'delivered') entry.delivered++;
  else if (status === 'read') entry.read++;
  else if (status === 'replied') entry.replied++;
  else if (status === 'failed') entry.failed++;
  else if (status === 'opted_out') entry.opted_out++;
  return entry;
}

function getWhatsAppCampaignResults(workspaceId, correlationId) {
  const key = `${workspaceId}:${correlationId}`;
  const entry = WHATSAPP_CAMPAIGN_RESULTS.get(key);
  if (!entry) {
    return {
      workspace_id: workspaceId,
      correlation_id: correlationId,
      dispatched: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
      opted_out: 0,
      events: []
    };
  }
  return { ...entry, events: [...entry.events] };
}

function getAllWhatsAppCampaignResults(workspaceId) {
  const list = [];
  for (const entry of WHATSAPP_CAMPAIGN_RESULTS.values()) {
    if (workspaceId && entry.workspace_id !== workspaceId) continue;
    list.push({ ...entry, events: [...entry.events] });
  }
  return list;
}

function clearWhatsAppCampaignResultsStore() {
  WHATSAPP_CAMPAIGN_RESULTS.clear();
}

module.exports = {
  WHATSAPP_ONBOARDING_STATES,
  ONBOARDING_TIERS,
  STARTER_TEMPLATES,
  getWhatsAppOnboardingRecord,
  saveWhatsAppOnboardingRecord,
  syncWhatsAppOnboardingFromDurable,
  clearWhatsAppOnboardingStore,
  getMetaOnboardingConfig,
  getClientWhatsAppToken,
  transitionWhatsAppOnboarding,
  exchangeEmbeddedSignupCode,
  registerPhoneNumberAndSubscribeWaba,
  submitStarterTemplates,
  syncTemplateStatuses,
  sendOnboardingTestMessage,
  getOnboardingNextAction,
  getWhatsAppRateDisclosure,
  runGuardedWhatsAppSelfTest,
  previewWhatsAppBroadcast,
  recordWhatsAppCampaignDeliveryEvent,
  getWhatsAppCampaignResults,
  getAllWhatsAppCampaignResults,
  clearWhatsAppCampaignResultsStore
};
