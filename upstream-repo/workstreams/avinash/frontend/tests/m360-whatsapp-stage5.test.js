'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Required AES-256-GCM tenant encryption key for tests
process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.WHATSAPP_APP_SECRET = 'test-secret-stage5';
process.env.META_GRAPH_VERSION = 'v21.0';

const {
  saveWhatsAppOnboardingRecord,
  clearWhatsAppOnboardingStore,
  previewWhatsAppBroadcast,
  getWhatsAppCampaignResults,
  recordWhatsAppCampaignDeliveryEvent
} = require('../lib/m360-whatsapp-onboarding');

const {
  recordConsent,
  recordSuppression,
  resetConsentStoreForTests
} = require('../lib/m360-consent');

test('Stage 5: AiSensy-Style Broadcast Builder & Results View', async (t) => {
  const wsId = 'ws-test-s5-' + Date.now();
  clearWhatsAppOnboardingStore();
  resetConsentStoreForTests();

  t.after(() => {
    clearWhatsAppOnboardingStore();
    resetConsentStoreForTests();
  });

  // Setup ready_limited workspace with approved template
  saveWhatsAppOnboardingRecord(wsId, {
    state: 'ready_limited',
    waba_id: 'waba-s5',
    phone_number_id: 'phone-s5',
    templates: [
      {
        name: 'm360_site_visit_invitation',
        status: 'APPROVED',
        category: 'MARKETING',
        components: [
          {
            type: 'BODY',
            text: 'Hello {{1}}, thank you for your interest in {{2}}. Reply YES to schedule a tour.'
          }
        ]
      },
      {
        name: 'm360_unapproved_sample',
        status: 'PENDING',
        category: 'MARKETING'
      }
    ]
  });

  // Register explicit consent for 2 contacts
  recordConsent(wsId, { contact_id: 'c1', channel: 'whatsapp', status: 'granted' });
  recordConsent(wsId, { contact_id: 'c2', channel: 'whatsapp', status: 'granted' });
  // c3 has no consent
  // c4 has consent but is suppressed
  recordConsent(wsId, { contact_id: 'c4', channel: 'whatsapp', status: 'granted' });
  recordSuppression(wsId, { channel: 'whatsapp', phone: '+919876540004' });

  const contacts = [
    { id: 'c1', name: 'Raj', phone: '+919876540001', tags: ['vip', 'luxury'] },
    { id: 'c2', name: 'Simran', phone: '+919876540002', tags: ['vip'] },
    { id: 'c3', name: 'Amit', phone: '+919876540003', tags: ['vip'] }, // Missing consent
    { id: 'c4', name: 'Pooja', phone: '+919876540004', tags: ['vip'] }, // Suppressed
    { id: 'c5', name: 'Vikram', phone: 'invalid', tags: ['vip'] }       // Invalid phone
  ];

  await t.test('Broadcast preview rejects non-approved template', () => {
    const res = previewWhatsAppBroadcast({
      workspaceId: wsId,
      templateName: 'm360_unapproved_sample',
      contacts
    });
    assert.equal(res.success, false);
    assert.equal(res.code, 'TEMPLATE_NOT_APPROVED');
  });

  await t.test('Broadcast preview filters eligible audience and calculates Meta rates', () => {
    const res = previewWhatsAppBroadcast({
      workspaceId: wsId,
      templateName: 'm360_site_visit_invitation',
      templateVariables: ['Rajesh', 'Sobha Windfall'],
      tagFilter: 'vip',
      contacts
    });

    assert.equal(res.success, true);
    assert.equal(res.template.name, 'm360_site_visit_invitation');
    assert.equal(res.template.status, 'APPROVED');

    // Variable substitution in preview
    assert.ok(res.sample_preview.includes('Hello Rajesh'));
    assert.ok(res.sample_preview.includes('interest in Sobha Windfall'));

    // Audience filtering
    assert.equal(res.audience.total, 5);
    assert.equal(res.audience.eligible_count, 2, 'Only c1 and c2 have granted consent, valid phone, and no suppression');
    assert.equal(res.audience.excluded_count, 3);
    assert.equal(res.audience.excluded_breakdown.missing_consent, 1); // c3
    assert.equal(res.audience.excluded_breakdown.suppressed_or_opted_out, 1); // c4
    assert.equal(res.audience.excluded_breakdown.invalid_phone, 1); // c5

    // Cost estimate
    assert.equal(res.cost_estimate.currency, 'INR');
    assert.equal(res.cost_estimate.recipient_count, 2);
    assert.equal(res.cost_estimate.meta_base_rate_inr, 0.8631);
    assert.equal(res.cost_estimate.gst_pct, 18);
    assert.equal(res.cost_estimate.meta_fee_per_message_inr, 1.0185);
    assert.equal(res.cost_estimate.matrix360_fee_per_message_inr, 0.0);
    assert.equal(res.cost_estimate.total_estimated_cost_inr, 2.037);
  });

  await t.test('Campaign results returns real events only, never fabricated metrics', () => {
    const corrId = 'corr-broadcast-res-01';

    // 1. Initial empty state returns 0 metrics, no invented data
    const emptyRes = getWhatsAppCampaignResults(wsId, corrId);
    assert.equal(emptyRes.delivered, 0);
    assert.equal(emptyRes.read, 0);
    assert.equal(emptyRes.failed, 0);
    assert.equal(emptyRes.opted_out, 0);
    assert.equal(emptyRes.events.length, 0);

    // 2. Real webhook event recorded
    recordWhatsAppCampaignDeliveryEvent(wsId, corrId, {
      messageId: 'wamid.bc_1',
      status: 'delivered',
      recipientId: '919876540001'
    });
    recordWhatsAppCampaignDeliveryEvent(wsId, corrId, {
      messageId: 'wamid.bc_1',
      status: 'read',
      recipientId: '919876540001'
    });
    recordWhatsAppCampaignDeliveryEvent(wsId, corrId, {
      messageId: 'wamid.bc_2',
      status: 'opted_out',
      recipientId: '919876540002'
    });

    const activeRes = getWhatsAppCampaignResults(wsId, corrId);
    assert.equal(activeRes.delivered, 1);
    assert.equal(activeRes.read, 1);
    assert.equal(activeRes.opted_out, 1);
    assert.equal(activeRes.events.length, 3);
  });
});
