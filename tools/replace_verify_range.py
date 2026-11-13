# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('Matrix360-Mayur-Handoff-2026-10-29/workstreams/avinash/frontend/api/marketing.js', 'r', encoding='utf-8') as f:
    text = f.read()

idx = text.find("if (action === 'providers/verify'")
idx2 = text.find("if (action === 'conversations'", idx)

new_block = """if (action === 'providers/configure' && method === 'POST') {
      const provider = String(body.provider || '').trim().toLowerCase();
      if (provider !== 'whatsapp') return error(res, 400, 'Supported providers for configuration: whatsapp');
      const token = String(body.token || '').trim();
      const phoneNumberId = String(body.phone_number_id || '').trim();
      const wabaId = String(body.waba_id || '').trim();
      if (!token || !phoneNumberId) return error(res, 400, 'Meta WhatsApp API Token and Phone Number ID are required.');
      const record = configureMarketingProvider(workspaceId, provider, { token, phoneNumberId, wabaId });
      const verifyResult = await verifyMarketingProvider('whatsapp', { workspaceId, token, phoneNumberId, wabaId });
      return json(res, verifyResult.verified ? 200 : 412, {
        status: verifyResult.status,
        provider: 'whatsapp',
        verified: verifyResult.verified,
        masked_token: record.maskedToken,
        phone_number_id: record.phoneNumberId,
        waba_id: record.wabaId,
        display_phone_number: verifyResult.display_phone_number || null,
        verified_name: verifyResult.verified_name || null,
        message: verifyResult.verified ? 'Meta WhatsApp key encrypted and verified successfully.' : verifyResult.message || 'Credential verification failed.'
      });
    }

    if (action === 'providers/verify' && method === 'POST') {
      if (access.showcase && process.env.M360_SHOWCASE_LIVE_ENABLED !== 'true') return error(res, 403, 'Controlled showcase email testing is disabled.');
      const provider = String(body.provider || '').trim().toLowerCase();
      if (!['email', 'whatsapp'].includes(provider)) return error(res, 400, 'Only the Brevo email connection or Meta WhatsApp connection can be verified in this release.');
      const result = await verifyMarketingProvider(provider, { workspaceId, ...body });
      if (!result.verified) return json(res, 412, { status: result.status, ...result, code: result.error, error: result.error === 'SMTP_AUTHENTICATION_REJECTED' || result.error === 'SMTP_AUTH_REJECTED' ? 'Brevo rejected the SMTP login or SMTP key. Copy the Login value and generate a new SMTP key in Brevo Settings → SMTP & API, then verify again.' : result.message || 'Provider authentication failed.' });
      return json(res, 200, { status: 'verified_connected', ...result });
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

    """

if idx != -1 and idx2 != -1:
    text = text[:idx] + new_block + text[idx2:]
    with open('Matrix360-Mayur-Handoff-2026-10-29/workstreams/avinash/frontend/api/marketing.js', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Replaced successfully")
else:
    print("Indices not found:", idx, idx2)
