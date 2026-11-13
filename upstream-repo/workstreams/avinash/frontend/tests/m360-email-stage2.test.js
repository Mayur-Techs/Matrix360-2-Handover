'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  checkDomainDnsRecords,
  previewEmailBroadcast,
  saveEmailOnboardingRecord,
  clearEmailOnboardingStore
} = require('../lib/m360-email-onboarding');

test('Stage 2: Domain Authentication (SPF / DKIM / DMARC) Real Checks & Gating', async (t) => {
  const wsId = 'ws-email-s2-' + Date.now();
  clearEmailOnboardingStore();

  t.after(() => {
    clearEmailOnboardingStore();
  });

  await t.test('Domain with no DKIM shows dkim_ok: false and exact record to add', async () => {
    // Mock resolver where SPF passes, DMARC passes, but DKIM is missing
    const mockResolver = {
      resolveTxt: async (hostname) => {
        if (hostname === 'client-test.com') {
          return [['v=spf1 include:spf.brevo.com ~all']];
        }
        if (hostname === '_dmarc.client-test.com') {
          return [['v=DMARC1; p=none; rua=mailto:dmarc@client-test.com']];
        }
        if (hostname.includes('_domainkey')) {
          // No DKIM record configured
          const err = new Error('ENOTFOUND');
          err.code = 'ENOTFOUND';
          throw err;
        }
        return [];
      }
    };

    const res = await checkDomainDnsRecords({
      domain: 'client-test.com',
      dnsResolver: mockResolver
    });

    assert.equal(res.domain, 'client-test.com');
    assert.equal(res.spf_ok, true);
    assert.equal(res.dmarc_ok, true);
    assert.equal(res.dkim_ok, false, 'DKIM must be false when record is missing');
    assert.equal(res.bulk_sending_allowed, false, 'Bulk sending must be false when DKIM is unaligned');

    // Exact record to add for DKIM
    assert.equal(res.records.dkim.status, 'MISSING');
    assert.equal(res.records.dkim.host, 'mail._domainkey');
    assert.equal(res.records.dkim.type, 'TXT');
    assert.ok(res.records.dkim.value.includes('k=rsa;'));

    // Plain English status
    assert.ok(res.plain_english_status.dkim.includes('DKIM missing'));
    assert.ok(res.plain_english_status.bulk_gating.includes('BLOCKED'));
  });

  await t.test('Bulk sending (>5,000) is blocked when alignment fails', () => {
    saveEmailOnboardingRecord(wsId, {
      sender_domain: 'unaligned.example.com',
      spf_ok: true,
      dkim_ok: false, // Unaligned
      dmarc_ok: true,
      state: 'ready_limited'
    });

    // 5,001 contacts
    const largeAudience = Array.from({ length: 5001 }, (_, i) => ({
      id: `contact_${i}`,
      email: `lead_${i}@example.com`
    }));

    const previewRes = previewEmailBroadcast({
      workspaceId: wsId,
      templateSubject: 'Bulk Announcement',
      templateBody: 'Special opportunity',
      contacts: largeAudience
    });

    assert.equal(previewRes.success, false);
    assert.equal(previewRes.code, 'BULK_SEND_BLOCKED_UNALIGNED_DOMAIN');
    assert.ok(previewRes.message.includes('blocked'));
  });

  await t.test('Domain with all passing records permits bulk sending', async () => {
    const mockAlignedResolver = {
      resolveTxt: async (hostname) => {
        if (hostname === 'aligned.example.com') {
          return [['v=spf1 include:spf.brevo.com ~all']];
        }
        if (hostname === '_dmarc.aligned.example.com') {
          return [['v=DMARC1; p=reject']];
        }
        if (hostname.includes('_domainkey')) {
          return [['v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDeMVIigNm5+fFQbMQ0GsG0YM456wIDAQAB']];
        }
        return [];
      }
    };

    const res = await checkDomainDnsRecords({
      domain: 'aligned.example.com',
      dnsResolver: mockAlignedResolver
    });

    assert.equal(res.spf_ok, true);
    assert.equal(res.dkim_ok, true);
    assert.equal(res.dmarc_ok, true);
    assert.equal(res.aligned, true);
    assert.equal(res.bulk_sending_allowed, true);
    assert.ok(res.plain_english_status.bulk_gating.includes('permitted'));
  });
});
