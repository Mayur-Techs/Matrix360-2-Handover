'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { buildSmtpMessage } = require('../lib/m360-smtp-client');
const { renderComplianceFooter, renderPreamble, handleBrevoWebhookEvent, verifyDomainDnsReadiness, resetComplianceStateForTests } = require('../lib/m360-email-compliance');
const { isSuppressed, resetConsentStoreForTests } = require('../lib/m360-consent');
const marketingApi = require('../api/marketing');

describe('Stage 9: Email Compliance Footer & Gmail/Yahoo Bulk Sending Standards', () => {
  beforeEach(() => {
    resetComplianceStateForTests();
    resetConsentStoreForTests();
  });

  it('Sent email contains List-Unsubscribe, One-Click headers and compliance footer', () => {
    const config = {
      senderEmail: 'campaigns@matrix360.io',
      senderName: 'Lakhotia Commercial Hub',
      messageDomain: 'smtp.matrix360.io'
    };
    const message = {
      from: 'campaigns@matrix360.io',
      to: 'prospect@acmecorp.com',
      subject: 'Industrial Warehousing Availability - Lakhotia',
      text: 'Prime warehouse space now open for lease.',
      legalName: 'Lakhotia Industrial Park Private Limited',
      postalAddress: '101 Industrial Estate, NH-6, Howrah 711302, India'
    };

    const built = buildSmtpMessage(config, message);
    const data = built.data;

    // 1. Check RFC 8058 List-Unsubscribe headers
    assert.ok(data.includes('List-Unsubscribe: <https://matrix360.io/api/marketing/unsubscribe?email=prospect%40acmecorp.com>'), 'Contains https List-Unsubscribe');
    assert.ok(data.includes('mailto:unsubscribe@smtp.matrix360.io?subject=unsubscribe:prospect%40acmecorp.com'), 'Contains mailto List-Unsubscribe');
    assert.ok(data.includes('List-Unsubscribe-Post: List-Unsubscribe=One-Click'), 'Contains One-Click unsubscribe header');

    // 2. Check compliance footer in HTML and plain text
    assert.ok(data.includes('Lakhotia Industrial Park Private Limited'), 'Footer contains legal entity');
    assert.ok(data.includes('101 Industrial Estate, NH-6, Howrah 711302, India'), 'Footer contains physical address');
    assert.ok(data.includes('Unsubscribe'), 'Footer contains visible Unsubscribe text');
    assert.ok(data.includes('Privacy Policy'), 'Footer contains Privacy Policy link');
    assert.ok(data.includes('Terms'), 'Footer contains Terms link');
  });

  it('One-click unsubscribe endpoint suppresses recipient without requiring authentication', async () => {
    const emailToUnsub = 'lead-optout-' + randomUUID().slice(0, 8) + '@example.com';
    const wsId = 'ws-' + randomUUID();

    assert.equal(isSuppressed(wsId, emailToUnsub), false, 'Not suppressed before request');

    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(data) {
        try { this.data = JSON.parse(data); } catch { this.data = data; }
      }
    };

    // Note: No Authorization header provided!
    await marketingApi({
      method: 'POST',
      url: '/api/marketing/unsubscribe',
      headers: {},
      body: { email: emailToUnsub, workspace_id: wsId },
      query: {}
    }, res);

    assert.equal(res.statusCode, 200, 'Unsubscribe endpoint returns 200 without auth');
    assert.equal(res.data.status, 'unsubscribed');
    assert.equal(isSuppressed(wsId, emailToUnsub), true, 'Recipient is now suppressed in consent store');
  });

  it('Brevo bounce webhook suppresses immediately on hard bounce and spam complaint', async () => {
    const hardBounceEmail = 'bounce-' + randomUUID().slice(0, 8) + '@invalid-domain.xyz';
    const wsId = 'ws-' + randomUUID();

    // 1. Hard bounce event
    const bounceRes = await handleBrevoWebhookEvent({
      event: 'hard_bounce',
      email: hardBounceEmail,
      workspace_id: wsId
    });
    assert.equal(bounceRes.processed, true);
    assert.equal(bounceRes.action, 'suppressed_immediate');
    assert.equal(isSuppressed(wsId, hardBounceEmail), true, 'Hard bounce email is immediately suppressed');

    // 2. Spam complaint event
    const complaintEmail = 'complaint-' + randomUUID().slice(0, 8) + '@user.com';
    const complaintRes = await handleBrevoWebhookEvent({
      event: 'complaint',
      email: complaintEmail,
      workspace_id: wsId
    });
    assert.equal(complaintRes.processed, true);
    assert.equal(complaintRes.action, 'suppressed_immediate');
    assert.equal(isSuppressed(wsId, complaintEmail), true, 'Complaint email is immediately suppressed');
  });

  it('Brevo soft bounce suppresses after threshold of 3 occurrences', async () => {
    const softEmail = 'softbounce-' + randomUUID().slice(0, 8) + '@temporary.org';
    const wsId = 'ws-' + randomUUID();

    // Pass 1: soft bounce recorded, not yet suppressed
    const r1 = await handleBrevoWebhookEvent({ event: 'soft_bounce', email: softEmail, workspace_id: wsId });
    assert.equal(r1.action, 'soft_bounce_recorded');
    assert.equal(r1.count, 1);
    assert.equal(isSuppressed(wsId, softEmail), false);

    // Pass 2: count 2
    const r2 = await handleBrevoWebhookEvent({ event: 'soft_bounce', email: softEmail, workspace_id: wsId });
    assert.equal(r2.count, 2);
    assert.equal(isSuppressed(wsId, softEmail), false);

    // Pass 3: threshold 3 reached -> suppressed
    const r3 = await handleBrevoWebhookEvent({ event: 'soft_bounce', email: softEmail, workspace_id: wsId });
    assert.equal(r3.action, 'suppressed_soft_bounce_threshold');
    assert.equal(r3.count, 3);
    assert.equal(isSuppressed(wsId, softEmail), true);
  });

  it('Domain DNS readiness check validates SPF, DKIM, and DMARC alignment', async () => {
    // Valid domain check structure
    const check = await verifyDomainDnsReadiness('google.com');
    assert.equal(typeof check.spf, 'boolean');
    assert.equal(typeof check.dmarc, 'boolean');
    assert.equal(typeof check.bulkSendingAllowed, 'boolean');
    assert.equal(check.domain, 'google.com');

    // Invalid domain fails closed
    const invalidCheck = await verifyDomainDnsReadiness('not-a-valid-domain');
    assert.equal(invalidCheck.bulkSendingAllowed, false);
    assert.equal(invalidCheck.reason, 'INVALID_DOMAIN');
  });
});
