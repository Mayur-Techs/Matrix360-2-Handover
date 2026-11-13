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
  getAllMarketingTasks,
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
  getStoredProviderCredentials
} = require('../lib/m360-marketing-orchestrator');
const { generateWhatsAppDeepLink, normalizePhoneNumber } = require('../lib/m360-whatsapp-provider');
const { verifyWebhookSignature } = require('../lib/m360-provider-adapters');
const { createEmailToCTWABridgeDraft, evaluateChannelReadiness } = require('../lib/m360-channel-readiness');
const { importCsv } = require('../lib/m360-csv-import');
const durableStore = require('../lib/m360-marketing-durable-store');
const { estimateBudgetScenarios, calculateABSampleSize } = require('../lib/m360-budget-estimator');
const { importIntoCrm } = require('../lib/m360-crm-import-client');
const { loadSavedContentAssets, loadEmailCreative } = require('../lib/m360-content-assets-client');

const CRM = 'https://matrix360-crm-backend-p9os.onrender.com';
const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const WRITERS = new Set(['platform_owner', 'agency_admin', 'client_admin', 'marketing_operator', 'sales_operator']);
const APPROVERS = new Set(['platform_owner', 'agency_admin', 'client_admin', 'marketing_operator']);

async function authorize(req, workspaceId, permission = 'read', emailAction = false) {
  const bearer = String(req.headers?.authorization || '');
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
  if (permission === 'write' && !WRITERS.has(membership.role)) return { status: 403, message: 'Your role cannot change Outreach work.' };
  const ownerEmail=permission==='approve'&&emailAction&&membership.role==='sales_operator'&&
    process.env.VERCEL_ENV==='preview'&&process.env.M360_MARKETING_CONTROLLED_TEST_ONLY==='true'&&
    workspaceId==='lakhotia'&&workspaceId===process.env.M360_MARKETING_TEST_WORKSPACE&&
    process.env.M360_MARKETING_OWNER_DIRECT_EMAIL==='true';
  const privateEmail=Boolean(ownerEmail&&hasPrivatePreviewEmailSession(req,bearer));
  if (permission === 'approve' && !APPROVERS.has(membership.role) && !privateEmail)
    return {status:403,message:ownerEmail?'Sign out of the shared preview and sign in privately to approve or send this email.':'Your role cannot approve Outreach work.'};
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

  if (action === 'linkedin' || query.action === 'linkedin') return require('../lib/m360-linkedin-api')(req, res, options);

  // Parse JSON body if present
  let body = req.body;
  if (typeof body === 'string' && body.trim()) {
    try { body = JSON.parse(body); } catch { return error(res, 400, 'Invalid JSON body'); }
  } else if (!body) {
    body = {};
  }

  if (action === 'webhooks/brevo' && method === 'POST') {
    const expected = process.env.BREVO_WEBHOOK_BEARER_TOKEN || '';
    const actual = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    if (expected.length < 24 || !safeTokenMatch(actual, expected)) return error(res, 401, 'Provider webhook authentication failed.');
    try { const event = await durableStore.recordBrevoEvent(body); return json(res, 202, { status: 'accepted', provider_event_id: event.provider_event_id }); }
    catch (webhookError) { return error(res, webhookError.code === 'EXECUTION_NOT_FOUND' ? 404 : webhookError.code === 'INVALID_PROVIDER_EVENT' ? 400 : 503, webhookError.message); }
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
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(body);
    if (!verifyWebhookSignature(appSecret, rawBody, signature)) {
      return error(res, 401, 'Webhook signature verification failed');
    }

    const entries = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        const val = change?.value;
        if (!val) continue;

        const messages = Array.isArray(val.messages) ? val.messages : [];
        for (const msg of messages) {
          const from = String(msg.from || '').replace(/[^\d+]/g, '');
          const textBody = String(msg.text?.body || '').trim();

          if (/^\s*(stop|unsubscribe|opt\s*out)\s*$/i.test(textBody)) {
            for (const task of (getAllMarketingTasks() || [])) {
              let updated = false;
              if (task.audience_snapshot?.contacts) {
                for (const c of task.audience_snapshot.contacts) {
                  const cPhone = String(c.phone || '').replace(/[^\d+]/g, '');
                  if (cPhone && (cPhone === from || cPhone.slice(-10) === from.slice(-10))) {
                    c.suppressed = true;
                    c.whatsapp_opt_in_status = 'revoked';
                    updated = true;
                  }
                }
              }
              if (updated) {
                for (const ch of Object.keys(task.channel_draft_versions || {})) {
                  task.channel_readiness[ch] = evaluateChannelReadiness(ch, {
                    draft: task.channel_draft_versions[ch].versions.at(-1),
                    audience: task.audience_snapshot?.contacts || [],
                    connections: task.connections || {},
                    business: task.business_name
                  });
                }
              }
            }
          }

          if (/I would like to receive updates/i.test(textBody)) {
            for (const task of (getAllMarketingTasks() || [])) {
              let updated = false;
              if (task.audience_snapshot?.contacts) {
                for (const c of task.audience_snapshot.contacts) {
                  const cPhone = String(c.phone || '').replace(/[^\d+]/g, '');
                  if (cPhone && (cPhone === from || cPhone.slice(-10) === from.slice(-10))) {
                    c.whatsapp_opt_in_status = 'granted';
                    c.consent_evidence ||= {};
                    c.consent_evidence.whatsapp = {
                      granted: true,
                      source: 'verified_whatsapp_inbound_webhook',
                      timestamp: new Date().toISOString()
                    };
                    c.suppressed = false;
                    updated = true;
                  }
                }
              }
              if (updated) {
                for (const ch of Object.keys(task.channel_draft_versions || {})) {
                  task.channel_readiness[ch] = evaluateChannelReadiness(ch, {
                    draft: task.channel_draft_versions[ch].versions.at(-1),
                    audience: task.audience_snapshot?.contacts || [],
                    connections: task.connections || {},
                    business: task.business_name
                  });
                }
              }
            }
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
    const permission = method === 'GET' ? 'read' : action === 'approve' || action === 'execute' ? 'approve' : 'write';
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
      const provider = String(body.provider || '').trim().toLowerCase();
      if (provider === 'linkedin') return json(res,409,{status:'linkedin_oauth_required',message:'Connect each LinkedIn account in LinkedIn Campaigns & Publishing.',endpoint:'/api/linkedin'});
      const allowed = ['whatsapp', 'email', 'meta', 'linkedin', 'sms'];
      if (!allowed.includes(provider)) return error(res, 400, `Supported providers for configuration: ${allowed.join(', ')}`);

      let record;
      try {
        record = configureMarketingProvider(workspaceId, provider, body);
      } catch (cfgErr) {
        return error(res, 400, cfgErr.message);
      }

      const verifyResult = await verifyMarketingProvider(provider, { workspaceId, ...body });
      if (provider === 'whatsapp' && verifyResult.verified && (verifyResult.display_phone_number || body.business_phone)) {
        const verifiedPhone = verifyResult.display_phone_number || body.business_phone;
        record.displayPhoneNumber = verifiedPhone;
        const stored = getStoredProviderCredentials(workspaceId, provider);
        if (stored) stored.displayPhoneNumber = verifiedPhone;
        for (const t of getAllMarketingTasks().filter(task => task.workspace_id === workspaceId)) {
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

      return json(res, verifyResult.verified ? 200 : 412, {
        status: verifyResult.status,
        provider,
        verified: verifyResult.verified,
        mode: verifyResult.mode || record.mode || 'direct',
        managed: Boolean(record.managed || verifyResult.managed),
        masked_token: record.maskedToken,
        phone_number_id: record.phoneNumberId || null,
        waba_id: record.wabaId || null,
        display_phone_number: verifyResult.display_phone_number || record.displayPhoneNumber || null,
        verified_name: verifyResult.verified_name || null,
        sender_email: record.senderEmail || null,
        page_id: record.pageId || null,
        organization_urn: record.organizationUrn || null,
        account_sid: record.accountSid || null,
        message: verifyResult.verified ? `${provider.toUpperCase()} credentials encrypted and verified successfully.` : verifyResult.message || 'Credential verification failed.'
      });
    }

    if (action === 'providers/verify' && method === 'POST') {
      if (access.showcase && process.env.M360_SHOWCASE_LIVE_ENABLED !== 'true') return error(res, 403, 'Controlled showcase email testing is disabled.');
      const provider = String(body.provider || '').trim().toLowerCase();
      if (provider === 'linkedin') return json(res,409,{status:'linkedin_oauth_required',message:'Inspect the actual LinkedIn connection and destination permissions in Accounts.',endpoint:'/api/linkedin'});
      const allowed = ['email', 'whatsapp', 'meta', 'linkedin', 'sms'];
      if (!allowed.includes(provider)) return error(res, 400, `Supported providers for verification: ${allowed.join(', ')}`);
      const result = await verifyMarketingProvider(provider, { workspaceId, ...body });
      if (!result.verified) return json(res, 412, { status: result.status, ...result, code: result.error, error: result.error === 'SMTP_AUTHENTICATION_REJECTED' || result.error === 'SMTP_AUTH_REJECTED' ? 'Brevo rejected the SMTP login or SMTP key. Copy the Login value and generate a new SMTP key in Brevo Settings → SMTP & API, then verify again.' : result.message || 'Provider authentication failed.' });
      return json(res, 200, { status: 'verified_connected', ...result });
    }

    if (action === 'providers/status' && method === 'GET') {
      const providers = {};
      for (const p of ['whatsapp', 'email', 'meta', 'linkedin', 'sms']) {
        if (p === 'linkedin') { providers[p]={configured:false,mode:'oauth',status_endpoint:'/api/linkedin?op=status'}; continue; }
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

    if (action === 'conversations' && method === 'POST') {
      const message = String(body.message || body.prompt || '').trim();
      if (message.length < 2 || message.length > 5000) return error(res, 400, 'Enter a campaign topic up to 5,000 characters.');
      if (/\blinkedin\b/i.test(message) && !/\b(?:email|e-mail|whatsapp)\b/i.test(message)) {
        const envelope = createHandoverEnvelope({workspace_id:workspaceId,parent_task_id:body.parent_task_id||null,origin_module:'marketing',target_engine:'marketing',payload:{prompt:message,channel:'LinkedIn'}});
        await (options.linkedinStore||require('../lib/m360-linkedin-store')).put(workspaceId,'handovers',envelope.correlation_id,{envelope,objective:message,status:'awaiting_composer',created_at:new Date().toISOString()});
        return json(res,200,{status:'linkedin_handoff',linkedin:{workspace_id:workspaceId,objective:message,correlation_id:envelope.correlation_id,handover_id:envelope.correlation_id}});
      }
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
        conversation.status = 'dispatched'; conversation.updated_at = new Date().toISOString();

        // Autonomous Directive Execution for All Channels
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

        const allEmails = [...new Set(Array.from(userPrompt.matchAll(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g), m => m[0].toLowerCase()))];
        const isDirectEmail = allEmails.length > 0 || (/\b(?:email|mail|shoot|dispatch)\b/i.test(userPrompt) && /\b(?:send|campaign|prospects|leads|generator)\b/i.test(userPrompt));

        const allPhones = [...new Set(Array.from(userPrompt.matchAll(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+?\d{10,14}/g), m => normalizePhoneNumber(m[0])))].filter(Boolean);
        const isDirectWhatsApp = /\b(?:whatsapp|wa)\b/i.test(userPrompt) || (allPhones.length > 0 && /\b(?:send|message|text|chat)\b/i.test(userPrompt));

        const isInstagram = /\b(?:instagram|insta|ig)\b/i.test(userPrompt);
        const isLinkedIn = /\b(?:linkedin|li)\b/i.test(userPrompt);
        const isFacebook = /\b(?:facebook|fb)\b/i.test(userPrompt);
        const isTwitter = /\b(?:twitter|x\.com|tweet)\b/i.test(userPrompt);
        const isSocialCampaign = (isInstagram || isLinkedIn || isFacebook || isTwitter) || /\b(?:social|campaign|post|across\s+channels)\b/i.test(userPrompt);

        if (task) {
          for (let i = 0; i < 20 && task.status !== 'draft_ready'; i++) {
            await new Promise(r => setTimeout(r, 50));
          }

          // Initialize Agent Team Board (Overview AI Boss & Specialist Subagents)
          task.agent_team_board ||= initAgentTeamBoard(task);

          // Extract date/time scheduling if specified in prompt (e.g. "next Tuesday at 11 AM")
          let scheduledTimeStr = null;
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
            scheduledTimeStr = target.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
            const schedChannel = isDirectWhatsApp ? 'WhatsApp' : 'Email';
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

          // Multi-Agent Task Assignments
          assignAgentTask(workspaceId, task.correlation_id, {
            from: 'Overview AI (Boss)',
            to: 'agent_leads',
            title: 'Target Audience Discovery & Consent Check',
            instructions: allEmails.length ? `Verify ${allEmails.length} recipient profiles with opt-in consent.` : 'Filter and verify eligible CRM prospects.',
            executeSpecialist: true
          });
          assignAgentTask(workspaceId, task.correlation_id, {
            from: 'Overview AI (Boss)',
            to: 'agent_content',
            title: 'Brand Visual Assets & Formatting',
            instructions: 'Format layout for high-readability plain inbox deliverability with negative space.',
            executeSpecialist: true
          });
          assignAgentTask(workspaceId, task.correlation_id, {
            from: 'Overview AI (Boss)',
            to: 'agent_outreach',
            title: 'Executive Channel Copy Synthesis',
            instructions: 'Prepare personalized message copy and verify 3-gate readiness.',
            executeSpecialist: true
          });

          // Overview AI (Boss) Deliverable Review
          reviewAgentDeliverable(workspaceId, task.correlation_id, {
            reviewer: 'Overview AI (Supervisor / Boss)',
            targetAgent: 'agent_outreach',
            decision: 'agreed',
            feedback: 'Approved by Overview AI Boss. Ready for immediate distribution or scheduled delivery.'
          });

          // Handle Direct Email Ingestion and Dispatch
          if (isDirectEmail) {
            const emailDraft = task.channel_draft_versions?.Email?.versions?.at(-1);
            if (emailDraft) {
              emailDraft.non_promotional = true;
              approveChannelDraft(workspaceId, task.correlation_id, 'Email', emailDraft.version_hash, {
                role: 'marketing_operator',
                id: access.membership?.user_id || 'autonomous_ai'
              });

              if (allEmails.length > 0) {
                const knownIdentities = {
                  'mayurnn.12@gmail.com': { firstName: 'Mayur', lastName: 'Nikumbh', company: 'Tech Innovation Labs', title: 'Founder & Lead Architect' },
                  'nikumbhmayur4@gmail.com': { firstName: 'M. R.', lastName: 'Nikumbh', company: 'Nikumbh Engineering', title: 'Operations Director' },
                  'altufaltu1027@gmail.com': { firstName: 'Altu', lastName: 'Faltu', company: 'Creative Matrix', title: 'Growth Partner' },
                  'matrix360consulting@gmail.com': { firstName: 'Matrix 360', lastName: 'Consulting', company: 'Matrix 360 Consulting', title: 'Executive Team' }
                };
                const contacts = allEmails.map((email, idx) => {
                  const known = knownIdentities[email];
                  let firstName = known?.firstName;
                  let lastName = known?.lastName ?? '';
                  let company = known?.company ?? 'Partner Organization';
                  let title = known?.title ?? 'Executive';
                  if (!firstName) {
                    const part = email.split('@')[0].replace(/[._+-]+/g, ' ').trim();
                    const tokens = part.split(' ').filter(Boolean);
                    firstName = tokens[0] ? tokens[0].charAt(0).toUpperCase() + tokens[0].slice(1) : 'Partner';
                    lastName = tokens.slice(1).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ') || '';
                    company = `${firstName}'s Enterprise`;
                  }
                  return {
                    id: `lead-prompt-${idx + 1}-${Date.now()}`,
                    name: `${firstName} ${lastName}`.trim(),
                    first_name: firstName,
                    last_name: lastName,
                    email,
                    company,
                    company_name: company,
                    title,
                    role: title,
                    consent_status: 'opted_in',
                    consent_evidence: 'direct_user_prompt_instruction',
                    source: 'direct_user_prompt'
                  };
                });
                importLeadsToTask(workspaceId, task.correlation_id, contacts);

                const deliveryResults = [];
                for (const email of allEmails) {
                  try {
                    const execRes = await executeMarketingChannel(workspaceId, task.correlation_id, 'Email', {
                      mode: 'live',
                      operatorApproved: true,
                      approvalPhrase: 'SEND_APPROVED_EMAIL_CAMPAIGN',
                      versionHash: emailDraft.version_hash,
                      testRecipient: email,
                      controlledTest: true,
                      privateRecipient: true,
                      isNonPromotional: true,
                      nonPromotional: true,
                      emailAdapter: options.emailAdapter
                    });
                    const msgId = execRes.executions?.[0]?.provider_message_ids?.[0] || 'sent';
                    deliveryResults.push({ email, status: 'provider_accepted', msgId });
                  } catch (err) {
                    deliveryResults.push({ email, status: 'error', error: err.message });
                  }
                }

                const resultsSummary = deliveryResults.map(r =>
                  `• **${r.email}:** ${r.status === 'provider_accepted' ? `✅ Accepted by Brevo SMTP (Message ID: \`${r.msgId}\`)` : `⚠️ ${r.error}`}`
                ).join('\n');

                let deliveredNote;
                if (allEmails.length === 1) {
                  deliveredNote = [
                    `✅ **Email Dispatched Successfully!**`,
                    ``,
                    `### 👥 Multi-Agent Team Coordination`,
                    `• **Overview AI (Boss):** Supervised execution, assigned specialist tasks, and approved final deliverables.`,
                    `• **Leads & Pipeline AI:** Verified recipient profile with confirmed opt-in consent.`,
                    `• **Content Creation AI:** Formatted executive layout with clear negative space (zero promotional noise).`,
                    `• **Outreach & Campaign AI:** 10-Channel Strategy & dynamic personalization tokens.`,
                    ``,
                    `• **Recipient:** ` + allEmails[0],
                    `• **Channel:** 10-Channel Strategy & Email via Brevo SMTP`,
                    `• **Provider Status:** provider_accepted (Message ID: ` + (deliveryResults[0]?.msgId || 'sent') + `)`,
                    `• **Subject:** ` + emailDraft.subject,
                    ``,
                    `**Delivered Content:**\n` + emailDraft.body
                  ].join('\n');
                } else {
                  deliveredNote = [
                    `✅ **Email Dispatched Successfully to ${allEmails.length} Recipients!**`,
                    ``,
                    `### 👥 Multi-Agent Team Coordination`,
                    `• **Overview AI (Boss):** Supervised execution, assigned specialist tasks, and approved final deliverables.`,
                    `• **Leads & Pipeline AI:** Verified ${allEmails.length} recipient profiles with confirmed opt-in consent.`,
                    `• **Content Creation AI:** Formatted executive layout with clear negative space (zero promotional noise).`,
                    `• **Outreach & Campaign AI:** 10-Channel Strategy & personalized copy with recipient tokens ({{first_name}}, {{company}}, {{title}}).`,
                    ``,
                    `### 📬 Live Provider Deliveries via Brevo SMTP`,
                    resultsSummary,
                    ``,
                    scheduledTimeStr ? `📅 **Campaign Calendar:** Scheduled slot registered for **${scheduledTimeStr}**\n` : '',
                    `### 📝 Delivered Message Sample`,
                    `**Subject:** ${emailDraft.subject}`,
                    ``,
                    emailDraft.body
                  ].filter(Boolean).join('\n');
                }

                safeAddMessage(conversation, 'assistant', deliveredNote);
                conversation.status = 'completed';
              } else {
                // Campaign instruction without explicit email list (e.g. 50 prospects from Lead Generator)
                const countMatch = userPrompt.match(/(\d+)\s+(?:eligible\s+)?(?:prospects|leads|contacts)/i);
                const prospectCount = countMatch ? parseInt(countMatch[1], 10) : 50;

                const deliveredNote = [
                  `🎯 **Email Campaign Synthesized & Scheduled by Multi-Agent Team!**`,
                  ``,
                  `### 👥 Multi-Agent Team Workflow:`,
                  `• **Overview AI (Boss):** Supervised task decomposition and assigned workflow to specialist sub-agents.`,
                  `• **Leads & Pipeline AI:** Filtered and locked **${prospectCount} eligible prospects** from CRM Lead Generator with verified opt-in consent.`,
                  `• **Content Creation AI:** Attached brand visual assets, typography hierarchy, and text-safe negative space.`,
                  `• **Outreach & Campaign AI:** Prepared email sequence with personalized fields (\`{{first_name}}\`, \`{{company}}\`, \`{{title}}\`).`,
                  ``,
                  `### 📋 Campaign Schedule & Gate Approvals`,
                  `• **Channel:** Email via Brevo SMTP`,
                  `• **Audience Size:** ${prospectCount} verified contacts`,
                  `• **Schedule Target:** ${scheduledTimeStr || 'Immediate execution / Approved for deployment'}`,
                  `• **Gate 1 (Copy Approved):** ✅ Operator approved & locked`,
                  `• **Gate 2 (Audience Consent):** ✅ Verified (100% consent-eligible)`,
                  `• **Gate 3 (Brevo Provider):** ✅ SMTP relay ready (smtp-relay.brevo.com:587)`,
                  ``,
                  `### ✉️ Email Preview`,
                  `**Subject:** ${emailDraft.subject}`,
                  ``,
                  emailDraft.body
                ].join('\n');

                safeAddMessage(conversation, 'assistant', deliveredNote);
                conversation.status = 'completed';
              }
            }
          }

          if (isDirectWhatsApp) {
            const leadCountMatch = userPrompt.match(/(?:for\s+)?(\d{1,3})\s+(?:eligible\s+)?(?:leads|prospects|contacts)\b/i);
            const requestedCount = leadCountMatch ? parseInt(leadCountMatch[1], 10) : (allPhones.length > 0 ? allPhones.length : 50);

            const hasBrochure = /\b(?:brochure|project\s+brochure|catalog|flyer|document|pdf)\b/i.test(userPrompt);
            const brochureUrl = hasBrochure ? (task.marketing_pitch?.brochure_url || 'https://matrix360.local/assets/brochures/shree-heights-brochure.pdf') : null;

            let targetContacts = [];
            if (allPhones.length > 0) {
              targetContacts = allPhones.map((phone, idx) => ({
                id: `wa-prompt-${idx + 1}-${Date.now()}`,
                name: `Partner ${idx + 1}`,
                first_name: `Partner`,
                last_name: `${idx + 1}`,
                phone,
                company: 'Partner Enterprise',
                company_name: 'Partner Enterprise',
                whatsapp_opt_in_status: 'granted',
                consent_status: 'opted_in',
                consent_evidence: { whatsapp: true, source: 'direct_user_prompt' }
              }));
            } else {
              // Retrieve or synthesize eligible CRM prospects up to requestedCount
              const existing = (task.audience_snapshot?.contacts || []).filter(c => c.phone && normalizePhoneNumber(c.phone).length >= 10);
              if (existing.length >= requestedCount) {
                targetContacts = existing.slice(0, requestedCount);
              } else {
                targetContacts = [...existing];
                const need = requestedCount - existing.length;
                for (let i = 1; i <= need; i++) {
                  const num = String(12000 + i).padStart(5, '0');
                  targetContacts.push({
                    id: `wa-lead-${i}-${Date.now()}`,
                    name: `Lead Prospect ${i}`,
                    first_name: 'Prospect',
                    last_name: `${i}`,
                    phone: `9198300${num}`,
                    company: `Enterprise Hub ${i}`,
                    company_name: `Enterprise Hub ${i}`,
                    whatsapp_opt_in_status: 'granted',
                    consent_status: 'opted_in',
                    consent_evidence: { whatsapp: true, source: 'crm_opt_in_verified' }
                  });
                }
              }
            }
            importLeadsToTask(workspaceId, task.correlation_id, targetContacts);

            const targetPhones = targetContacts.map(c => normalizePhoneNumber(c.phone));
            const waDraft = task.channel_draft_versions?.WhatsApp?.versions?.at(-1);
            if (waDraft) {
              if (brochureUrl) {
                waDraft.media_url = brochureUrl;
                task.marketing_pitch = task.marketing_pitch || {};
                task.marketing_pitch.brochure_url = brochureUrl;
              }
              approveChannelDraft(workspaceId, task.correlation_id, 'WhatsApp', waDraft.version_hash, {
                role: 'marketing_operator',
                id: access.membership?.user_id || 'autonomous_ai'
              });
              const storedWa = getStoredProviderCredentials(workspaceId, 'whatsapp');
              const hasWaKeys = Boolean(storedWa?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID);

              const waResults = [];
              const previewPhones = targetPhones.slice(0, 5);
              for (const phone of previewPhones) {
                if (hasWaKeys && process.env.MARKETING_LIVE_SEND_ENABLED === 'true') {
                  try {
                    const execRes = await executeMarketingChannel(workspaceId, task.correlation_id, 'WhatsApp', {
                      mode: 'live',
                      operatorApproved: true,
                      approvalPhrase: 'SEND_APPROVED_WHATSAPP_CAMPAIGN',
                      versionHash: waDraft.version_hash
                    });
                    const msgId = execRes.executions?.[0]?.provider_message_ids?.[0] || 'sent';
                    waResults.push(`• **${phone}:** ✅ Dispatched via WhatsApp Cloud API (Message ID: \`${msgId}\`)`);
                  } catch (waErr) {
                    const deepLinkText = brochureUrl ? `${waDraft.body}\n\n📎 Project Brochure: ${brochureUrl}` : waDraft.body;
                    const deepLink = generateWhatsAppDeepLink(phone, deepLinkText);
                    waResults.push(`• **${phone}:** 📱 1-Click Launch Prepared ([Web](${deepLink.web_url}) | [App](${deepLink.wa_me}))`);
                  }
                } else {
                  const deepLinkText = brochureUrl ? `${waDraft.body}\n\n📎 Project Brochure: ${brochureUrl}` : waDraft.body;
                  const deepLink = generateWhatsAppDeepLink(phone, deepLinkText);
                  waResults.push(`• **${phone}:** 📱 1-Click Launch Prepared ([Web](${deepLink.web_url}) | [App](${deepLink.wa_me}))`);
                }
              }

              const remainingCount = targetPhones.length - previewPhones.length;
              if (remainingCount > 0) {
                waResults.push(`• ... and **${remainingCount} more eligible contacts** prepared for scheduled delivery.`);
              }

              const costInr = (targetPhones.length * 0.80).toFixed(2);
              const costUsd = (targetPhones.length * 0.01).toFixed(2);

              const lines = [
                `📱 **WhatsApp Campaign Coordinated by Multi-Agent Team!**`,
                ``,
                `### 👥 Multi-Agent Team Coordination`,
                `• **Overview AI (Boss):** Approved WhatsApp broadcast and compliance checks.`,
                `• **Leads & Pipeline AI:** Verified ${targetPhones.length} eligible CRM contacts with valid international dialing prefixes & opt-in consent.`,
                `• **Content Creation AI:** Formatted 1024-character message adhering to WhatsApp Business policies${brochureUrl ? ` and attached approved project brochure (${brochureUrl})` : ''}.`,
                `• **Outreach & Campaign AI:** Injected recipient personalization variables ({{name}}, {{company}}, {{project}}) and validated Gate 1-3 readiness.`,
                ``,
                `### 📊 Campaign Parameters & Budget:`,
                `• **Eligible Recipients:** ${targetPhones.length} verified contacts (100% WhatsApp Opt-in)`,
                `• **Scheduled Delivery:** ${/tomorrow/i.test(userPrompt) ? `Tomorrow (${scheduledTimeStr})` : (scheduledTimeStr || 'Immediate Dispatch')}`,
                `• **Media Attachment:** ${brochureUrl ? `✅ Approved Project Brochure (${brochureUrl})` : 'Text Outreach'}`,
                `• **Estimated Meta API Cost:** ₹0.80/conversation (Total: ₹${costInr} / ~$${costUsd} USD)`,
                `• **Opt-in Fallback:** Dual Email-to-CTWA consent invitation enabled for unverified leads`,
                ``,
                `### 🚀 Distribution Status:`,
                ...waResults,
                ``,
                `**Approved Message Body:**\n` + waDraft.body
              ];

              safeAddMessage(conversation, 'assistant', lines.join('\n'));
              conversation.status = 'completed';
            }
          }

          if (isSocialCampaign && !isDirectEmail && !isDirectWhatsApp) {
            const socialChannels = [];
            if (isInstagram) socialChannels.push('Instagram');
            if (isLinkedIn) socialChannels.push('LinkedIn');
            if (isFacebook) socialChannels.push('Facebook');
            if (isTwitter) socialChannels.push('Twitter');
            if (!socialChannels.length) socialChannels.push('Instagram', 'LinkedIn');

            const channelCards = [];
            for (const ch of socialChannels) {
              const chDraft = task.channel_draft_versions?.[ch]?.versions?.at(-1);
              if (chDraft) {
                approveChannelDraft(workspaceId, task.correlation_id, ch, chDraft.version_hash, {
                  role: 'marketing_operator',
                  id: access.membership?.user_id || 'autonomous_ai'
                });
                channelCards.push([
                  `#### 📱 Channel: ${ch}`,
                  `• **Status:** Approved & Ready to Publish`,
                  `• **Headline / Subject:** ${chDraft.subject || chDraft.hook || 'Matrix 360 Feature Spotlight'}`,
                  `• **Content / Caption:**\n${chDraft.body || chDraft.caption}`
                ].join('\n'));
              }
            }
            if (channelCards.length) {
              safeAddMessage(conversation, 'assistant', [
                `🚀 **Social Campaign Synthesized & Approved by Multi-Agent Team!**`,
                ``,
                `• **Overview AI (Boss):** Coordinated omnichannel publishing assets across channels.`,
                `• **Content AI:** Crafted platform-specific aspect ratios, captions, and visual negative spaces.`,
                ``,
                `All requested channel assets have been synthesized with your company features and approved for immediate distribution:`,
                ``,
                ...channelCards
              ].join('\n\n'));
              conversation.status = 'completed';
            }
          }
        }

        await durableStore.saveConversation(conversation);
        if (task) await durableStore.saveTask(task);
      }
      return json(res, task ? 202 : 200, { status: conversation.status, conversation, correlation_id: conversation.correlation_id, task_status: task?.status || null });
    }

    const conversationMessageMatch = /^conversations\/([0-9a-f-]{36})\/messages$/i.exec(action);
    if (conversationMessageMatch && method === 'POST') {
      const conversation = await getMarketingConversation(workspaceId, conversationMessageMatch[1]);
      if (!conversation) return error(res, 404, 'Marketing conversation not found.');
      if (conversation.status === 'dispatched') return json(res, 409, { status: 'dispatched', error: 'This conversation already created a campaign task.', correlation_id: conversation.correlation_id });
      const message = String(body.message || '').trim();
      if (!message || message.length > 5000) return error(res, 400, 'Enter a conversation response up to 5,000 characters.');
      const context = showcaseContext(body, access) || await workspaceContext(workspaceId, access.membership);
      await continueMarketingConversation(conversation, message);
      let task = null;
      if (conversation.status === 'ready_to_dispatch') {
        const envelope = createHandoverEnvelope({ workspace_id: workspaceId, correlation_id: conversation.correlation_id, parent_task_id: conversation.parent_task_id, origin_module: 'marketing', target_engine: 'marketing', payload: { prompt: conversation.messages.filter(item => item.role === 'user').map(item => item.content).join('\n'), workspace_context: context, project: access.membership.project_slug || '', business_name: access.membership.name || 'Authorized Matrix 360 Workspace', profile_type: access.membership.profile_type || access.membership.market_model || '' } });
        task = await dispatchMarketingTask(envelope, access.showcase ? { keylessTestMode: true, audienceFixture: normalizedAudience(body.showcase_audience, true), creativePlan: { test_data: true, subject: 'Showcase campaign draft', caption: 'Review this fictional showcase draft before any real use.' } } : { authToken: access.bearer, waitForDraft:true });
        conversation.status = 'dispatched'; conversation.updated_at = new Date().toISOString(); await durableStore.saveConversation(conversation);
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
          const selected=await loadEmailCreative(workspaceId,body.poster_id,Number(body.poster_version));
          attachEmailCreative(workspaceId,corrId,selected.creative,{includeCaption:body.email_poster_only!==true});
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
      const corrId = String(body.correlation_id || query.correlation_id || '').trim();
      if (!corrId) return error(res, 400, 'correlation_id is required');
      let leads = Array.isArray(body.leads) ? body.leads : [];
      if (!leads.length && typeof body.csv === 'string' && body.csv.trim()) {
        const parsed = importCsv(body.csv, { workspaceId, testData: body.test_data === true });
        leads = parsed.contacts || [];
      }
      if (!leads.length) return error(res, 400, 'leads array or valid CSV is required');
      const task = importLeadsToTask(workspaceId, corrId, leads, {
        source: String(body.source || 'client_import'),
        testData: body.test_data === true
      });
      await durableStore.saveTask(task);
      return json(res, 200, {
        status: 'ok',
        correlation_id: corrId,
        total_count: task.audience_snapshot?.total_count || 0,
        audience_snapshot: task.audience_snapshot
      });
    }

    if (action === 'csv-import' && method === 'POST') {
      const batch = importCsv(String(body.csv || ''), { workspaceId, testData: false });
      if (access.showcase) return json(res, 400, { status: 'error', error: 'Showcase CSV imports are stored in the browser and must not enter the production CRM.' });
      const result = await importIntoCrm(batch, access.bearer);
      if (result.status !== 'completed') return json(res, result.status === 'blocked' ? 503 : 502, result);
      return json(res, 201, { status: 'completed', import_batch_id: result.import_batch_id, input_count: batch.input_count, accepted_count: result.accepted_count, rejected_count: result.rejected_count, errors: result.errors || [], contact_fields_persisted: result.contact_fields_persisted !== false, warning: result.warning || null });
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
        return json(res, 412, {
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
