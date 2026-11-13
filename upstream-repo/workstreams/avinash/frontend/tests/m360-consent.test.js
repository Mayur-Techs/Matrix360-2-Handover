'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const orchestrator = require('../lib/m360-marketing-orchestrator');
const { isEligible, isValidIdentifier, hasGrantedConsent, isSuppressed } = require('../lib/m360-consent');

describe('Stage 2 (C2): Consent and Suppression as Data', () => {
  it('A JSON lead with only email+phone has unknown consent and empty evidence', async () => {
    const envelope = orchestrator.createHandoverEnvelope({
      workspace_id: 'ws-c2-test',
      correlation_id: randomUUID(),
      business_profile_ref: 'lakhotia',
      requested_outcome: 'qualified_enquiries'
    });
    const task = await orchestrator.dispatchMarketingTask(envelope);

    orchestrator.importLeadsToTask(task.workspace_id, task.correlation_id, [
      { name: 'Raw Ingested Lead', email: 'prospect@acme.com', phone: '+919830012345' }
    ]);

    const updated = orchestrator.getMarketingTask(task.workspace_id, task.correlation_id);
    const contact = updated.audience_snapshot.contacts[0];

    assert.equal(contact.email_opt_in_status, 'unknown', 'Email consent must default to unknown');
    assert.equal(contact.whatsapp_opt_in_status, 'unknown', 'WhatsApp consent must default to unknown');
    assert.deepEqual(contact.consent_evidence, {}, 'Consent evidence must default to empty object');
  });

  it('Caller cannot assert granted consent without evidence source (C2 hardening)', async () => {
    const envelope = orchestrator.createHandoverEnvelope({
      workspace_id: 'ws-c2-harden',
      correlation_id: randomUUID(),
      business_profile_ref: 'lakhotia',
      requested_outcome: 'qualified_enquiries'
    });
    const task = await orchestrator.dispatchMarketingTask(envelope, { waitForDraft: true, keylessTestMode: true });

    orchestrator.importLeadsToTask(task.workspace_id, task.correlation_id, [
      {
        name: 'Asserted Without Source',
        email: 'asserted@example.com',
        phone: '+919830012345',
        email_opt_in_status: 'granted',
        whatsapp_opt_in_status: 'granted'
      }
    ]);

    const updated = orchestrator.getMarketingTask(task.workspace_id, task.correlation_id);
    const contact = updated.audience_snapshot.contacts[0];

    // Must be downgraded to unknown
    assert.equal(contact.email_opt_in_status, 'unknown', 'Email consent must be stored as unknown when source is missing');
    assert.equal(contact.whatsapp_opt_in_status, 'unknown', 'WhatsApp consent must be stored as unknown when source is missing');
    assert.equal(contact.consent_status, 'unknown', 'Overall consent must be stored as unknown');
    assert.ok(contact.consent_warnings && contact.consent_warnings.length > 0, 'Consent warning must be recorded for contact');
    assert.ok(!contact.consent_evidence?.email, 'consent_evidence.email must not be true');
    assert.ok(!contact.consent_evidence?.whatsapp, 'consent_evidence.whatsapp must not be true');

    // Contact must be ineligible on every channel
    assert.equal(isEligible(contact, 'email'), false, 'Ineligible for email');
    assert.equal(isEligible(contact, 'whatsapp'), false, 'Ineligible for whatsapp');
    assert.equal(isEligible(contact, 'sms'), false, 'Ineligible for sms');

    // And task channel readiness gate2 must fail (0 eligible)
    if (updated.channel_readiness?.Email) {
      assert.equal(updated.channel_readiness.Email.gates.gate2_audience.eligible_count, 0);
      assert.equal(updated.channel_readiness.Email.gates.gate2_audience.passed, false);
    }
  });

  it('A contact with only email+phone is ineligible on every channel', () => {
    const contact = {
      id: 'contact-c2-1',
      name: 'Unconsented Lead',
      email: 'test@example.com',
      phone: '+919830012345',
      email_opt_in_status: 'unknown',
      whatsapp_opt_in_status: 'unknown',
      consent_evidence: {}
    };

    assert.equal(isEligible(contact, 'email'), false, 'Ineligible for email without explicit consent');
    assert.equal(isEligible(contact, 'whatsapp'), false, 'Ineligible for whatsapp without explicit consent');
    assert.equal(isEligible(contact, 'sms'), false, 'Ineligible for sms without explicit consent');
  });

  it('Consent becomes eligible ONLY with a granted consent row containing source, timestamp, and wording', () => {
    const contact = {
      id: 'contact-c2-2',
      name: 'Opted In Lead',
      email: 'verified@enterprise.com',
      phone: '+919830012345'
    };

    const consentRow = {
      id: 'consent-row-1',
      workspace_id: 'ws-c2-test',
      contact_id: 'contact-c2-2',
      channel: 'email',
      status: 'granted',
      source: 'web_form_inbound',
      captured_at: new Date().toISOString(),
      wording_version: 'v1.0',
      business_name: 'Lakhotia Industrial Complex'
    };

    // When consent row is provided
    assert.equal(isEligible(contact, 'email', { consents: [consentRow] }), true, 'Must be eligible with valid consent row');

    // But still ineligible on WhatsApp
    assert.equal(isEligible(contact, 'whatsapp', { consents: [consentRow] }), false, 'Consent for email does not grant WhatsApp');
  });

  it('A suppressed contact is ineligible even with granted consent', () => {
    const contact = {
      id: 'contact-c2-3',
      name: 'Opted Out User',
      email: 'stop@enterprise.com',
      phone: '+919830099999'
    };

    const consentRow = {
      contact_id: 'contact-c2-3',
      channel: 'email',
      status: 'granted',
      source: 'web_form'
    };

    const suppressionRow = {
      workspace_id: 'ws-c2-test',
      channel: 'email',
      value_normalized: 'stop@enterprise.com',
      reason: 'user_unsubscribe'
    };

    assert.equal(isEligible(contact, 'email', { consents: [consentRow], suppressions: [suppressionRow] }), false, 'Suppression must block sending');
  });

  it('Cross-channel suppression blocks all channels', () => {
    const contact = {
      id: 'contact-c2-4',
      name: 'Global Opt Out',
      email: 'global@enterprise.com',
      phone: '+919830088888',
      email_opt_in_status: 'granted',
      whatsapp_opt_in_status: 'granted',
      consent_evidence: { source: 'form', timestamp: new Date().toISOString() }
    };

    const globalSuppression = {
      workspace_id: 'ws-c2-test',
      channel: 'all',
      value_normalized: 'global@enterprise.com',
      reason: 'STOP_ALL'
    };

    assert.equal(isEligible(contact, 'email', { suppressions: [globalSuppression] }), false);
  });
});
