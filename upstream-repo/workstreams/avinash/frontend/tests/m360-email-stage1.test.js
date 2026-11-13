'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EMAIL_ONBOARDING_STATES,
  getEmailOnboardingRecord,
  saveEmailOnboardingRecord,
  clearEmailOnboardingStore,
  transitionEmailOnboarding
} = require('../lib/m360-email-onboarding');

test('Stage 1: Email Sender Onboarding State Machine', async (t) => {
  const wsId = 'ws-email-s1-' + Date.now();
  clearEmailOnboardingStore();

  t.after(() => {
    clearEmailOnboardingStore();
  });

  await t.test('Initial state is not_started', () => {
    const rec = getEmailOnboardingRecord(wsId);
    assert.equal(rec.state, 'not_started');
    assert.equal(rec.sender_domain, null);
    assert.equal(rec.spf_ok, false);
    assert.equal(rec.dkim_ok, false);
    assert.equal(rec.dmarc_ok, false);
    assert.equal(rec.test_delivery_confirmed_at, null);
  });

  await t.test('Unknown action leaves state unchanged', () => {
    const res = transitionEmailOnboarding(wsId, 'unknown_action', { foo: 'bar' });
    assert.equal(res.state, 'not_started');
  });

  await t.test('Missing triggering fact leaves state unchanged', () => {
    // submit_domain with invalid/empty domain
    const res1 = transitionEmailOnboarding(wsId, 'submit_domain', { sender_domain: '' });
    assert.equal(res1.state, 'not_started');

    const res2 = transitionEmailOnboarding(wsId, 'submit_domain', { sender_domain: 'nodotdomain' });
    assert.equal(res2.state, 'not_started');
  });

  await t.test('submit_domain with valid domain transitions to domain_pending', () => {
    const res = transitionEmailOnboarding(wsId, 'submit_domain', {
      sender_domain: 'lakhotia.example.com',
      from_address: 'outreach@lakhotia.example.com',
      from_name: 'Lakhotia Industrial'
    });
    assert.equal(res.state, 'domain_pending');
    assert.equal(res.sender_domain, 'lakhotia.example.com');
    assert.equal(res.from_address, 'outreach@lakhotia.example.com');
    assert.equal(res.from_name, 'Lakhotia Industrial');
  });

  await t.test('start_dns_check transitions to dns_verifying', () => {
    const res = transitionEmailOnboarding(wsId, 'start_dns_check');
    assert.equal(res.state, 'dns_verifying');
  });

  await t.test('dns_check_complete with failing records transitions to needs_attention', () => {
    const res = transitionEmailOnboarding(wsId, 'dns_check_complete', {
      spf_ok: true,
      dkim_ok: false,
      dmarc_ok: false
    });
    assert.equal(res.state, 'needs_attention');
    assert.equal(res.spf_ok, true);
    assert.equal(res.dkim_ok, false);
    assert.equal(res.dmarc_ok, false);
    assert.ok(res.last_provider_error);
  });

  await t.test('dns_check_complete with passing records without test delivery stays in dns_verifying', () => {
    const res = transitionEmailOnboarding(wsId, 'dns_check_complete', {
      spf_ok: true,
      dkim_ok: true,
      dmarc_ok: true
    });
    // Passing DNS alone does NOT turn state to ready_limited without confirmed test delivery!
    assert.equal(res.state, 'dns_verifying');
    assert.equal(res.spf_ok, true);
    assert.equal(res.dkim_ok, true);
    assert.equal(res.dmarc_ok, true);
  });

  await t.test('test_email_sent sets test_message_id without changing state', () => {
    const res = transitionEmailOnboarding(wsId, 'test_email_sent', {
      test_message_id: 'brevo_msg_test_123',
      recipient: 'owner@lakhotia.example.com'
    });
    assert.equal(res.state, 'dns_verifying');
    assert.equal(res.test_message_id, 'brevo_msg_test_123');
    assert.equal(res.test_delivery_confirmed_at, null);
  });

  await t.test('test_delivery_confirmed with mismatched message ID leaves state unconfirmed', () => {
    const res = transitionEmailOnboarding(wsId, 'test_delivery_confirmed', {
      message_id: 'unrelated_msg_999',
      confirmed_at: new Date().toISOString()
    });
    assert.equal(res.state, 'dns_verifying');
    assert.equal(res.test_delivery_confirmed_at, null);
  });

  await t.test('test_delivery_confirmed with matching message ID transitions to ready_limited', () => {
    const confirmedTime = new Date().toISOString();
    const res = transitionEmailOnboarding(wsId, 'test_delivery_confirmed', {
      message_id: 'brevo_msg_test_123',
      confirmed_at: confirmedTime
    });
    assert.equal(res.state, 'ready_limited');
    assert.equal(res.test_delivery_confirmed_at, confirmedTime);
  });

  await t.test('provider_verified transitions ready_limited to verified', () => {
    const res = transitionEmailOnboarding(wsId, 'provider_verified', {
      verified: true
    });
    assert.equal(res.state, 'verified');
  });

  await t.test('provider_bounce_or_complaint with critical/paused transitions to needs_attention', () => {
    const res = transitionEmailOnboarding(wsId, 'provider_bounce_or_complaint', {
      paused: true,
      error: { message: 'Complaint rate exceeded 0.3%' }
    });
    assert.equal(res.state, 'needs_attention');
    assert.equal(res.last_provider_error.message, 'Complaint rate exceeded 0.3%');
  });
});
