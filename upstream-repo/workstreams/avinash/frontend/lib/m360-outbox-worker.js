'use strict';

const { randomUUID, createHash } = require('node:crypto');
const durableStore = require('./m360-marketing-durable-store');

// In-memory outbox storage for fast path / tests / local fallback
const outboxMemoryStore = new Map();

function computeIdempotencyKey(campaignId, channel, contentHash, contactId) {
  const normChannel = String(channel || '').trim().toLowerCase();
  const input = `${campaignId}:${normChannel}:${contentHash}:${contactId}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Snapshots eligible contacts to campaign_outbox table/store upon approval
 */
async function snapshotAudienceToOutbox({
  workspaceId,
  correlationId,
  channel,
  draftVersion,
  contacts = [],
  mode = 'draft_only'
} = {}) {
  if (!workspaceId || !correlationId || !channel || !draftVersion) {
    throw new Error('workspaceId, correlationId, channel, and draftVersion are required for outbox snapshot.');
  }

  const normChannel = String(channel).trim().toLowerCase();
  const contentHash = String(draftVersion.version_hash || 'draft_v1');
  const items = [];

  for (const contact of contacts) {
    if (!contact) continue;
    // Basic eligibility check
    const contactId = String(contact.id || contact.email || contact.phone || randomUUID());
    const isSuppressed = contact.suppressed === true || contact.unsubscribed === true;
    if (isSuppressed) continue;

    if (normChannel === 'email' && !contact.email) continue;
    if (normChannel === 'whatsapp' && !contact.phone) continue;

    const idempotencyKey = computeIdempotencyKey(correlationId, normChannel, contentHash, contactId);
    const storeKey = `${workspaceId}:${idempotencyKey}`;

    // Skip if already in outbox
    if (outboxMemoryStore.has(storeKey)) continue;

    const row = {
      id: randomUUID(),
      workspace_id: workspaceId,
      campaign_id: correlationId,
      correlation_id: correlationId,
      channel: normChannel,
      contact_id: contactId,
      content_hash: contentHash,
      idempotency_key: idempotencyKey,
      status: 'queued',
      provider_message_id: null,
      attempts: 0,
      last_error: null,
      locked_until: null,
      payload: {
        contact: {
          id: contact.id || null,
          name: contact.name || '',
          email: contact.email || null,
          phone: contact.phone || null,
          company: contact.company_name || contact.company || ''
        },
        draft: {
          subject: draftVersion.subject || '',
          body: draftVersion.body || '',
          template_name: draftVersion.template_name || null,
          version_hash: contentHash,
          version: draftVersion.version || 1
        }
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    outboxMemoryStore.set(storeKey, row);
    items.push(row);
  }

  // Durable store write if enabled
  if (durableStore.enabled && durableStore.enabled()) {
    try {
      await durableStore.enqueueOutboxItems?.(items);
    } catch (_) {}
  }

  return items;
}

/**
 * Claims a batch of queued rows with atomic state lock
 */
function claimOutboxBatch({ workspaceId, correlationId, channel, limit = 20, lockDurationMs = 60000 } = {}) {
  const normChannel = channel ? String(channel).trim().toLowerCase() : null;
  const now = Date.now();
  const claimed = [];

  for (const [key, row] of outboxMemoryStore.entries()) {
    if (workspaceId && row.workspace_id !== workspaceId) continue;
    if (correlationId && row.campaign_id !== correlationId) continue;
    if (normChannel && row.channel !== normChannel) continue;

    // Must be queued, or failed with attempts < 3 and lock expired
    const isQueued = row.status === 'queued';
    const isRetryable = row.status === 'failed' && row.attempts < 3;
    const isLockExpired = !row.locked_until || new Date(row.locked_until).getTime() <= now;

    if ((isQueued || isRetryable) && isLockExpired) {
      row.status = 'sending';
      row.attempts = (row.attempts || 0) + 1;
      row.locked_until = new Date(now + lockDurationMs).toISOString();
      row.updated_at = new Date().toISOString();
      claimed.push(row);
      if (claimed.length >= limit) break;
    }
  }

  return claimed;
}

/**
 * Dispatches a batch of outbox rows with individual result recording
 */
async function processOutboxBatch({
  workspaceId,
  correlationId,
  channel,
  emailAdapter,
  whatsAppAdapter,
  mode = 'live',
  testRecipients = [],
  limit = 20
} = {}) {
  const claimed = claimOutboxBatch({ workspaceId, correlationId, channel, limit });
  const results = [];

  for (const row of claimed) {
    // Mode gate check
    if (mode === 'draft_only') {
      row.status = 'queued';
      row.locked_until = null;
      results.push(row);
      continue;
    }

    if (mode === 'team_test') {
      const email = String(row.payload.contact.email || '').trim().toLowerCase();
      const phone = String(row.payload.contact.phone || '').replace(/\D/g, '');
      const isAllowed = testRecipients.some(t => {
        const normT = String(t).trim().toLowerCase();
        const tPhone = normT.replace(/\D/g, '');
        const emailMatches = Boolean(email && normT === email);
        const phoneMatches = Boolean(phone.length >= 10 && tPhone.length >= 10 && tPhone === phone);
        return emailMatches || phoneMatches;
      });

      if (!isAllowed) {
        row.status = 'skipped';
        row.last_error = 'RECIPIENT_NOT_IN_TEST_ALLOWLIST';
        row.locked_until = null;
        row.updated_at = new Date().toISOString();
        results.push(row);
        continue;
      }
    }

    // Execute through provider
    try {
      if (row.channel === 'email') {
        if (!emailAdapter) {
          throw Object.assign(new Error('Email provider adapter not configured.'), { code: 'PROVIDER_NOT_CONFIGURED' });
        }
        const ack = await emailAdapter.execute({
          to: row.payload.contact.email,
          subject: row.payload.draft.subject,
          text: row.payload.draft.body
        }, {
          mode,
          idempotencyKey: row.idempotency_key
        });

        if (ack?.provider_message_id) {
          row.status = 'provider_accepted';
          row.provider_message_id = ack.provider_message_id;
          row.last_error = null;
        } else {
          row.status = 'failed';
          row.last_error = 'NO_PROVIDER_ID';
        }
      } else if (row.channel === 'whatsapp') {
        if (!whatsAppAdapter) {
          throw Object.assign(new Error('WhatsApp provider adapter not configured.'), { code: 'PROVIDER_NOT_CONFIGURED' });
        }

        // Meta WhatsApp template payload (removes non-standard consent_verified)
        const payload = {
          messaging_product: 'whatsapp',
          to: String(row.payload.contact.phone).replace(/[^\d+]/g, ''),
          type: 'template',
          template: {
            name: row.payload.draft.template_name || 'marketing_outreach_v1',
            language: { code: 'en' }
          }
        };

        const ack = await whatsAppAdapter.execute(payload, {
          mode,
          idempotencyKey: row.idempotency_key
        });

        if (ack?.provider_message_id) {
          row.status = 'provider_accepted';
          row.provider_message_id = ack.provider_message_id;
          row.last_error = null;
        } else {
          row.status = 'failed';
          row.last_error = 'NO_PROVIDER_ID';
        }
      }
    } catch (err) {
      row.status = 'failed';
      row.last_error = err.code || err.message || 'DISPATCH_ERROR';
    } finally {
      row.locked_until = null;
      row.updated_at = new Date().toISOString();
      results.push(row);
    }
  }

  return results;
}

function getOutboxRows(workspaceId, correlationId) {
  const rows = [];
  for (const row of outboxMemoryStore.values()) {
    if (workspaceId && row.workspace_id !== workspaceId) continue;
    if (correlationId && row.campaign_id !== correlationId) continue;
    rows.push({ ...row });
  }
  return rows;
}

function getOutboxSummary(workspaceId, correlationId) {
  const rows = getOutboxRows(workspaceId, correlationId);
  return {
    total: rows.length,
    queued: rows.filter(r => r.status === 'queued').length,
    sending: rows.filter(r => r.status === 'sending').length,
    provider_accepted: rows.filter(r => r.status === 'provider_accepted').length,
    failed: rows.filter(r => r.status === 'failed').length,
    skipped: rows.filter(r => r.status === 'skipped').length,
    rows
  };
}

function resetOutboxStoreForTests() {
  outboxMemoryStore.clear();
}

module.exports = {
  computeIdempotencyKey,
  snapshotAudienceToOutbox,
  claimOutboxBatch,
  processOutboxBatch,
  getOutboxRows,
  getOutboxSummary,
  resetOutboxStoreForTests
};
