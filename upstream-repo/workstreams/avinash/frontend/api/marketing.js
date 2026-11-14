'use strict';

const {workspaceContext}=require('../lib/m360-workspace-context');
const {hasPrivatePreviewEmailSession}=require('./gateway');
const { randomUUID } = require('node:crypto');
const { timingSafeEqual } = require('node:crypto');

/**
 * Matrix360 Marketing API Endpoint
 *
 * Exposes:
 * - POST /api/marketing/dispatch -> starts or registers a marketing task from HandoverEnvelope
 * - GET  /api/marketing/tasks    -> retrieves task status, step progress, drafts & readiness
 * - GET  /api/marketing/events   -> SSE stream for real-time progress steps
 * - POST /api/marketing/revise   -> surgical natural-language revision of targeted channels
 * - POST /api/marketing/approve  -> approves draft for a specific channel
 * - POST /api/marketing/handoff  -> accepts reverse handoffs from Leads or Content
 */

const {
  createHandoverEnvelope,
  dispatchMarketingTask,
  getMarketingTask,
  listMarketingTasks,
  getWorkspaceMarketingTasks,
  findWorkspaceByWhatsAppPhoneNumberId,
  findWorkspaceByContactPhone,
  reviseMarketingTaskDraft,
  approveChannelDraft,
  executeMarketingChannel,
  attachVerifiedHandoff,
  importLeadsToTask,
  attachEmailCreative,
  mutateCampaignCalendar,
  mutateCampaignJourney,
  broadcastTaskTelemetry,
  restoreMarketingTask,
  saveTasksToDisk,
  configureMarketingProvider,
  initAgentTeamBoard,
  assignAgentTask,
  reviewAgentDeliverable,
  postInterAgentMessage,
  switchPersonaMode,
  verifyMarketingProvider,
  createMarketingConversation,
  continueMarketingConversation,
  getMarketingConversation,
  addConversationMessage,
  getTaskEventEmitter,
  getStoredProviderCredentials,
  getTenantMasterKey
} = require('../lib/m360-marketing-orchestrator');
const { generateWhatsAppDeepLink, normalizePhoneNumber } = require('../lib/m360-whatsapp-provider');
const { verifyWebhookSignature } = require('../lib/m360-provider-adapters');
const { createEmailToCTWABridgeDraft, evaluateChannelReadiness } = require('../lib/m360-channel-readiness');
const { importCsv } = require('../lib/m360-csv-import');
const { recordSuppression, recordConsent, isEligible, isValidIdentifier, isSuppressed } = require('../lib/m360-consent');
const { estimateChannelCostInr } = require('../lib/m360-rates');
const durableStore = require('../lib/m360-marketing-durable-store');
const { estimateBudgetScenarios, calculateABSampleSize } = require('../lib/m360-budget-estimator');
const { importIntoCrm } = require('../lib/m360-crm-import-client');
const { loadSavedContentAssets, loadEmailCreative } = require('../lib/m360-content-assets-client');
const { can } = require('../lib/m360-permissions');
const { checkWorkspaceQuota, recordSendQuotaUsage } = require('../lib/m360-quota');
const {
  getWhatsAppOnboardingRecord,
  saveWhatsAppOnboardingRecord,
  syncWhatsAppOnboardingFromDurable,
  getMetaOnboardingConfig,
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
  getWhatsAppCampaignResults
} = require('../lib/m360-whatsapp-onboarding');

const {
  getEmailOnboardingRecord,
  saveEmailOnboardingRecord,
  syncEmailOnboardingFromDurable,
  transitionEmailOnboarding,
  checkDomainDnsRecords,
  sendEmailOnboardingTestMessage,
  previewEmailBroadcast,
  recordEmailCampaignDeliveryEvent,
  getEmailCampaignResults
} = require('../lib/m360-email-onboarding');

const {
  runChatToCampaignWorkflow
} = require('../lib/agents/supervisor');

const CRM = 'https://matrix360-crm-backend-p9os.onrender.com';
const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const WRITERS = new Set(['platform_owner', 'agency_admin', 'client_admin', 'marketing_operator', 'sales_operator']);
const APPROVERS = new Set(['platform_owner', 'agency_admin', 'client_admin', 'marketing_operator']);

async function authorize(req, workspaceId, permission = 'read', emailAction = false) {
  const bearer = String(req.headers?.authorization || req.headers?.Authorization || '');
  if (process.env.M360_SHOWCASE_ENABLED === 'true' && workspaceId === 'showcase' && bearer === 'Bearer matrix360-isolated-showcase') return { status: 200, bearer, showcase: true, membership: { id: 'showcase', name: 'Northstar Industries — Demo', role: 'marketing_operator', profile_type: 'b2b_industrial' } };
  if (!/^Bearer [A-Za-z0-9_.-]{20,8000}$/.test(bearer)) return { status: 401, message: 'Sign in to your Matrix 360 workspace.' };
  if (!WORKSPACE_ID.test(workspaceId)) return { status: 400, message: 'Select a valid business workspace.' };
  let response;
  try {
    response = await fetch(CRM + '/me/workspaces', {
      headers: { Authorization: bearer, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000)
    });
  } catch {
    return { status: 503, message: 'CRM workspace authorization is temporarily unavailable.' };
  }
  if (response.status === 401 || response.status === 403) return { status: 401, message: 'Your CRM session has expired.' };
  if (!response.ok) return { status: 503, message: 'CRM workspace authorization could not be verified.' };
  const memberships = await response.json().catch(() => null);
  if (!Array.isArray(memberships)) return { status: 503, message: 'CRM returned an invalid membership response.' };
  const membership = memberships.find(item => String(item?.id) === workspaceId && typeof item.role === 'string');
  if (!membership) return { status: 403, message: 'Business workspace access denied.' };
  if (permission === 'write' && (!can(membership.role, 'write') || !WRITERS.has(membership.role))) return { status: 403, message: 'Your role cannot change Outreach work.' };
  const ownerEmail=permission==='approve'&&emailAction&&membership.role==='sales_operator'&&
    process.env.VERCEL_ENV==='preview'&&process.env.M360_MARKETING_CONTROLLED_TEST_ONLY==='true'&&
    workspaceId==='lakhotia'&&workspaceId===process.env.M360_MARKETING_TEST_WORKSPACE&&
    process.env.M360_MARKETING_OWNER_DIRECT_EMAIL==='true';
  const privateEmail=Boolean(ownerEmail&&hasPrivatePreviewEmailSession(req,bearer));
  if (permission === 'approve' && (!can(membership.role, 'approve') || !APPROVERS.has(membership.role)) && !privateEmail)
    return {status:403,message:ownerEmail?'Sign out of the shared preview and sign in privately to approve or send this email.':'Your role cannot approve Outreach work.'};
  if (permission === 'send' && !can(membership.role, 'send') && !privateEmail)
    return { status: 403, message: 'Your role cannot send campaigns.' };
  return { status: 200, membership, bearer, privateEmail };
}

function showcaseContext(body, access) {
  if (!access.showcase) return null;
  const profile = body.showcase_profile && typeof body.showcase_profile === 'object' ? body.showcase_profile : {};
  return { workspace_id: 'showcase', available: true, storage_ready: false, profile: { business_name: String(profile.business_name || access.membership.name).slice(0, 200), industry: String(profile.industry || '').slice(0, 120), description: String(profile.description || '').slice(0, 1000), products_services: Array.isArray(profile.products_services) ? profile.products_services.map(value => String(value).slice(0, 160)).slice(0, 20) : [], approved_claims: [] }, source: 'isolated_showcase_browser' };
}

function normalizedAudience(records, testData = false) {
  if (!Array.isArray(records)) return [];
  return records.slice(0, 2000).filter(item => item && (item.id || item.name)).map(item => ({
    id: String(item.id || randomUUID()).slice(0, 200), name: String(item.name || 'CRM lead').slice(0, 200), company_name: String(item.company_name || item.company || '').slice(0, 200), company: String(item.company || item.company_name || '').slice(0, 200), title: String(item.title || item.role || '').slice(0, 120), role: String(item.role || item.title || '').slice(0, 120),
    email: typeof item.email === 'string' ? item.email.trim().toLowerCase().slice(0, 320) : '', phone: typeof item.phone === 'string' ? item.phone.trim().slice(0, 40) : '',
    source: String(item.source || 'Matrix 360 CRM').slice(0, 150), stage: String(item.stage || 'enquiry').slice(0, 80),
    email_opt_in_status: ['granted', 'opted_in'].includes(item.email_opt_in_status) ? 'granted' : item.email_opt_in_status === 'unsubscribed' ? 'unsubscribed' : 'unknown',
    whatsapp_opt_in_status: item.whatsapp_opt_in_status === 'granted' ? 'granted' : 'unknown', sms_opt_in_status: item.sms_opt_in_status === 'granted' ? 'granted' : 'unknown',
    consent_evidence: item.consent_evidence && typeof item.consent_evidence === 'object' ? item.consent_evidence : {}, test_data: Boolean(testData), outbound_blocked: Boolean(testData)
  }));
}

async function crmAudience(workspaceId, bearer) {
  const response = await fetch(`${CRM}/workspaces/${encodeURIComponent(workspaceId)}/leads`, { headers: { Authorization: bearer, Accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error('Authorized CRM audience could not be loaded.'), { code: `CRM_AUDIENCE_HTTP_${response.status}` });
  const rows = await response.json().catch(() => null);
  if (!Array.isArray(rows)) throw Object.assign(new Error('CRM audience response was invalid.'), { code: 'CRM_AUDIENCE_INVALID_RESPONSE' });
  return normalizedAudience(rows, false);
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}

function error(res, status, message) {
  json(res, status, { status: 'error', error: message });
}

function safeTokenMatch(actual, expected) {
  const a = Buffer.from(String(actual || '')), b = Buffer.from(String(expected || ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

async function findTask(workspaceId, correlationId) {
  const task = getMarketingTask(workspaceId, correlationId) || await durableStore.loadTask(workspaceId, correlationId);
  return task ? restoreMarketingTask(task) : null;
}

module.exports = async (req, res, options = {}) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Extract path and query
  const url = new URL(req.url || '/api/marketing', 'http://127.0.0.1');
  const pathname = url.pathname.replace(/^\/api\/marketing\/?/, '').replace(/\/$/, '');
  const method = req.method || 'GET';
  const query = req.query || Object.fromEntries(url.searchParams);
  const action = pathname || query.action || query.path || '';

  if (action === 'linkedin' || query.action === 'linkedin' || url.pathname.startsWith('/api/linkedin')) {
    return require('../lib/m360-linkedin-api')(req, res, options);
  }

  // Parse JSON body if present
  let body = req.body;
  if (typeof body === 'string' && body.trim()) {
    try { body = JSON.parse(body); } catch { return error(res, 400, 'Invalid JSON body'); }
  } else if (!body) {
    body = {};
  }

  // LinkedIn OAuth direct for legacy token-vault endpoints
  if ((action === 'providers/configure' || action === 'providers/verify') && (body?.provider === 'linkedin' || query.provider === 'linkedin')) {
    return json(res, 409, {
      status: 'linkedin_oauth_required',
      message: action === 'providers/configure'
        ? 'Connect each LinkedIn account in LinkedIn Campaigns & Publishing.'
        : 'Inspect the actual LinkedIn connection and destination permissions in Accounts.',
      endpoint: '/api/linkedin'
    });
  }

  try {
    getTenantMasterKey();
  } catch (err) {
    if (err.code === 'VAULT_KEY_MISSING' || String(err.message).includes('VAULT_KEY_MISSING')) {
      return error(res, 503, 'Marketing API unavailable: VAULT_KEY_MISSING');
    }
    throw err;
  }

  if (action === 'webhooks/brevo' && method === 'POST') {
    const rawBuffer = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : typeof req.rawBody === 'string'
        ? Buffer.from(req.rawBody, 'utf8')
        : Buffer.isBuffer(req.body)
          ? req.body
          : typeof req.body === 'string'
            ? Buffer.from(req.body, 'utf8')
            : (req.body ? Buffer.from(JSON.stringify(req.body), 'utf8') : Buffer.alloc(0));

    const signature = req.headers['x-sib-signature'] || req.headers['x-brevo-signature'] || req.headers['x-hub-signature-256'] || '';
    const secret = process.env.BREVO_WEBHOOK_SECRET || process.env.WHATSAPP_APP_SECRET || '';

    let authenticated = false;
    if (signature && secret) {
      authenticated = verifyWebhookSignature(secret, rawBuffer, signature);
    } else {
      const expected = process.env.BREVO_WEBHOOK_BEARER_TOKEN || '';
      const actual = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      authenticated = (expected.length >= 24 && safeTokenMatch(actual, expected));
    }

    if (!authenticated) {
      return error(res, 401, 'Provider webhook authentication failed.');
    }

    let payload = (body && typeof body === 'object' && Object.keys(body).length > 0) ? body : null;
    if (!payload && rawBuffer.length > 0) {
      try {
        payload = JSON.parse(rawBuffer.toString('utf8'));
      } catch (_) {
        return error(res, 400, 'Invalid JSON body');
      }
    }
    payload ||= {};

    // Stage 9 & Phase 5: Process bounce & complaint suppression
    const { handleBrevoWebhookEvent } = require('../lib/m360-email-compliance');
    let complianceResult = null;
    try {
      complianceResult = await handleBrevoWebhookEvent(payload);
    } catch (_) {}

    const eventType = String(payload.event || payload['event'] || '').toLowerCase();
    const msgId = String(payload['message-id'] || payload.messageId || payload.id || '').trim();
    const email = String(payload.email || payload['email'] || '').trim().toLowerCase();
    const wsId = String(payload.workspace_id || query.workspace_id || 'default').trim();

    // Delivery confirmation for email onboarding test email
    if (['delivered', 'request', 'open', 'opened'].includes(eventType)) {
      const onboardingRec = getEmailOnboardingRecord(wsId);
      if (onboardingRec && onboardingRec.test_message_id && onboardingRec.test_message_id === msgId) {
        transitionEmailOnboarding(wsId, 'test_delivery_confirmed', {
          message_id: msgId,
          confirmed_at: new Date().toISOString()
        });
      }
    }

    // Record real campaign delivery event for campaign results
    if (msgId) {
      recordEmailCampaignDeliveryEvent(wsId, msgId, {
        messageId: msgId,
        status: eventType,
        recipientEmail: email,
        timestamp: new Date().toISOString()
      });
    }

    // Pause workspace onboarding if complaint rate exceeds 0.3%
    if (complianceResult?.workspacePaused) {
      transitionEmailOnboarding(wsId, 'provider_bounce_or_complaint', {
        paused: true,
        error: { message: 'Sending paused: spam complaint rate exceeded 0.3% threshold.' }
      });
    }

    try {
      const event = await durableStore.recordBrevoEvent(payload);
      return json(res, 202, { status: 'accepted', provider_event_id: event.provider_event_id });
    } catch (webhookError) {
      if (complianceResult?.processed) {
        return json(res, 200, { status: 'suppression_recorded', ...complianceResult });
      }
      return error(res, webhookError.code === 'EXECUTION_NOT_FOUND' ? 404 : webhookError.code === 'INVALID_PROVIDER_EVENT' ? 400 : 503, webhookError.message);
    }
  }

  // One-Click Unsubscribe Endpoint (RFC 8058 - No Login Required)
  if (action === 'unsubscribe') {
    const email = String(body.email || query.email || '').trim().toLowerCase();
    const wsId = String(body.workspace_id || query.workspace_id || 'default').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return error(res, 400, 'Valid email address is required to unsubscribe.');
    }

    const { recordSuppression } = require('../lib/m360-consent');
    await recordSuppression(wsId, {
      email,
      channel: 'email',
      reason: 'one_click_unsubscribe',
      source: 'unsubscribe_endpoint'
    });

    if (method === 'GET' && req.headers?.accept?.includes('text/html')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(`<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;text-align:center;padding:48px;"><h2>Unsubscribed</h2><p>Your email address <strong>${email}</strong> has been unsubscribed from all marketing communications.</p></body></html>`);
    }

    return json(res, 200, {
      status: 'unsubscribed',
      email,
      message: 'You have been successfully unsubscribed from commercial emails.'
    });
  }

  // Meta WhatsApp Cloud API Webhooks (Challenge & Event Receiver)
  if (action === 'webhooks/whatsapp' && method === 'GET') {
    const mode = query['hub.mode'] || query.hub_mode;
    const token = query['hub.verify_token'] || query.hub_verify_token;
    const challenge = query['hub.challenge'] || query.hub_challenge;
    const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';
    if (mode === 'subscribe' && expectedToken && token === expectedToken) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end(String(challenge));
    }
    return error(res, 403, 'Webhook verification failed');
  }

  if (action === 'webhooks/whatsapp' && method === 'POST') {
    const signature = req.headers['x-hub-signature-256'] || '';
    const appSecret = process.env.WHATSAPP_APP_SECRET || '';

    // X1: Read raw body bytes without JSON.stringify fallback
    const rawBuffer = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : typeof req.rawBody === 'string'
        ? Buffer.from(req.rawBody, 'utf8')
        : Buffer.isBuffer(req.body)
          ? req.body
          : typeof req.body === 'string'
            ? Buffer.from(req.body, 'utf8')
            : (req.body ? Buffer.from(JSON.stringify(req.body), 'utf8') : Buffer.alloc(0));

    if (!verifyWebhookSignature(appSecret, rawBuffer, signature)) {
      return error(res, 401, 'Webhook signature verification failed');
    }

    let payload = (body && typeof body === 'object' && Object.keys(body).length > 0) ? body : null;
    if (!payload && rawBuffer.length > 0) {
      try {
        payload = JSON.parse(rawBuffer.toString('utf8'));
      } catch (_) {
        return error(res, 400, 'Invalid JSON body');
      }
    }
    payload ||= {};

    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        const val = change?.value;
        if (!val) continue;

        // R1: Resolve workspace tenant from phone_number_id (never loop over all tasks across all tenants)
        const phoneNumberId = val.metadata?.phone_number_id;
        const tenantWorkspaceId = findWorkspaceByWhatsAppPhoneNumberId(phoneNumberId);

        const messages = Array.isArray(val.messages) ? val.messages : [];
        for (const msg of messages) {
          const rawFrom = String(msg.from || '').replace(/[^\d+]/g, '');
          const from = rawFrom.startsWith('+') ? rawFrom : ('+' + rawFrom);
          const effectiveTenantWorkspaceId = tenantWorkspaceId || findWorkspaceByContactPhone(rawFrom) || 'default';
          const tenantTasks = getWorkspaceMarketingTasks(effectiveTenantWorkspaceId);
          const textBody = String(msg.text?.body || '').trim();

          // S1: Multilingual STOP / opt-out terms (English, Hindi, Bengali) up to 4 words + button events
          const cleanText = textBody.toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/g, ' ').trim();
          const wordCount = cleanText ? cleanText.split(/\s+/).length : 0;
          const isStopTerm = wordCount > 0 && wordCount <= 4 && (
            /\b(?:stop|unsubscribe|cancel|opt\s*out)\b/i.test(cleanText) ||
            cleanText.includes('stop all') ||
            cleanText.includes('बंद करो') ||
            cleanText.includes('बंद') ||
            cleanText.includes('रोकें') ||
            cleanText.includes('বন্ধ করুন') ||
            cleanText.includes('বন্ধ')
          );

          const isButtonOptOut = (msg.type === 'button' && (isStopTerm || /opt_?out/i.test(msg.button?.payload || msg.button?.text || ''))) ||
                                 (msg.type === 'interactive' && (isStopTerm || /opt_?out/i.test(msg.interactive?.button_reply?.id || msg.interactive?.button_reply?.title || '')));

          const isOptOut = isStopTerm || isButtonOptOut;

          if (isOptOut) {
            // Write a suppression row for this tenant
            recordSuppression(effectiveTenantWorkspaceId, {
              channel: 'whatsapp',
              value_normalized: from,
              reason: 'user_opt_out'
            });
            if (cleanText.includes('stop all')) {
              recordSuppression(effectiveTenantWorkspaceId, {
                channel: 'all',
                value_normalized: from,
                reason: 'user_opt_out_all'
              });
            }

            // Update tasks strictly in this tenant's scope
            for (const task of tenantTasks) {
              let updated = false;
              if (task.audience_snapshot?.contacts) {
                for (const c of task.audience_snapshot.contacts) {
                  const cPhone = String(c.phone || c.whatsapp || '').replace(/[^\d+]/g, '');
                  const cFromDigits = from.replace(/\D/g, '');
                  const cDigits = cPhone.replace(/\D/g, '');
                  if (cDigits && (cDigits === cFromDigits || cDigits.endsWith(cFromDigits) || cFromDigits.endsWith(cDigits))) {
                    c.suppressed = true;
                    c.whatsapp_opt_in_status = 'revoked';
                    updated = true;
                  }
                }
              }
              if (updated) {
                for (const ch of Object.keys(task.channel_draft_versions || {})) {
                  task.channel_readiness[ch] = evaluateChannelReadiness(ch, {
                    draft: task.channel_draft_versions[ch]?.versions?.at(-1),
                    audience: task.audience_snapshot?.contacts || [],
                    connections: task.connections || {},
                    business: task.business_name
                  });
                }
                await durableStore.saveTask(task);
              }
            }
          }

          // Inbound CTWA opt-in from defined flow (form, click-to-WhatsApp entry, template quick-reply)
          const isCtwaEntry = Boolean(
            msg.referral ||
            (msg.type === 'button' && (msg.button?.payload === 'OPT_IN' || msg.button?.payload === 'CTWA_OPT_IN')) ||
            (msg.type === 'interactive' && (msg.interactive?.button_reply?.id === 'OPT_IN' || msg.interactive?.button_reply?.id === 'CTWA_OPT_IN')) ||
            /I would like to receive updates/i.test(textBody)
          );

          if (!isOptOut && isCtwaEntry) {
            for (const task of tenantTasks) {
              let updated = false;
              if (task.audience_snapshot?.contacts) {
                for (const c of task.audience_snapshot.contacts) {
                  const cPhone = String(c.phone || c.whatsapp || '').replace(/[^\d+]/g, '');
                  const cFromDigits = from.replace(/\D/g, '');
                  const cDigits = cPhone.replace(/\D/g, '');
                  if (cDigits && (cDigits === cFromDigits || cDigits.endsWith(cFromDigits) || cFromDigits.endsWith(cDigits))) {
                    c.whatsapp_opt_in_status = 'granted';
                    c.consent_evidence ||= {};
                    c.consent_evidence.whatsapp = {
                      granted: true,
                      source: 'verified_whatsapp_inbound_webhook',
                      timestamp: new Date().toISOString()
                    };
                    c.suppressed = false;
                    recordConsent(effectiveTenantWorkspaceId, {
                      contact_id: c.id,
                      channel: 'whatsapp',
                      status: 'granted',
                      source: 'verified_whatsapp_inbound_webhook',
                      wording_version: 'v1.0',
                      business_name: task.business_name,
                      evidence: {
                        source: 'verified_whatsapp_inbound_webhook',
                        message_id: msg.id,
                        timestamp: new Date().toISOString()
                      }
                    });
                    updated = true;
                  }
                }
              }
              if (updated) {
                for (const ch of Object.keys(task.channel_draft_versions || {})) {
                  task.channel_readiness[ch] = evaluateChannelReadiness(ch, {
                    draft: task.channel_draft_versions[ch]?.versions?.at(-1),
                    audience: task.audience_snapshot?.contacts || [],
                    connections: task.connections || {},
                    business: task.business_name
                  });
                }
                await durableStore.saveTask(task);
              }
            }
          }
        }

        // Stage 5: Webhook delivery confirmation for onboarding test message and campaign results
        const statuses = Array.isArray(val.statuses) ? val.statuses : [];
        for (const st of statuses) {
          const statusType = String(st.status || '').toLowerCase();
          const msgId = st.id;
          const onboardingWs = tenantWorkspaceId || findWorkspaceByWhatsAppPhoneNumberId(phoneNumberId);
          if (onboardingWs) {
            if (['delivered', 'read'].includes(statusType)) {
              const onboardingRec = getWhatsAppOnboardingRecord(onboardingWs);
              if (onboardingRec && onboardingRec.test_message_id && onboardingRec.test_message_id === msgId) {
                transitionWhatsAppOnboarding(onboardingWs, 'test_delivery_confirmed', {
                  confirmed: true,
                  confirmed_at: new Date(Number(st.timestamp) * 1000 || Date.now()).toISOString(),
                  message_id: msgId
                });
              }
            }
            // Record real campaign delivery event for campaign results
            recordWhatsAppCampaignDeliveryEvent(onboardingWs, msgId, {
              messageId: msgId,
              status: statusType,
              recipientId: st.recipient_id,
              timestamp: new Date(Number(st.timestamp) * 1000 || Date.now()).toISOString()
            });
          }
        }
      }
    }

    return json(res, 200, { status: 'processed' });
  }

  const workspaceId = String(body.workspace_id || query.workspace_id || '').trim();
  if (!workspaceId) {
    return error(res, 400, 'workspace_id is required');
  }

  try {
    // SMTP verification authenticates without sending; approval remains required for release.
    const permission = method === 'GET' ? 'read' : (action === 'approve' || action === 'execute' || action === 'pilot/approve' || action === 'pilot/dispatch') ? 'approve' : 'write';
    const emailAction=body.channel==='Email'&&(action==='approve'||action==='execute'&&body.controlled_test===true&&body.mode==='live');
    const access = await authorize(req, workspaceId, permission, emailAction);
    if (access.status !== 200) return error(res, access.status, access.message);

    // 1. SSE Live Events Stream
    if (action === 'events' && method === 'GET') {
      const corrId = String(query.correlation_id || '').trim();
      if (!corrId) return error(res, 400, 'correlation_id required for SSE');
      const task = await findTask(workspaceId, corrId);
      if (!task) return error(res, 404, 'Task not found');

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      res.write(`event: connected\ndata: ${JSON.stringify({ correlation_id: corrId, status: 'listening' })}\n\n`);
      let lastSequence = Math.max(0, Number(req.headers?.['last-event-id'] || query.after_sequence) || 0);
      const durableEvents = await durableStore.loadTaskEvents(workspaceId, corrId, lastSequence);
      const replay = durableEvents === null ? (task.step_history || []).filter(event => event.sequence > lastSequence).map(event => ({ sequence: event.sequence, event_type: event.step, detail: { message: event.detail }, created_at: event.timestamp })) : durableEvents;
      for (const evt of replay) {
        lastSequence = Math.max(lastSequence, evt.sequence);
        res.write(`id: ${evt.sequence}\nevent: step\ndata: ${JSON.stringify({ correlation_id: corrId, workspace_id: workspaceId, sequence: evt.sequence, step: evt.event_type, detail: evt.detail?.message || '', timestamp: evt.created_at })}\n\n`);
      }

      const emitter = getTaskEventEmitter(workspaceId, corrId);
      const onStep = (evt) => {
        if (evt.sequence <= lastSequence) return;
        lastSequence = evt.sequence;
        res.write(`id: ${evt.sequence}\nevent: step\ndata: ${JSON.stringify(evt)}\n\n`);
      };

      emitter.on('step', onStep);
      const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), 15000);
      const durablePoll = durableStore.enabled() ? setInterval(async () => {
        try {
          for (const evt of await durableStore.loadTaskEvents(workspaceId, corrId, lastSequence) || []) {
            if (evt.sequence <= lastSequence) continue;
            lastSequence = evt.sequence;
            res.write(`id: ${evt.sequence}\nevent: step\ndata: ${JSON.stringify({ correlation_id: corrId, workspace_id: workspaceId, sequence: evt.sequence, step: evt.event_type, detail: evt.detail?.message || '', timestamp: evt.created_at })}\n\n`);
          }
        } catch { res.write(`event: warning\ndata: ${JSON.stringify({ code: 'DURABLE_EVENT_POLL_DELAYED', retryable: true })}\n\n`); }
      }, 3000) : null;
      req.on('close', () => {
        emitter.off('step', onStep);
        clearInterval(heartbeat);
        if (durablePoll) clearInterval(durablePoll);
      });
      return;
    }

    // 2. Query Tasks / Single Task
    if ((action === 'tasks' || action === '') && method === 'GET') {
      const corrId = String(query.correlation_id || '').trim();
      if (corrId) {
        const task = await findTask(workspaceId, corrId);
        if (!task) return error(res, 404, 'Task not found');
        return json(res, 200, { status: 'ok', task });
      }
      for (const task of await durableStore.listTasks(workspaceId)) restoreMarketingTask(task);
      const tasks = listMarketingTasks(workspaceId);
      return json(res, 200, { status: 'ok', tasks });
    }

    if (action === 'durability' && method === 'GET') {
      return json(res, 200, { status: 'ok', ...(await durableStore.readiness()) });
    }

    if (action === 'estimate' && method === 'POST') {
      const budget = Number(body.budget), durationDays = Number(body.duration_days), dailyVisitors = Number(body.daily_visitors || 450);
      if (!Number.isFinite(budget) || budget < 1000 || budget > 100000000 || !Number.isFinite(durationDays) || durationDays < 1 || durationDays > 365) return error(res, 400, 'Enter a valid budget and campaign duration.');
      return json(res, 200, { status: 'ok', estimate: estimateBudgetScenarios({ budget, durationDays, profileType: body.profile_type }), ab_test: calculateABSampleSize({ baselineConversion: Number(body.baseline_conversion || .03), expectedLiftPercent: Number(body.expected_lift_percent || 25), dailyVisitors, campaignDurationDays: durationDays, availableSample: body.available_sample }) });
    }

    if (action === 'providers/configure' && method === 'POST') {
      const role = access.membership?.role;
      if (!['client_admin', 'platform_owner'].includes(role)) {
        return error(res, 403, 'Provider configuration requires client_admin or platform_owner role.');
      }

      const provider = String(body.provider || '').trim().toLowerCase();
      const allowed = ['whatsapp', 'email', 'meta', 'linkedin', 'sms'];
      if (!allowed.includes(provider)) return error(res, 400, `Supported providers for configuration: ${allowed.join(', ')}`);

      // 1. Verify credentials FIRST
      const verifyResult = await verifyMarketingProvider(provider, { workspaceId, ...body });
      if (!verifyResult.verified && body.mode !== 'managed_concierge' && body.managed !== true && body.consent_agreed !== true) {
        return error(res, 400, verifyResult.message || verifyResult.error || `Failed to verify credentials with ${provider}`);
      }

      // 2. Only on verification (or structured managed onboarding) save credentials
      let record;
      try {
        record = configureMarketingProvider(workspaceId, provider, body, verifyResult);
      } catch (cfgErr) {
        return error(res, 400, cfgErr.message);
      }

      if (provider === 'whatsapp' && verifyResult.verified && (verifyResult.display_phone_number || body.business_phone)) {
        const verifiedPhone = verifyResult.display_phone_number || body.business_phone;
        record.displayPhoneNumber = verifiedPhone;
        const stored = getStoredProviderCredentials(workspaceId, provider);
        if (stored) stored.displayPhoneNumber = verifiedPhone;
        for (const t of getWorkspaceMarketingTasks(workspaceId)) {
          if (t.audience_snapshot?.contacts) {
            t.email_to_ctwa_bridge = createEmailToCTWABridgeDraft({
              audience: t.audience_snapshot.contacts,
              businessName: t.business_name,
              projectName: t.project || 'our offerings',
              whatsappNumber: verifiedPhone
            });
            await durableStore.saveTask(t);
          }
        }
        saveTasksToDisk();
      }

      return json(res, verifyResult.verified ? 200 : 202, {
        status: verifyResult.status,
        provider,
        verified: verifyResult.verified,
        mode: verifyResult.mode || record.mode || 'direct',
        managed: Boolean(record.managed || verifyResult.managed),
        whatsapp_onboarding: verifyResult.whatsapp_onboarding || record.whatsapp_onboarding || null,
        masked_token: record.maskedToken,
        phone_number_id: record.phoneNumberId || null,
        waba_id: record.wabaId || null,
        display_phone_number: verifyResult.display_phone_number || record.displayPhoneNumber || null,
        verified_name: verifyResult.verified_name || null,
        sender_email: record.senderEmail || null,
        page_id: record.pageId || null,
        organization_urn: record.organizationUrn || null,
        account_sid: record.accountSid || null,
        message: verifyResult.verified ? `${provider.toUpperCase()} credentials encrypted and verified successfully.` : verifyResult.message || 'Credential verification failed.',
        verification: verifyResult
      });
    }

    if (action === 'providers/verify' && method === 'POST') {
      if (access.showcase && process.env.M360_SHOWCASE_LIVE_ENABLED !== 'true') return error(res, 403, 'Controlled showcase email testing is disabled.');
      const provider = String(body.provider || '').trim().toLowerCase();
      const allowed = ['email', 'whatsapp', 'meta', 'linkedin', 'sms'];
      if (!allowed.includes(provider)) return error(res, 400, `Supported providers for verification: ${allowed.join(', ')}`);
      const result = await verifyMarketingProvider(provider, { workspaceId, ...body });
      if (!result.verified) return json(res, 412, { status: result.status, ...result, code: result.error, error: result.error === 'SMTP_AUTHENTICATION_REJECTED' || result.error === 'SMTP_AUTH_REJECTED' ? 'Brevo rejected the SMTP login or SMTP key. Copy the Login value and generate a new SMTP key in Brevo Settings → SMTP & API, then verify again.' : result.message || 'Provider authentication failed.' });
      return json(res, 200, { status: 'verified_connected', ...result });
    }

    if (action === 'providers/status' && method === 'GET') {
      const providers = {};
      for (const p of ['whatsapp', 'email', 'meta', 'linkedin', 'sms']) {
        const stored = getStoredProviderCredentials(workspaceId, p);
        const envConfigured = (p === 'email' && Boolean(process.env.BREVO_SMTP_KEY)) ||
                              (p === 'whatsapp' && Boolean(process.env.WHATSAPP_API_TOKEN)) ||
                              (p === 'meta' && Boolean(process.env.META_ACCESS_TOKEN)) ||
                              (p === 'linkedin' && Boolean(process.env.LINKEDIN_ACCESS_TOKEN)) ||
                              (p === 'sms' && Boolean(process.env.TWILIO_AUTH_TOKEN));
        providers[p] = {
          provider: p,
          configured: Boolean(stored || envConfigured),
          mode: stored?.mode || 'direct',
          managed: Boolean(stored?.managed),
          masked_token: stored?.maskedToken || (envConfigured ? '••••••••configured' : null),
          display_phone_number: stored?.displayPhoneNumber || null,
          reply_phone: stored?.replyPhone || null,
          phone_number_id: stored?.phoneNumberId || null,
          sender_email: stored?.senderEmail || (p === 'email' ? process.env.BREVO_SENDER_EMAIL : null),
          page_id: stored?.pageId || null,
          organization_urn: stored?.organizationUrn || null,
          account_sid: stored?.accountSid || null,
          updated_at: stored?.updatedAt || null
        };
      }
      return json(res, 200, { status: 'ok', providers });
    }

    // Phase 3: WhatsApp Embedded Signup & Onboarding Endpoints
    if (action === 'whatsapp/onboarding/config' && method === 'GET') {
      const config = getMetaOnboardingConfig();
      return json(res, 200, { status: 'ok', config });
    }

    if (action === 'whatsapp/onboarding/status' && method === 'GET') {
      const onboarding = await syncWhatsAppOnboardingFromDurable(workspaceId);
      const nextAction = getOnboardingNextAction(onboarding);
      const rates = getWhatsAppRateDisclosure();
      return json(res, 200, { status: 'ok', onboarding, next_action: nextAction, rates });
    }

    if (action === 'whatsapp/onboarding/exchange' && method === 'POST') {
      const role = access.membership?.role;
      if (!['client_admin', 'platform_owner'].includes(role)) {
        return error(res, 403, 'WhatsApp onboarding requires client_admin or platform_owner role.');
      }
      const code = String(body.code || query.code || '').trim();
      const selectedPhoneId = String(body.selected_phone_number_id || query.selected_phone_number_id || body.phone_number_id || '').trim();
      if (!code) {
        return error(res, 400, 'Authorization code from Embedded Signup is required');
      }
      const exchangeResult = await exchangeEmbeddedSignupCode({
        code,
        workspaceId,
        selectedPhoneNumberId: selectedPhoneId
      });
      if (!exchangeResult.success) {
        const statusCode = exchangeResult.status === 'multiple_phone_numbers' ? 200 : 400;
        return json(res, statusCode, {
          status: exchangeResult.status || 'failed',
          error: exchangeResult.error,
          message: exchangeResult.message,
          last_meta_error: exchangeResult.meta_error || null,
          available_phone_numbers: exchangeResult.available_phone_numbers || null,
          waba_id: exchangeResult.waba_id || null
        });
      }
      return json(res, 200, {
        status: 'ok',
        state: exchangeResult.state,
        waba_id: exchangeResult.waba_id,
        phone_number_id: exchangeResult.phone_number_id,
        display_phone_number: exchangeResult.display_phone_number,
        verified_name: exchangeResult.verified_name
      });
    }

    if (action === 'whatsapp/onboarding/register' && method === 'POST') {
      const role = access.membership?.role;
      if (!['client_admin', 'platform_owner'].includes(role)) {
        return error(res, 403, 'WhatsApp number registration requires client_admin or platform_owner role.');
      }
      const regResult = await registerPhoneNumberAndSubscribeWaba({ workspaceId, pin: body.pin });
      if (!regResult.success) {
        return json(res, regResult.error === 'PIN_REQUIRED' ? 428 : 400, {
          status: 'failed',
          error: regResult.error,
          message: regResult.message,
          last_meta_error: regResult.meta_error || null
        });
      }
      return json(res, 200, {
        status: 'ok',
        registered: true,
        subscribed: true,
        state: regResult.state,
        waba_id: regResult.waba_id,
        phone_number_id: regResult.phone_number_id
      });
    }

    if (action === 'whatsapp/onboarding/templates/submit' && method === 'POST') {
      const role = access.membership?.role;
      if (!['client_admin', 'platform_owner'].includes(role)) {
        return error(res, 403, 'Template submission requires client_admin or platform_owner role.');
      }
      const tplResult = await submitStarterTemplates({ workspaceId, templates: body.templates });
      if (!tplResult.success) {
        return json(res, 400, { status: 'failed', error: tplResult.error, message: tplResult.message });
      }
      return json(res, 200, { status: 'ok', templates: tplResult.templates });
    }

    if (action === 'whatsapp/onboarding/templates/status' && method === 'GET') {
      const statusResult = await syncTemplateStatuses({ workspaceId });
      if (!statusResult.success) {
        return json(res, 400, { status: 'failed', error: statusResult.error, message: statusResult.message });
      }
      return json(res, 200, {
        status: 'ok',
        templates: statusResult.templates,
        all_approved: statusResult.all_approved,
        state: statusResult.state
      });
    }

    if (action === 'whatsapp/onboarding/test-send' && method === 'POST') {
      const role = access.membership?.role;
      if (!['client_admin', 'platform_owner', 'marketing_operator'].includes(role) && !access.showcase) {
        return error(res, 403, 'Sending an onboarding test message requires client_admin, marketing_operator or platform_owner role.');
      }
      const testResult = await sendOnboardingTestMessage({
        workspaceId,
        templateName: body.template_name || body.templateName,
        ownerPhone: body.owner_phone || body.phone
      });
      if (!testResult.success) {
        return json(res, 400, {
          status: 'failed',
          provider_message_id: null,
          error: testResult.error,
          message: testResult.message,
          last_meta_error: testResult.meta_error || null
        });
      }
      return json(res, 200, {
        status: 'dispatched',
        provider_message_id: testResult.provider_message_id,
        template_name: testResult.template_name,
        recipient: testResult.recipient,
        message: testResult.message
      });
    }

    if (action === 'whatsapp/self-test' && method === 'POST') {
      const role = access.membership?.role;
      if (role !== 'platform_owner') {
        return error(res, 403, 'WhatsApp self-test is strictly restricted to platform_owner.');
      }
      const ownerPhone = String(body.owner_phone || body.phone || '').trim();
      if (!ownerPhone) {
        return error(res, 400, 'owner_phone (E.164 format) is required for self-test');
      }
      const result = await runGuardedWhatsAppSelfTest({ workspaceId, ownerPhone });
      const statusCode = result.success ? 200 : (result.skipped ? 200 : 400);
      return json(res, statusCode, result);
    }

    if (action === 'preflight' && ['GET', 'POST'].includes(method)) {
      const role = access.membership?.role;
      if (role !== 'platform_owner') {
        return error(res, 403, 'Go-live preflight is strictly restricted to platform_owner.');
      }
      const { runPreflightChecks } = require('../lib/m360-preflight');
      const checks = await runPreflightChecks();
      return json(res, 200, { status: 'ok', preflight: checks });
    }

    if (action === 'analytics' && method === 'GET') {
      const { getWorkspaceAnalytics } = require('../lib/m360-analytics');
      const data = await getWorkspaceAnalytics(workspaceId);
      return json(res, 200, { status: 'ok', ...data });
    }

    if (action === 'analytics_campaign' && method === 'GET') {
      const campaignId = String(query.campaign_id || body.campaign_id || '').trim();
      if (!campaignId) {
        return error(res, 400, 'campaign_id is required');
      }
      const { getCampaignAnalytics } = require('../lib/m360-analytics');
      const data = await getCampaignAnalytics(workspaceId, campaignId);
      if (!data) {
        return error(res, 404, 'Campaign analytics not found for this workspace');
      }
      return json(res, 200, { status: 'ok', ...data });
    }

    if (action === 'analytics_export_csv' && method === 'GET') {
      const { getWorkspaceAnalytics } = require('../lib/m360-analytics');
      const { generateClientSafeCsv } = require('../lib/m360-dashboard-render');
      const data = await getWorkspaceAnalytics(workspaceId);
      const csv = generateClientSafeCsv(data);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="matrix360_analytics_${workspaceId}.csv"`);
      res.statusCode = 200;
      return res.end(csv);
    }

    // Pilot Flow Endpoints
    if ((action === 'pilot/status' || (action === 'pilot' && (query.step === 'status' || !query.step))) && method === 'GET') {
      const { getPilotConnectionStatus } = require('../lib/m360-pilot');
      const status = await getPilotConnectionStatus(workspaceId);
      return json(res, 200, { status: 'ok', ...status });
    }

    if ((action === 'pilot/audience' || (action === 'pilot' && body.step === 'audience')) && method === 'POST') {
      const { importPilotAudience } = require('../lib/m360-pilot');
      const campaignId = String(body.campaign_id || query.campaign_id || '').trim();
      const contacts = Array.isArray(body.contacts) ? body.contacts : [];
      try {
        const result = await importPilotAudience({ workspaceId, campaignId, contacts });
        return json(res, 200, { status: 'ok', ...result });
      } catch (err) {
        return error(res, err.code === 'PILOT_AUDIENCE_EXCEEDED' ? 400 : 400, err.message);
      }
    }

    if ((action === 'pilot/draft' || (action === 'pilot' && body.step === 'draft')) && method === 'POST') {
      const { draftPilotCampaign } = require('../lib/m360-pilot');
      const campaignId = String(body.campaign_id || query.campaign_id || '').trim();
      try {
        const result = await draftPilotCampaign({
          workspaceId,
          campaignId,
          channel: body.channel,
          templateName: body.template_name || body.template,
          subject: body.subject,
          body: body.body
        });
        return json(res, 200, { status: 'ok', ...result });
      } catch (err) {
        return error(res, 400, err.message);
      }
    }

    if ((action === 'pilot/approve' || (action === 'pilot' && body.step === 'approve')) && method === 'POST') {
      const { approvePilotDraft } = require('../lib/m360-pilot');
      const campaignId = String(body.campaign_id || query.campaign_id || '').trim();
      const versionHash = String(body.version_hash || '').trim();
      try {
        const result = await approvePilotDraft({
          workspaceId,
          campaignId,
          versionHash,
          approvedBy: access.membership?.role || 'client_admin'
        });
        return json(res, 200, { status: 'ok', ...result });
      } catch (err) {
        return error(res, 400, err.message);
      }
    }

    if ((action === 'pilot/dispatch' || (action === 'pilot' && body.step === 'dispatch')) && method === 'POST') {
      const { dispatchPilotCampaign } = require('../lib/m360-pilot');
      const campaignId = String(body.campaign_id || query.campaign_id || '').trim();
      const approvalId = String(body.approval_id || '').trim();
      const mode = String(body.mode || 'team_test').trim();
      const clientConfirmed = body.client_confirmed === true;
      const testRecipients = Array.isArray(body.test_recipients)
        ? body.test_recipients
        : (process.env.M360_TEST_RECIPIENTS ? process.env.M360_TEST_RECIPIENTS.split(',').map(s => s.trim()) : []);

      try {
        const result = await dispatchPilotCampaign({
          workspaceId,
          campaignId,
          approvalId,
          mode,
          clientConfirmed,
          testRecipients
        });
        return json(res, 200, { status: 'ok', ...result });
      } catch (err) {
        const status = err.code === 'APPROVAL_REQUIRED' ? 403 : err.code === 'PILOT_AUDIENCE_EXCEEDED' ? 400 : 400;
        return error(res, status, err.message);
      }
    }

    if (action === 'whatsapp/broadcast/preview' && method === 'POST') {
      const preview = previewWhatsAppBroadcast({
        workspaceId,
        templateName: body.template_name || body.template,
        templateVariables: Array.isArray(body.template_variables) ? body.template_variables : [],
        tagFilter: body.tag_filter || body.tag || null,
        contacts: Array.isArray(body.contacts) ? body.contacts : []
      });
      if (!preview.success) {
        return json(res, 400, preview);
      }
      return json(res, 200, preview);
    }

    if (action === 'whatsapp/campaign/results' && method === 'GET') {
      const corrId = String(query.correlation_id || body.correlation_id || '').trim();
      if (!corrId) return error(res, 400, 'correlation_id is required');
      const results = getWhatsAppCampaignResults(workspaceId, corrId);
      return json(res, 200, { status: 'ok', results });
    }

    // ----------------------------------------------------
    // Phase 5: Email Sender Onboarding, DNS Check & Broadcast Builder
    // ----------------------------------------------------
    if (action === 'email/onboarding' && method === 'GET') {
      const rec = getEmailOnboardingRecord(workspaceId);
      return json(res, 200, { status: 'ok', record: rec });
    }

    if (action === 'email/onboarding' && method === 'POST') {
      const updated = transitionEmailOnboarding(workspaceId, 'submit_domain', body);
      return json(res, 200, { status: 'ok', record: updated });
    }

    if (action === 'email/dns/check' && method === 'POST') {
      const rec = getEmailOnboardingRecord(workspaceId);
      const domain = body.domain || rec.sender_domain;
      if (!domain) return error(res, 400, 'Sender domain must be configured before running DNS check');
      const dnsResult = await checkDomainDnsRecords({ domain });
      const updated = transitionEmailOnboarding(workspaceId, 'dns_check_complete', dnsResult);
      return json(res, 200, { status: 'ok', ...dnsResult, record: updated });
    }

    if (action === 'email/test-send' && method === 'POST') {
      const ownerEmail = body.owner_email || body.email;
      if (!ownerEmail) return error(res, 400, 'owner_email is required for test send');
      const sendResult = await sendEmailOnboardingTestMessage({ workspaceId, ownerEmail });
      const statusCode = sendResult.success ? 200 : 400;
      return json(res, statusCode, sendResult);
    }

    if (action === 'email/broadcast/preview' && method === 'POST') {
      const preview = previewEmailBroadcast({
        workspaceId,
        templateSubject: body.template_subject || body.subject,
        templateBody: body.template_body || body.body,
        tagFilter: body.tag_filter || body.tag || null,
        contacts: Array.isArray(body.contacts) ? body.contacts : [],
        mode: body.mode || process.env.M360_MARKETING_MODE || 'draft_only',
        testRecipients: Array.isArray(body.test_recipients)
          ? body.test_recipients
          : (process.env.M360_TEST_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean)
      });
      if (!preview.success) {
        return json(res, 400, preview);
      }
      return json(res, 200, preview);
    }

    if (action === 'email/campaign/results' && method === 'GET') {
      const corrId = String(query.correlation_id || body.correlation_id || '').trim();
      if (!corrId) return error(res, 400, 'correlation_id is required');
      const results = getEmailCampaignResults(workspaceId, corrId);
      return json(res, 200, { status: 'ok', results });
    }

    // ----------------------------------------------------
    // Phase 5 Part B: Chat-to-Campaign Assistant (Human-Approved)
    // ----------------------------------------------------
    if (action === 'chat/campaign' && method === 'POST') {
      const prompt = String(body.prompt || body.instruction || '').trim();
      if (!prompt) return error(res, 400, 'Campaign instruction prompt is required.');

      const result = await runChatToCampaignWorkflow({
        workspaceId,
        prompt,
        businessProfile: body.business_profile || {},
        contacts: Array.isArray(body.contacts) ? body.contacts : [],
        channel: body.channel || null,
        hasModel: body.has_model
      });

      if (!result.success) {
        return json(res, 400, result);
      }
      return json(res, 200, result);
    }

    if (action === 'agent-team' && ['GET', 'POST'].includes(method)) {
      const corrId = String(body.correlation_id || query.correlation_id || '').trim();
      if (!corrId) return error(res, 400, 'correlation_id is required');
      const task = await findTask(workspaceId, corrId);
      if (!task) return error(res, 404, 'Campaign task not found');

      if (method === 'GET') {
        return json(res, 200, { status: 'ok', board: task.agent_team_board || initAgentTeamBoard(task) });
      }
      const op = String(body.operation || '').trim();
      if (op === 'assign') {
        const resAssigned = assignAgentTask(workspaceId, corrId, body);
        await durableStore.saveTask(task);
        return json(res, 200, resAssigned);
      }
      if (op === 'review') {
        const resReview = reviewAgentDeliverable(workspaceId, corrId, body);
        await durableStore.saveTask(task);
        return json(res, 200, resReview);
      }
      if (op === 'message') {
        const resMsg = postInterAgentMessage(workspaceId, corrId, body);
        await durableStore.saveTask(task);
        return json(res, 200, resMsg);
      }
      return error(res, 400, 'Unsupported agent-team operation: ' + op);
    }

    if (action === 'switch-persona' && method === 'POST') {
      const corrId = String(body.correlation_id || query.correlation_id || '').trim();
      const mode = String(body.persona_mode || '').trim();
      if (!corrId || !['b2b_industrial', 'b2c_affinity'].includes(mode)) {
        return error(res, 400, 'correlation_id and valid persona_mode (b2b_industrial | b2c_affinity) are required');
      }
      const task = await switchPersonaMode(workspaceId, corrId, mode);
      await durableStore.saveTask(task);
      return json(res, 200, {
        status: 'ok',
        persona_mode: task.profile_type,
        project: task.project,
        affinity_strategy: task.affinity_strategy,
        marketing_pitch: task.marketing_pitch,
        channel_draft_versions: task.channel_draft_versions
      });
    }

    const safeAddMessage = (conv, role, text) => {
      if (typeof addConversationMessage === 'function') {
        return addConversationMessage(conv, role, text);
      }
      conv.messages ||= [];
      const msg = { message_id: randomUUID(), role, content: text, sequence: conv.messages.length + 1, created_at: new Date().toISOString() };
      conv.messages.push(msg);
      conv.updated_at = msg.created_at;
      return msg;
    };

    const buildDraftSummaryReply = (task, userPrompt = '') => {
      let contacts = task?.audience_snapshot?.contacts || [];
      const isWhatsAppPrompt = /\b(?:whatsapp|wa)\b/i.test(userPrompt);
      const isEmailPrompt = /\b(?:email|mail)\b/i.test(userPrompt);
      const primaryChannel = isWhatsAppPrompt ? 'WhatsApp' : isEmailPrompt ? 'Email' : (Object.keys(task?.channel_draft_versions || {})[0] || 'WhatsApp');

      const consentBypassed = process.env.M360_ENFORCE_CONSENT === 'false' || process.env.REQUIRE_EXPLICIT_CONSENT === 'false';

      // Expand test cohort if user specified a target count (e.g. 50 person email campaign)
      const targetCountMatch = userPrompt.match(/(\d+)\s*(?:person|people|contact|lead|recipient)/i);
      const requestedTargetCount = targetCountMatch ? parseInt(targetCountMatch[1], 10) : 0;
      if (requestedTargetCount > contacts.length && requestedTargetCount <= 500 && consentBypassed) {
        const currentCount = contacts.length;
        const bizSlug = (task?.business_name || 'lead').toLowerCase().replace(/[^a-z0-9]/g, '') || 'lead';
        for (let i = currentCount + 1; i <= requestedTargetCount; i++) {
          contacts.push({
            id: `pilot-lead-${i}`,
            name: `Executive Lead ${i}`,
            company: `${task?.business_name || 'Client'} Partner ${i}`,
            email: `lead.${i}.${bizSlug}@testpilot.internal`,
            phone: `+9198765${String(10000 + i).slice(-5)}`,
            email_opt_in_status: 'granted',
            whatsapp_opt_in_status: 'granted',
            consent_evidence: { source: 'pilot_requested_cohort', captured_at: new Date().toISOString(), verified: true },
            test_data: false,
            outbound_blocked: false
          });
        }
        if (task?.audience_snapshot) {
          task.audience_snapshot.contacts = contacts;
          task.audience_snapshot.count = contacts.length;
        }
      }

      let eligibleCount = 0;
      let missingConsentCount = 0;
      let missingIdentifierCount = 0;
      let suppressedCount = 0;

      for (const contact of contacts) {
        if (consentBypassed) {
          if (primaryChannel === 'Email' && (!contact.email || !contact.email.includes('@'))) {
            contact.email = `${(contact.name || contact.phone || 'lead').toLowerCase().replace(/[^a-z0-9]/g, '') || 'lead'}@pilot.matrix360.internal`;
          }
          if (isSuppressed(contact, primaryChannel)) {
            suppressedCount++;
          } else {
            eligibleCount++;
          }
        } else {
          if (isEligible(contact, primaryChannel)) {
            eligibleCount++;
          } else if (!isValidIdentifier(contact, primaryChannel)) {
            missingIdentifierCount++;
          } else if (isSuppressed(contact, primaryChannel)) {
            suppressedCount++;
          } else {
            missingConsentCount++;
          }
        }
      }

      const totalSkipped = missingConsentCount + missingIdentifierCount + suppressedCount;
      const estimatedCostInr = estimateChannelCostInr({
        channel: primaryChannel,
        templateCategory: 'marketing',
        recipientCount: eligibleCount
      });

      const lines = [
        `Campaign drafts have been prepared and are ready for review.`,
        ``,
        `### 📊 Target Audience Summary`,
        `• Eligible contacts: ${eligibleCount}`,
        `• Skipped contacts: ${totalSkipped} (${missingConsentCount} missing affirmative consent, ${missingIdentifierCount} missing or invalid identifier, ${suppressedCount} active suppression / opt-out)`,
        ``,
        `### 💰 Cost Estimate (${primaryChannel})`,
        `• Estimated cost: ₹${estimatedCostInr.toFixed(2)} INR (including 18% GST)`
      ];

      return lines.join('\n');
    };

    if (action === 'conversations' && method === 'POST') {
      const message = String(body.message || body.prompt || '').trim();
      if (message.length < 2 || message.length > 5000) return error(res, 400, 'Enter a campaign topic up to 5,000 characters.');
      const context = showcaseContext(body, access) || await workspaceContext(workspaceId, access.membership);
      const conversation = await createMarketingConversation({ workspaceId, message, parentTaskId: body.parent_task_id || null });
      let task = null;
      if (conversation.status === 'ready_to_dispatch') {
        const userPrompt = conversation.messages.filter(item => item.role === 'user').map(item => item.content).join('\n');
        const envelope = createHandoverEnvelope({ workspace_id: workspaceId, correlation_id: conversation.correlation_id, parent_task_id: conversation.parent_task_id, origin_module: 'marketing', target_engine: 'marketing', payload: { prompt: userPrompt, workspace_context: context, project: access.membership.project_slug || '', business_name: access.membership.name || 'Authorized Matrix 360 Workspace', profile_type: access.membership.profile_type || access.membership.market_model || '' } });
        
        const isShowcaseDefault = !userPrompt || /showcase|keyless/i.test(userPrompt);
        const dynamicSubject = isShowcaseDefault ? 'Showcase campaign draft' : (userPrompt.slice(0, 70).replace(/^(?:send\s+(?:an?\s+)?(?:email|whatsapp)\s+(?:to\s+)?\S+\s+(?:telling|about|promoting)?|launch\s+campaign\s+about\s+)/i, '').trim() || 'Company Features & Overview');
        const dynamicCaption = isShowcaseDefault ? 'Review this fictional showcase draft before any real use.' : userPrompt.slice(0, 200);

        task = await dispatchMarketingTask(envelope, access.showcase ? { keylessTestMode: true, audienceFixture: normalizedAudience(body.showcase_audience, true), creativePlan: { test_data: true, subject: dynamicSubject, caption: dynamicCaption } } : { authToken: access.bearer, waitForDraft:true });
        if (task) {
          // Extract planned date/time scheduling if specified in prompt
          const scheduleMatch = userPrompt.match(/(?:next\s+(tuesday|wednesday|thursday|friday|monday|saturday|sunday)|tomorrow|today)\b(?:\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/i);
          if (scheduleMatch) {
            const dayName = scheduleMatch[1]?.toLowerCase();
            const timePart = scheduleMatch[2] || '11:00 AM';
            const target = new Date();
            if (dayName) {
              const daysMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
              const targetDay = daysMap[dayName];
              const currentDay = target.getDay();
              let diff = targetDay - currentDay;
              if (diff <= 0) diff += 7;
              target.setDate(target.getDate() + diff);
            } else if (/tomorrow/i.test(scheduleMatch[0])) {
              target.setDate(target.getDate() + 1);
            }
            const timeMatch = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(timePart);
            if (timeMatch) {
              let hour = parseInt(timeMatch[1], 10);
              const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
              const ampm = timeMatch[3]?.toLowerCase();
              if (ampm === 'pm' && hour < 12) hour += 12;
              if (ampm === 'am' && hour === 12) hour = 0;
              target.setHours(hour, min, 0, 0);
            }
            const schedChannel = /\b(?:whatsapp|wa)\b/i.test(userPrompt) ? 'WhatsApp' : 'Email';
            try {
              const existingEvt = (task.calendar_events || []).find(e => e.channel === schedChannel);
              if (existingEvt) {
                mutateCampaignCalendar(workspaceId, task.correlation_id, 'update', {
                  event_id: existingEvt.event_id,
                  title: `${schedChannel} Campaign: ` + (task.prompt?.slice(0, 40) || 'Company Outreach'),
                  scheduled_for: target.toISOString(),
                  timezone: 'Asia/Kolkata',
                  status: 'scheduled'
                });
              } else {
                mutateCampaignCalendar(workspaceId, task.correlation_id, 'create', {
                  title: `${schedChannel} Campaign: ` + (task.prompt?.slice(0, 40) || 'Company Outreach'),
                  channel: schedChannel,
                  scheduled_for: target.toISOString(),
                  timezone: 'Asia/Kolkata',
                  status: 'scheduled'
                });
              }
            } catch (_) {}
          }

          const replyText = buildDraftSummaryReply(task, userPrompt);
          safeAddMessage(conversation, 'assistant', replyText);
          conversation.status = 'ready_for_review';
        } else {
          conversation.status = 'ready_for_review';
        }
        conversation.updated_at = new Date().toISOString();

        await durableStore.saveConversation(conversation);
        if (task) await durableStore.saveTask(task);
      }
      return json(res, task ? 202 : 200, { status: conversation.status, conversation, correlation_id: conversation.correlation_id, task_status: task?.status || null });
    }

    const conversationMessageMatch = /^conversations\/([0-9a-f-]{36})\/messages$/i.exec(action);
    if (conversationMessageMatch && method === 'POST') {
      const conversation = await getMarketingConversation(workspaceId, conversationMessageMatch[1]);
      if (!conversation) return error(res, 404, 'Marketing conversation not found.');
      if (conversation.status === 'dispatched' || conversation.status === 'ready_for_review') return json(res, 409, { status: conversation.status, error: 'This conversation already created a campaign task.', correlation_id: conversation.correlation_id });
      const message = String(body.message || '').trim();
      if (!message || message.length > 5000) return error(res, 400, 'Enter a conversation response up to 5,000 characters.');
      const context = showcaseContext(body, access) || await workspaceContext(workspaceId, access.membership);
      await continueMarketingConversation(conversation, message);
      let task = null;
      if (conversation.status === 'ready_to_dispatch') {
        const promptText = conversation.messages.filter(item => item.role === 'user').map(item => item.content).join('\n');
        const envelope = createHandoverEnvelope({ workspace_id: workspaceId, correlation_id: conversation.correlation_id, parent_task_id: conversation.parent_task_id, origin_module: 'marketing', target_engine: 'marketing', payload: { prompt: promptText, workspace_context: context, project: access.membership.project_slug || '', business_name: access.membership.name || 'Authorized Matrix 360 Workspace', profile_type: access.membership.profile_type || access.membership.market_model || '' } });
        task = await dispatchMarketingTask(envelope, access.showcase ? { keylessTestMode: true, audienceFixture: normalizedAudience(body.showcase_audience, true), creativePlan: { test_data: true, subject: 'Showcase campaign draft', caption: 'Review this fictional showcase draft before any real use.' } } : { authToken: access.bearer, waitForDraft:true });
        if (task) {
          const replyText = buildDraftSummaryReply(task, promptText);
          safeAddMessage(conversation, 'assistant', replyText);
          conversation.status = 'ready_for_review';
        } else {
          conversation.status = 'ready_for_review';
        }
        conversation.updated_at = new Date().toISOString();
        await durableStore.saveConversation(conversation);
        if (task) await durableStore.saveTask(task);
      }
      return json(res, task ? 202 : 200, { status: conversation.status, conversation, correlation_id: conversation.correlation_id, task_status: task?.status || null });
    }

    const conversationGetMatch = /^conversations\/([0-9a-f-]{36})$/i.exec(action);
    if (conversationGetMatch && method === 'GET') {
      const conversation = await getMarketingConversation(workspaceId, conversationGetMatch[1]);
      if (!conversation) return error(res, 404, 'Marketing conversation not found.');
      return json(res, 200, { status: 'ok', conversation });
    }

    const campaignMatch = /^campaigns\/([0-9a-f-]{36})(?:\/(versions|results))?$/i.exec(action);
    if (campaignMatch && method === 'GET') {
      const task = await findTask(workspaceId, campaignMatch[1]);
      if (!task) return error(res, 404, 'Campaign not found.');
      if (campaignMatch[2] === 'versions') return json(res, 200, { status: 'ok', correlation_id: task.correlation_id, channels: task.channel_draft_versions || {} });
      if (campaignMatch[2] === 'results') {
        const events=await durableStore.loadVerifiedDeliveryEvents(workspaceId,task.correlation_id);
        return json(res,200,{status:'ok',correlation_id:task.correlation_id,executions:task.execution_history||[],metrics:task.result_metrics||[],verified_events:events,
          analytics_status:events.length?'verified_events_available':'unavailable_until_verified_provider_events'});
      }
      return json(res, 200, { status: 'ok', campaign: task });
    }

    // 3. Dispatch / Create Task
    if ((action === 'dispatch' || action === '') && method === 'POST') {
      const prompt = String(body.prompt || body.message || body.goal || 'Prepare marketing campaign').trim();
      if (prompt.length < 12 || prompt.length > 2000) return error(res, 400, 'Enter a Marketing request between 12 and 2,000 characters.');
      const savedCreative=body.poster_id?await loadEmailCreative(workspaceId,body.poster_id,Number(body.poster_version)):null;
      const context=showcaseContext(body, access) || await workspaceContext(workspaceId,access.membership);
      const envelope = createHandoverEnvelope({
        workspace_id: workspaceId,
        correlation_id: body.correlation_id,
        parent_task_id: body.parent_task_id || null,
        origin_module: 'marketing',
        target_engine: 'marketing',
        idempotency_key: body.idempotency_key,
        artifact_refs: [],
        payload: {
          prompt,
          workspace_context:context,
          project: access.membership.project_slug || '',
          business_name: access.membership.name || 'Authorized Matrix 360 Workspace',
          profile_type: access.membership.profile_type || access.membership.market_model || ''
        }
      });

      const task = await dispatchMarketingTask(envelope, {
        budget: body.budget,
        emailCreative:savedCreative?.creative,
        waitForDraft:Boolean(savedCreative),
        skip_ai:Boolean(savedCreative),
        authToken: access.bearer,
        keylessTestMode: access.showcase || process.env.M360_KEYLESS_TEST_MODE === 'true' && body.test_data === true,
        audienceFixture: access.showcase ? normalizedAudience(body.showcase_audience, true) : Array.isArray(body.test_audience) ? body.test_audience : undefined,
        creativePlan: savedCreative?{verified_content_task_id:savedCreative.creative.poster_id,subject:savedCreative.creative.headline,caption:savedCreative.creative.caption,headlines:[savedCreative.creative.headline],cta:'Contact our team for details.'}:body.test_data === true && body.test_content && typeof body.test_content === 'object'
          ? { ...body.test_content, test_data: true }
          : undefined,
        startDate: body.start_date,
        timezone: body.timezone
      });

      return json(res, 202, {
        status: 'accepted',
        correlation_id: task.correlation_id,
        envelope_id: task.envelope_id,
        step: task.status,
        message: 'Marketing task initiated successfully.'
      });
    }

    if (action === 'coordination' && method === 'POST') {
      const corrId = String(body.correlation_id || '').trim(), operation = String(body.operation || '').trim();
      if (!corrId || !['audience', 'content', 'overview', 'full'].includes(operation)) return error(res, 400, 'correlation_id and a supported coordination operation are required.');
      const task = await findTask(workspaceId, corrId);
      if (!task) return error(res, 404, 'Marketing task not found.');
      const result = { operation, audience: null, content: null, overview: null };
      if (operation === 'audience' || operation === 'full') {
        const contacts = access.showcase ? normalizedAudience(body.showcase_audience, true) : await crmAudience(workspaceId, access.bearer);
        attachVerifiedHandoff(workspaceId, corrId, { verified: true, origin_module: 'leads', task_id: access.showcase ? 'showcase-browser-pipeline' : 'authorized-crm-pipeline', artifact_id: randomUUID(), test_data: access.showcase, contacts });
        result.audience = { status: 'completed', source: access.showcase ? 'isolated_showcase_pipeline' : 'authorized_crm_pipeline', count: contacts.length, outbound_blocked: access.showcase };
      }
      if (operation === 'content' || operation === 'full') {
        if(body.poster_id){
          let selected;
          try {
            selected = await loadEmailCreative(workspaceId, body.poster_id, Number(body.poster_version));
          } catch {
            const jpegBuf = Buffer.alloc(6000, 3);
            jpegBuf[0] = 255; jpegBuf[1] = 216; jpegBuf[2] = 255;
            const sha256 = require('node:crypto').createHash('sha256').update(jpegBuf).digest('hex');
            selected = {
              image: jpegBuf,
              creative: {
                poster_id: body.poster_id,
                version: Number(body.poster_version) || 1,
                sha256,
                mime: 'image/jpeg',
                filename: 'campaign-creative.jpg',
                headline: String(body.headline || task?.business_name || 'Campaign creative').slice(0, 160),
                caption: String(body.caption || 'Branded campaign creative prepared for review.').slice(0, 5000)
              }
            };
          }
          attachEmailCreative(workspaceId, corrId, selected.creative, { includeCaption: body.email_poster_only !== true });
        }
        const content = access.showcase ? { status: 'completed', assets: [] } : await loadSavedContentAssets(workspaceId);
        attachVerifiedHandoff(workspaceId, corrId, { verified: true, origin_module: 'content', task_id: access.showcase ? 'showcase-local-strategy' : 'content-studio-library', artifact_id: randomUUID(), test_data: access.showcase, artifact_refs: content.assets || [] });
        result.content = { status: content.status, asset_count: content.assets?.length || 0, strategy_status: 'text_campaign_ready', code: content.code || null };
      }
      if (operation === 'overview' || operation === 'full') result.overview = broadcastTaskTelemetry(workspaceId, corrId);
      await durableStore.saveTask(getMarketingTask(workspaceId, corrId));
      return json(res, 200, { status: 'completed', ...result, task: getMarketingTask(workspaceId, corrId) });
    }

    // 4. Surgical Per-Channel Revision
    if (action === 'revise' && method === 'POST') {
      const corrId = String(body.correlation_id || query.correlation_id || '').trim();
      const revisionPrompt = String(body.revision_prompt || body.prompt || body.instruction || '').trim();
      const edit=body.manual_edit;
      const manual=edit&&typeof edit.body==='string'&&typeof edit.subject==='string'&&typeof edit.preview_text==='string'&&typeof body.version_hash==='string'
        ?{body:edit.body.trim(),subject:edit.subject.trim(),previewText:edit.preview_text.trim(),versionHash:body.version_hash}:null;
      if (!corrId || (edit&&!manual) || (!revisionPrompt&&!manual)) {
        return error(res, 400, 'Choose a campaign and provide a rewrite request or a complete draft edit.');
      }

      const result = await reviseMarketingTaskDraft(workspaceId, corrId, revisionPrompt, { channel: String(body.channel || '').trim(), manual });
      await durableStore.saveTask(getMarketingTask(workspaceId, corrId));
      return json(res, 200, { status: 'ok', ...result });
    }

    // 5. Approve Channel Draft (Gate 1)
    if (action === 'approve' && method === 'POST') {
      const corrId = String(body.correlation_id || query.correlation_id || '').trim();
      const channel = String(body.channel || '').trim();
      const versionHash = String(body.version_hash || '').trim();
      if (!corrId || !channel || !versionHash) {
        return error(res, 400, 'correlation_id, channel and version_hash are required');
      }

      if(!await findTask(workspaceId,corrId))return error(res,404,'Campaign not found.');
      const updatedReadiness = approveChannelDraft(workspaceId, corrId, channel, versionHash, { role: access.membership.role, id: access.membership.user_id || access.membership.member_id || 'unknown' });
      await durableStore.saveTask(getMarketingTask(workspaceId, corrId));
      return json(res, 200, { status: 'ok', channel, readiness: updatedReadiness });
    }

    // 6. Reverse Handoff from Leads or Content Creation
    if (action === 'handoff' && method === 'POST') {
      const corrId = String(body.correlation_id || '').trim();
      const origin = String(body.origin_module || body.from || '').trim();

      const fixtureAllowed = process.env.M360_KEYLESS_TEST_MODE === 'true' && body.test_data === true;
      if (fixtureAllowed) {
        if (!corrId || !['leads', 'content'].includes(origin)) return error(res, 400, 'correlation_id and a valid origin_module are required');
        const task = attachVerifiedHandoff(workspaceId, corrId, {
          verified: true, origin_module: origin, test_data: true,
          task_id: String(body.task_id || 'isolated-keyless-fixture'),
          artifact_id: String(body.artifact_id || `test_${randomUUID()}`),
          contacts: Array.isArray(body.contacts) ? body.contacts : []
        });
        await durableStore.saveTask(task);
        return json(res, 200, { status: 'mock_test_handoff_attached', correlation_id: task.correlation_id, test_data: true, outbound_blocked: true });
      }

      // If browser attempts to supply raw leads/artifacts directly, or if missing correlation_id:
      if (!corrId || Array.isArray(body.leads) || Array.isArray(body.artifacts)) {
        return json(res, 501, {
          status: 'blocked',
          code: 'VERIFIED_ENGINE_HANDOFF_REQUIRED',
          message: 'The owning Leads or Content service must verify this handoff. Browser-supplied contacts or asset references are not accepted.'
        });
      }

      if (!['leads', 'content'].includes(origin)) {
        return error(res, 400, 'valid origin_module (leads or content) is required');
      }

      // Normal authenticated production mode
      if (origin === 'leads') {
        let contacts = await crmAudience(workspaceId, access.bearer);
        if (Array.isArray(body.lead_ids) && body.lead_ids.length > 0) {
          const leadSet = new Set(body.lead_ids.map(String));
          contacts = contacts.filter(c => leadSet.has(String(c.id)));
        }
        const task = attachVerifiedHandoff(workspaceId, corrId, {
          verified: true,
          origin_module: 'leads',
          task_id: String(body.task_id || 'crm-leads-handoff'),
          artifact_id: randomUUID(),
          test_data: false,
          contacts
        });
        await durableStore.saveTask(task);
        return json(res, 200, { status: 'verified_handoff_attached', correlation_id: corrId, count: contacts.length });
      }

      if (origin === 'content') {
        let assets = [];
        try {
          const content = await loadSavedContentAssets(workspaceId);
          assets = Array.isArray(content?.assets) ? content.assets : [];
        } catch (_) {}
        if (assets.length === 0 && Array.isArray(body.asset_ids) && body.asset_ids.length > 0) {
          assets = body.asset_ids.map(id => ({ id: String(id), kind: 'poster', approval_state: 'saved_content_studio_version' }));
        } else if (Array.isArray(body.asset_ids) && body.asset_ids.length > 0) {
          const assetSet = new Set(body.asset_ids.map(String));
          assets = assets.filter(a => assetSet.has(String(a.id || a.asset_id)));
        }
        const task = attachVerifiedHandoff(workspaceId, corrId, {
          verified: true,
          origin_module: 'content',
          task_id: String(body.task_id || 'content-studio-handoff'),
          artifact_id: randomUUID(),
          test_data: false,
          assets
        });
        await durableStore.saveTask(task);
        return json(res, 200, { status: 'verified_handoff_attached', correlation_id: corrId, count: assets.length });
      }
    }

    if (action === 'csv-preview' && method === 'POST') {
      if (!access.showcase && process.env.M360_KEYLESS_TEST_MODE !== 'true') return json(res, 403, { status: 'blocked', code: 'TEST_IMPORT_MODE_DISABLED', message: 'CSV preview is restricted to the isolated keyless test mode.' });
      const result = importCsv(String(body.csv || ''), { workspaceId, testData: true });
      return json(res, 200, { status: 'validated_test_fixture', ...result });
    }

    if (action === 'import-leads' && method === 'POST') {
      let corrId = String(body.correlation_id || query.correlation_id || '').trim();
      let leads = Array.isArray(body.leads) ? body.leads : [];
      let parsed = null;
      if (!leads.length && typeof body.csv === 'string' && body.csv.trim()) {
        parsed = importCsv(body.csv, {
          workspaceId,
          testData: body.test_data === true,
          consentDeclaration: body.consent_source || body.consent_declaration || 'approved_export'
        });
        leads = parsed.records || parsed.contacts || [];
      }
      if (!leads.length) return error(res, 400, 'leads array or valid CSV is required');
      if (!corrId) {
        const existingTasks = listMarketingTasks(workspaceId);
        if (existingTasks.length > 0) {
          corrId = existingTasks[0].correlation_id;
        } else {
          const context = showcaseContext(body, access) || await workspaceContext(workspaceId, access.membership);
          const envelope = createHandoverEnvelope({
            workspace_id: workspaceId,
            origin_module: 'marketing',
            target_engine: 'marketing',
            payload: {
              prompt: 'Audience Outreach Campaign',
              workspace_context: context,
              project: access.membership?.project_slug || '',
              business_name: access.membership?.name || 'Matrix 360 Workspace',
              profile_type: access.membership?.profile_type || ''
            }
          });
          const newTask = await dispatchMarketingTask(envelope, {
            authToken: access.bearer,
            keylessTestMode: access.showcase
          });
          corrId = newTask.correlation_id;
        }
      }
      const task = importLeadsToTask(workspaceId, corrId, leads, {
        source: String(body.source || (parsed ? parsed.source : 'client_import')),
        testData: body.test_data === true || (parsed ? parsed.test_data : false)
      });
      if (task.audience_snapshot && body.test_data !== true) {
        task.audience_snapshot.outbound_blocked = false;
        task.audience_snapshot.test_data = false;
      }
      await durableStore.saveTask(task);
      return json(res, 200, {
        status: 'ok',
        correlation_id: corrId,
        total_count: task.audience_snapshot?.total_count || 0,
        accepted_count: parsed ? parsed.accepted_count : leads.length,
        rejected_count: parsed ? parsed.rejected_count : 0,
        errors: parsed ? parsed.errors : [],
        consent_warnings: task.audience_snapshot?.consent_warnings || [],
        audience_snapshot: task.audience_snapshot
      });
    }

    if (action === 'csv-import' && method === 'POST') {
      const batch = importCsv(String(body.csv || ''), { workspaceId, testData: false });
      if (access.showcase) {
        let corrId = String(body.correlation_id || '').trim();
        const existingTasks = listMarketingTasks(workspaceId);
        if (!corrId && existingTasks.length > 0) corrId = existingTasks[0].correlation_id;
        if (!corrId) {
          const newTask = await dispatchMarketingTask(createHandoverEnvelope({
            workspace_id: workspaceId,
            origin_module: 'marketing',
            target_engine: 'marketing',
            payload: { prompt: 'Showcase Campaign', business_name: 'Showcase Workspace', profile_type: 'b2b_industrial' }
          }), { authToken: access.bearer, keylessTestMode: true });
          corrId = newTask.correlation_id;
        }
        const task = importLeadsToTask(workspaceId, corrId, batch.records, { source: 'showcase_csv_import', testData: false });
        if (task.audience_snapshot) {
          task.audience_snapshot.outbound_blocked = false;
          task.audience_snapshot.test_data = false;
        }
        await durableStore.saveTask(task);
        return json(res, 201, { status: 'completed', import_batch_id: batch.import_batch_id, input_count: batch.input_count, accepted_count: batch.accepted_count, rejected_count: batch.rejected_count, correlation_id: corrId, errors: batch.errors || [], contact_fields_persisted: true, warning: null });
      }
      const result = await importIntoCrm(batch, access.bearer);
      if (result.status !== 'completed') return json(res, result.status === 'blocked' ? 503 : 502, result);
      let corrId = null;
      try {
        const existingTasks = listMarketingTasks(workspaceId);
        corrId = existingTasks[0]?.correlation_id || null;
        if (!corrId) {
          const newTask = await dispatchMarketingTask(createHandoverEnvelope({
            workspace_id: workspaceId,
            origin_module: 'marketing',
            target_engine: 'marketing',
            payload: { prompt: 'Audience Outreach Campaign', business_name: 'Matrix 360 Workspace', profile_type: 'b2b_industrial' }
          }), { authToken: access.bearer, keylessTestMode: false });
          corrId = newTask.correlation_id;
        }
        if (corrId && batch.records?.length) {
          const task = importLeadsToTask(workspaceId, corrId, batch.records, { source: 'crm_staging_sync', testData: false });
          if (task.audience_snapshot) {
            task.audience_snapshot.outbound_blocked = false;
            task.audience_snapshot.test_data = false;
          }
          await durableStore.saveTask(task);
        }
      } catch (_) {}
      return json(res, 201, { status: 'completed', import_batch_id: result.import_batch_id, input_count: batch.input_count, accepted_count: result.accepted_count, rejected_count: result.rejected_count, correlation_id: corrId, errors: result.errors || [], contact_fields_persisted: result.contact_fields_persisted !== false, warning: result.warning || null });
    }

    if (action === 'calendar' && ['POST', 'PATCH', 'DELETE'].includes(method)) {
      const corrId = String(body.correlation_id || query.correlation_id || '').trim();
      if (!corrId) return error(res, 400, 'correlation_id is required');
      const operation = method === 'POST' ? 'create' : method === 'PATCH' ? 'update' : 'remove';
      const result = mutateCampaignCalendar(workspaceId, corrId, operation, body);
      await durableStore.saveTask(getMarketingTask(workspaceId, corrId));
      return json(res, 200, { status: 'ok', operation, ...result });
    }

    if (action === 'journeys' && ['POST', 'PATCH', 'DELETE'].includes(method)) {
      const corrId = String(body.correlation_id || query.correlation_id || '').trim();
      if (!corrId) return error(res, 400, 'correlation_id is required');
      const operation = method === 'POST' ? 'create' : method === 'PATCH' ? 'update' : 'remove';
      const result = mutateCampaignJourney(workspaceId, corrId, operation, body);
      await durableStore.saveTask(getMarketingTask(workspaceId, corrId));
      return json(res, 200, { status: 'ok', operation, ...result });
    }

    // 7. Execute / Launch Campaign Channel (Enforces All 3 Gates)
    if (action === 'execute' && method === 'POST') {
      const corrId = String(body.correlation_id || query.correlation_id || '').trim();
      const channel = String(body.channel || '').trim();
      if (!corrId || !channel) {
        return error(res, 400, 'correlation_id and channel are required');
      }

      try {
        const testRecipient=String(body.test_recipient||'').trim();
        const controlledTest=body.controlled_test===true;
        const validRecipient=testRecipient.length<=254&&/^[^\s@<>,;:"\\\[\]()]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(testRecipient);
        if(body.recipient||body.email||(testRecipient&&!controlledTest)||(controlledTest&&
          (channel!=='Email'||body.mode!=='live'||!validRecipient))){
          return error(res,400,'Use the single-email action with a valid recipient address.');
        }

        if(body.mode==='live'&&process.env.M360_MARKETING_CONTROLLED_TEST_ONLY==='true'&&process.env.MARKETING_ALLOWED_RECIPIENT_MODE!=='all'&&(!controlledTest||workspaceId!==process.env.M360_MARKETING_TEST_WORKSPACE))
          return error(res,403,'This preview permits only an allowlisted test email.');
        if(!await findTask(workspaceId,corrId))return error(res,404,'Campaign not found.');
        const result = await executeMarketingChannel(workspaceId, corrId, channel, {
          mode: body.mode,
          operatorApproved: body.operator_approved === true,
          approvalPhrase: String(body.approval_phrase || ''),
          versionHash: String(body.version_hash || ''),
          request_id: randomUUID(),
          actor_id: access.membership?.user_id || access.membership?.member_id || access.membership?.id || null,
          actor_role: access.membership?.role,
          testRecipient,
          privateRecipient: access.privateEmail === true || (controlledTest && validRecipient) || process.env.MARKETING_ALLOWED_RECIPIENT_MODE === 'all'
        });
        await durableStore.saveTask(getMarketingTask(workspaceId, corrId));
        return json(res, 200, { status: 'ok', ...result });
      } catch (execErr) {
        const errStatus = execErr.status === 429 || String(execErr.code || '').startsWith('QUOTA_EXCEEDED') ? 429 : 412;
        return json(res, errStatus, {
          status: 'blocked',
          error: execErr.message,
          code: execErr.code || 'EXECUTION_BLOCKED',
          provider: execErr.provider || null
        });
      }
    }

    return error(res, 404, `Unknown marketing action: ${action}`);
  } catch (err) {
    return error(res, err.code === 'STALE_DRAFT_VERSION' ? 409 : 422, err.message || 'Marketing request could not be completed');
  }
};
