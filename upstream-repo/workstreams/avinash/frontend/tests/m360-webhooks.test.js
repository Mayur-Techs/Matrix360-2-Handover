'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const marketingApi = require('../api/marketing');
const orchestrator = require('../lib/m360-marketing-orchestrator');
const consentEngine = require('../lib/m360-consent');

function mockHttp(method, path, body = {}, auth = 'Bearer test-session-token-hardening-123', rawBody = null) {
  const parsedUrl = new URL(path, 'http://127.0.0.1');
  const query = Object.fromEntries(parsedUrl.searchParams);
  const req = {
    method,
    url: path,
    query,
    headers: { authorization: auth, 'content-type': 'application/json' },
    body,
    rawBody: rawBody || (typeof body === 'string' ? body : JSON.stringify(body))
  };

  let resData = null;
  const res = {
    statusCode: 200,
    setHeader() {},
    end(data) {
      if (typeof data === 'string') {
        try { resData = JSON.parse(data); } catch { resData = data; }
      }
    }
  };

  return {
    req,
    res,
    get() {
      return { status: res.statusCode, data: resData };
    }
  };
}

describe('Stage 6 (X1, R1, S1): Raw HMAC Webhooks & Multilingual Suppression', () => {
  const appSecret = 'test_webhook_app_secret_12345';
  process.env.WHATSAPP_APP_SECRET = appSecret;

  it('X1: A signed raw payload with unicode escape sequences (\\u0020) verifies successfully (not 401)', async () => {
    // Construct raw JSON containing literal \u0020 escape
    const rawPayloadString = '{"object":"whatsapp_business_account","entry":[{"id":"waba-x1","changes":[{"value":{"messaging_product":"whatsapp","metadata":{"phone_number_id":"pn-x1-test"},"messages":[{"from":"919830012345","id":"wamid.test.1","text":{"body":"stop\\u0020now"},"type":"text"}]},"field":"messages"}]}]}';
    const rawBuffer = Buffer.from(rawPayloadString, 'utf8');
    const signature = 'sha256=' + createHmac('sha256', appSecret).update(rawBuffer).digest('hex');

    const mock = mockHttp('POST', '/api/marketing/webhooks/whatsapp', JSON.parse(rawPayloadString), 'Bearer token', rawBuffer);
    mock.req.headers['x-hub-signature-256'] = signature;

    await marketingApi(mock.req, mock.res);

    assert.equal(mock.get().status, 200, 'Raw payload with unicode escapes must verify successfully');
    assert.equal(mock.get().data.status, 'processed');
  });

  it('R1: A STOP for tenant A never changes tenant B contacts or tasks', async () => {
    const wsA = randomUUID();
    const wsB = randomUUID();
    const phoneIdA = 'phone-id-tenant-a-' + Date.now();
    const phoneIdB = 'phone-id-tenant-b-' + Date.now();

    // Register WhatsApp credentials for workspace A and B
    orchestrator.configureMarketingProvider(wsA, 'whatsapp', {
      token: 'token_a',
      phoneNumberId: phoneIdA
    });
    orchestrator.configureMarketingProvider(wsB, 'whatsapp', {
      token: 'token_b',
      phoneNumberId: phoneIdB
    });

    // Create tasks for both tenants with identical contact phone numbers
    const envA = orchestrator.createHandoverEnvelope({
      workspace_id: wsA,
      correlation_id: randomUUID(),
      business_profile_ref: 'lakhotia',
      requested_outcome: 'qualified_enquiries',
      payload: { business_name: 'Tenant A Industrial', project: 'lakhotia' }
    });
    const taskA = await orchestrator.dispatchMarketingTask(envA, {
      waitForDraft: true,
      keylessTestMode: true,
      creativePlan: { verified_content_task_id: randomUUID(), status: 'completed', test_data: true, artifact_refs: [{ id: 'a1', kind: 'image' }] }
    });

    const envB = orchestrator.createHandoverEnvelope({
      workspace_id: wsB,
      correlation_id: randomUUID(),
      business_profile_ref: 'lakhotia',
      requested_outcome: 'qualified_enquiries',
      payload: { business_name: 'Tenant B Industrial', project: 'lakhotia' }
    });
    const taskB = await orchestrator.dispatchMarketingTask(envB, {
      waitForDraft: true,
      keylessTestMode: true,
      creativePlan: { verified_content_task_id: randomUUID(), status: 'completed', test_data: true, artifact_refs: [{ id: 'b1', kind: 'image' }] }
    });

    const sharedPhone = '+919830055555';
    orchestrator.importLeadsToTask(wsA, taskA.correlation_id, [
      { id: 'lead-a-1', name: 'Lead in A', phone: sharedPhone, whatsapp_opt_in_status: 'granted', consent_evidence: { whatsapp: true, source: 'test' } }
    ]);
    orchestrator.importLeadsToTask(wsB, taskB.correlation_id, [
      { id: 'lead-b-1', name: 'Lead in B', phone: sharedPhone, whatsapp_opt_in_status: 'granted', consent_evidence: { whatsapp: true, source: 'test' } }
    ]);

    // Send STOP webhook specifically to tenant A's phone_number_id
    const stopPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-r1',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: phoneIdA },
            messages: [{
              from: '919830055555',
              id: 'wamid.stop.tenant.a',
              text: { body: 'STOP' },
              type: 'text'
            }]
          },
          field: 'messages'
        }]
      }]
    };

    const rawStr = JSON.stringify(stopPayload);
    const signature = 'sha256=' + createHmac('sha256', appSecret).update(Buffer.from(rawStr, 'utf8')).digest('hex');
    const mock = mockHttp('POST', '/api/marketing/webhooks/whatsapp', stopPayload, 'Bearer token', Buffer.from(rawStr, 'utf8'));
    mock.req.headers['x-hub-signature-256'] = signature;

    await marketingApi(mock.req, mock.res);
    assert.equal(mock.get().status, 200);

    // Verify Tenant A contact is suppressed and revoked
    const updatedTaskA = orchestrator.getMarketingTask(wsA, taskA.correlation_id);
    const contactA = updatedTaskA.audience_snapshot.contacts.find(c => c.id === 'lead-a-1');
    assert.equal(contactA.suppressed, true, 'Tenant A contact must be suppressed');
    assert.equal(contactA.whatsapp_opt_in_status, 'revoked', 'Tenant A opt in must be revoked');

    // Verify Tenant B contact is UNTOUCHED
    const updatedTaskB = orchestrator.getMarketingTask(wsB, taskB.correlation_id);
    const contactB = updatedTaskB.audience_snapshot.contacts.find(c => c.id === 'lead-b-1');
    assert.equal(contactB.suppressed, false, 'Tenant B contact must NOT be suppressed');
    assert.equal(contactB.whatsapp_opt_in_status, 'granted', 'Tenant B opt in must remain granted');
  });

  it('S1: Hindi and Bengali STOP keywords write suppression records and revoke WhatsApp status', async () => {
    const ws = randomUUID();
    const phoneId = 'phone-s1-' + Date.now();
    orchestrator.configureMarketingProvider(ws, 'whatsapp', {
      token: 'token_s1',
      phoneNumberId: phoneId
    });

    const env = orchestrator.createHandoverEnvelope({
      workspace_id: ws,
      correlation_id: randomUUID(),
      business_profile_ref: 'lakhotia',
      requested_outcome: 'qualified_enquiries',
      payload: { business_name: 'Lakhotia Industrial Park', project: 'lakhotia' }
    });
    const task = await orchestrator.dispatchMarketingTask(env, {
      waitForDraft: true,
      keylessTestMode: true,
      creativePlan: { verified_content_task_id: randomUUID(), status: 'completed', test_data: true, artifact_refs: [{ id: 's1', kind: 'image' }] }
    });

    // 1. Test Hindi STOP: 'बंद करो'
    const hindiPhone = '+919830011111';
    orchestrator.importLeadsToTask(ws, task.correlation_id, [
      { id: 'lead-hindi', name: 'Hindi Speaker', phone: hindiPhone, whatsapp_opt_in_status: 'granted', consent_evidence: { whatsapp: true, source: 'test' } },
      { id: 'lead-bengali', name: 'Bengali Speaker', phone: '+919830022222', whatsapp_opt_in_status: 'granted', consent_evidence: { whatsapp: true, source: 'test' } }
    ]);

    const hindiPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-s1',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: phoneId },
            messages: [{
              from: '919830011111',
              id: 'wamid.hindi.1',
              text: { body: 'कृपया बंद करो' },
              type: 'text'
            }]
          },
          field: 'messages'
        }]
      }]
    };
    const hindiRaw = JSON.stringify(hindiPayload);
    const hindiSig = 'sha256=' + createHmac('sha256', appSecret).update(Buffer.from(hindiRaw, 'utf8')).digest('hex');
    const hindiReq = mockHttp('POST', '/api/marketing/webhooks/whatsapp', hindiPayload, 'Bearer token', Buffer.from(hindiRaw, 'utf8'));
    hindiReq.req.headers['x-hub-signature-256'] = hindiSig;
    await marketingApi(hindiReq.req, hindiReq.res);

    const taskAfterHindi = orchestrator.getMarketingTask(ws, task.correlation_id);
    const hindiContact = taskAfterHindi.audience_snapshot.contacts.find(c => c.id === 'lead-hindi');
    assert.equal(hindiContact.suppressed, true, 'Hindi बंद करो must suppress the contact');
    assert.equal(hindiContact.whatsapp_opt_in_status, 'revoked');

    // 2. Test Bengali STOP: 'বন্ধ করুন'
    const bengaliPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-s1-b',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: phoneId },
            messages: [{
              from: '919830022222',
              id: 'wamid.bengali.1',
              text: { body: 'বার্তা বন্ধ করুন' },
              type: 'text'
            }]
          },
          field: 'messages'
        }]
      }]
    };
    const bengaliRaw = JSON.stringify(bengaliPayload);
    const bengaliSig = 'sha256=' + createHmac('sha256', appSecret).update(Buffer.from(bengaliRaw, 'utf8')).digest('hex');
    const bengaliReq = mockHttp('POST', '/api/marketing/webhooks/whatsapp', bengaliPayload, 'Bearer token', Buffer.from(bengaliRaw, 'utf8'));
    bengaliReq.req.headers['x-hub-signature-256'] = bengaliSig;
    await marketingApi(bengaliReq.req, bengaliReq.res);

    const taskAfterBengali = orchestrator.getMarketingTask(ws, task.correlation_id);
    const bengaliContact = taskAfterBengali.audience_snapshot.contacts.find(c => c.id === 'lead-bengali');
    assert.equal(bengaliContact.suppressed, true, 'Bengali বন্ধ করুন must suppress the contact');
    assert.equal(bengaliContact.whatsapp_opt_in_status, 'revoked');
  });
});
