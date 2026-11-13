'use strict';

/**
 * Matrix 360 Agentic WhatsApp Delivery & 1-Click Launch Engine
 *
 * Supports:
 * - Meta WhatsApp Business Cloud API v20.0
 * - 1-Click Direct WhatsApp Web & Desktop deep-links
 * - Phone number normalization (E.164 without plus)
 * - Message personalization & Markdown-safe formatting
 * - Outbox ledger and broadcast delivery tracking
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const OUTBOX_DIR = path.join(__dirname, '../data');
const OUTBOX_FILE = path.join(OUTBOX_DIR, 'whatsapp-outbox.json');

function loadOutbox() {
  try {
    if (fs.existsSync(OUTBOX_FILE)) {
      return JSON.parse(fs.readFileSync(OUTBOX_FILE, 'utf8')) || [];
    }
  } catch (_) {}
  return [];
}

function saveOutbox(records) {
  try {
    if (!fs.existsSync(OUTBOX_DIR)) fs.mkdirSync(OUTBOX_DIR, { recursive: true });
    fs.writeFileSync(OUTBOX_FILE, JSON.stringify(records.slice(-500), null, 2), 'utf8');
  } catch (_) {}
}

/**
 * Normalizes phone numbers to standard international digits (e.g. 919830012345)
 */
function normalizePhoneNumber(rawPhone, defaultCountry = '91') {
  if (!rawPhone) return '';
  let digits = String(rawPhone).replace(/\D+/g, '');
  if (digits.length === 10) {
    digits = defaultCountry + digits;
  }
  if (digits.startsWith('0') && digits.length === 11) {
    digits = defaultCountry + digits.slice(1);
  }
  return digits;
}

/**
 * Personalizes WhatsApp text copy with variables and formatting
 */
function personalizeWhatsAppCopy(text, lead = {}, business = 'Matrix 360') {
  let body = String(text || '');
  const name = lead.name || lead.decision_maker || 'Valued Partner';
  const company = lead.company_name || lead.company || business;
  const project = lead.project || business;

  body = body.replace(/\{\{\s*name\s*\}\}/gi, name);
  body = body.replace(/\{\{\s*contact_name\s*\}\}/gi, name);
  body = body.replace(/\{\{\s*company\s*\}\}/gi, company);
  body = body.replace(/\{\{\s*company_name\s*\}\}/gi, company);
  body = body.replace(/\{\{\s*project\s*\}\}/gi, project);
  return body.trim();
}

/**
 * Generates an official 1-click WhatsApp Web / App link
 */
function generateWhatsAppDeepLink(phone, message) {
  const cleanPhone = normalizePhoneNumber(phone);
  const encoded = encodeURIComponent(message);
  return {
    web_url: `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encoded}`,
    app_url: `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encoded}`,
    wa_me: `https://wa.me/${cleanPhone}?text=${encoded}`,
    clean_phone: cleanPhone
  };
}

/**
 * Dispatches a WhatsApp broadcast or generates 1-click individual outreach links
 */
async function dispatchWhatsAppCampaign({
  audience = [],
  body,
  businessName = 'Matrix 360 Workspace',
  workspaceId = null,
  token: explicitToken = null,
  phoneNumberId: explicitPhoneId = null,
  mediaUrl = null,
  mediaType = null
}) {
  let token = explicitToken;
  let phoneId = explicitPhoneId;

  if ((!token || !phoneId) && workspaceId) {
    try {
      const { getStoredProviderCredentials, decryptSecret } = require('./m360-marketing-orchestrator');
      const stored = getStoredProviderCredentials(workspaceId, 'whatsapp');
      if (stored) {
        phoneId = phoneId || stored.phoneNumberId || stored.phone_number_id;
        if (stored.encryptedToken) {
          token = token || decryptSecret(stored.encryptedToken, workspaceId);
        }
      }
    } catch (_) {}
  }

  if (!token) token = process.env.WHATSAPP_API_TOKEN;
  if (!phoneId) phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const isCloudApiConfigured = Boolean(token && phoneId);

  const eligible = audience.filter(c => c.phone && normalizePhoneNumber(c.phone).length >= 10);
  const results = [];

  for (const lead of eligible) {
    const cleanPhone = normalizePhoneNumber(lead.phone);
    const personalizedText = personalizeWhatsAppCopy(body, lead, businessName);
    let deepLinkText = personalizedText;
    if (mediaUrl) {
      deepLinkText = `${personalizedText}\n\n📎 Project Brochure / Media: ${mediaUrl}`;
    }
    const links = generateWhatsAppDeepLink(cleanPhone, deepLinkText);

    let deliveredVia = '1-Click Direct WhatsApp Gateway';
    let liveSent = false;
    let messageId = null;
    let status = 'deep_link_prepared_not_sent';
    let failureReason = null;

    if (isCloudApiConfigured) {
      try {
        let msgPayload;
        if (mediaUrl && (mediaUrl.toLowerCase().endsWith('.pdf') || mediaType === 'document')) {
          msgPayload = {
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'document',
            document: { link: mediaUrl, caption: personalizedText, filename: 'Project_Brochure.pdf' }
          };
        } else if (mediaUrl && (mediaUrl.toLowerCase().match(/\.(png|jpe?g|webp)$/i) || mediaType === 'image')) {
          msgPayload = {
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'image',
            image: { link: mediaUrl, caption: personalizedText }
          };
        } else {
          msgPayload = {
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'text',
            text: { body: personalizedText }
          };
        }

        const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(msgPayload)
        });
        if (response.ok) {
          const data = await response.json();
          if (data.messages?.[0]?.id) {
            messageId = data.messages[0].id;
            liveSent = true;
            deliveredVia = 'Meta WhatsApp Cloud API';
            status = 'provider_accepted';
          } else {
            status = 'failed';
            failureReason = 'NO_PROVIDER_ID';
          }
        } else {
          status = 'failed';
          failureReason = 'NO_PROVIDER_ID';
        }
      } catch (_) {
        status = 'failed';
        failureReason = 'NO_PROVIDER_ID';
      }
    }

    const record = {
      message_id: messageId,
      recipient: cleanPhone,
      recipient_name: lead.name || 'Lead',
      body: personalizedText,
      media_url: mediaUrl || null,
      provider: deliveredVia,
      live_sent: liveSent,
      status: liveSent ? 'provider_accepted' : status,
      failure_reason: failureReason,
      delivered_at: liveSent ? new Date().toISOString() : null,
      prepared_at: new Date().toISOString(),
      action_links: links
    };

    results.push(record);
  }

  const outbox = loadOutbox();
  outbox.push(...results);
  saveOutbox(outbox);

  return {
    receipt_id: `rcpt_wa_${randomUUID().slice(0, 12)}`,
    channel: 'WhatsApp',
    total_audience: audience.length,
    recipients_sent: results.filter(r => r.status === 'provider_accepted').length,
    deep_links_prepared: results.filter(r => r.status === 'deep_link_prepared_not_sent').length,
    media_url: mediaUrl || null,
    results,
    dispatched_at: new Date().toISOString()
  };
}

module.exports = {
  normalizePhoneNumber,
  personalizeWhatsAppCopy,
  generateWhatsAppDeepLink,
  dispatchWhatsAppCampaign,
  loadOutbox,
  NO_PROVIDER_ID: 'NO_PROVIDER_ID'
};
