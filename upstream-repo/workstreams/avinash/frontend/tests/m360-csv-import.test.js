'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { importCsv, normalizePhoneNumber } = require('../lib/m360-csv-import.js');
const marketingApi = require('../api/marketing.js');
const orchestrator = require('../lib/m360-marketing-orchestrator.js');

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

const memberships = [
  { id: 'ws-api-csv-test', name: 'CSV API Test', role: 'client_admin', profile_type: 'b2b_industrial', project_slug: 'lakhotia' }
];

const originalFetch = global.fetch;
function installCrmFetch() {
  global.fetch = async url => {
    if (String(url).endsWith('/me/workspaces')) return { status: 200, ok: true, json: async () => memberships };
    return { status: 200, ok: true, json: async () => ({}) };
  };
}

function mockHttp(method, path, body = {}, auth = 'Bearer test-session-token-long-enough-123') {
  let statusCode = 200;
  let responseData = null;
  const headers = {};
  return {
    req: {
      method,
      url: path,
      headers: { host: 'localhost:3000', 'content-type': 'application/json', authorization: auth },
      body
    },
    res: {
      setHeader(k, v) { headers[k] = v; },
      writeHead(code, h = {}) { statusCode = code; Object.assign(headers, h); },
      statusCode: 200,
      end(chunk) {
        if (chunk) {
          try { responseData = JSON.parse(chunk); } catch { responseData = chunk; }
        }
      }
    },
    get() {
      return { status: this.res.statusCode !== 200 ? this.res.statusCode : statusCode, data: responseData, headers };
    }
  };
}

test('Stage 3 (C1): Header aliases and column mapping', () => {
  const csvContent = [
    'Full Name,Mobile No.,Mail,Company',
    'Rajesh Verma,09830012345,rajesh@example.com,Verma Enterprises',
    'Pooja Sen,9830054321,pooja@example.com,Sen Logistics'
  ].join('\n');

  const result = importCsv(csvContent, { workspaceId: 'ws-csv-test', defaultCountry: 'IN' });
  assert.equal(result.accepted_count, 2);
  assert.equal(result.records[0].name, 'Rajesh Verma');
  assert.equal(result.records[0].email, 'rajesh@example.com');
  assert.equal(result.records[0].phone, '+919830012345');
  assert.equal(result.records[0].raw_phone, '09830012345');
  assert.equal(typeof result.records[0].raw_phone, 'string');
});

test('Stage 3 (C1): Phone normalisation, leading zeros, and landline detection', () => {
  // Mobile with leading zero
  const mob = normalizePhoneNumber('09830012345', 'IN');
  assert.equal(mob.phone, '+919830012345');
  assert.equal(mob.raw_phone, '09830012345');
  assert.equal(mob.is_valid, true);

  // Landline number
  const landline = normalizePhoneNumber('03322114455', 'IN');
  assert.equal(landline.is_valid, true);
  assert.equal(landline.is_whatsapp_capable, false);
});

test('Stage 3 (C1): Missing consent source defaults to test_data / non-sendable', () => {
  const csvNoConsent = [
    'Name,Mobile,Email',
    'Amit Kumar,9830011111,amit@example.com'
  ].join('\n');

  const result = importCsv(csvNoConsent, { workspaceId: 'ws-csv-test' });
  assert.equal(result.accepted_count, 1);
  assert.equal(result.records[0].test_data, true);
  assert.equal(result.records[0].outbound_blocked, true);
  assert.equal(result.records[0].email_opt_in_status, 'unknown');
  assert.equal(result.records[0].whatsapp_opt_in_status, 'unknown');
});

test('Stage 3 (C1): Purchased list is blocked from WhatsApp and SMS', () => {
  const csvPurchased = [
    'Name,Mobile,Email,Consent Source',
    'Cold Prospect,9830022222,cold@example.com,purchased_lead_database'
  ].join('\n');

  const result = importCsv(csvPurchased, { workspaceId: 'ws-csv-test' });
  assert.equal(result.accepted_count, 1);
  assert.equal(result.records[0].whatsapp_opt_in_status, 'blocked');
  assert.equal(result.records[0].sms_opt_in_status, 'blocked');
  assert.equal(result.records[0].outbound_blocked, true);
  assert.ok(result.errors.some(e => e.code === 'PURCHASED_LIST_FORBIDDEN'));
});

test('Stage 3 (C1): Deduplication within CSV file and row error reporting', () => {
  const csvWithDupes = [
    'Name,Mobile,Email',
    'Duplicate One,9830033333,dupe@example.com',
    'Duplicate Two,9830033333,dupe@example.com',
    ',9830044444,missingname@example.com'
  ].join('\n');

  const result = importCsv(csvWithDupes, { workspaceId: 'ws-csv-test' });
  assert.equal(result.accepted_count, 1);
  assert.ok(result.errors.some(e => e.code === 'DUPLICATE' && e.row === 3));
  assert.ok(result.errors.some(e => e.code === 'NAME_REQUIRED' && e.row === 4));
});

test('Stage 3 (C1): API endpoint /api/marketing/import-leads accepts CSV and saves correct count (not 400)', async () => {
  installCrmFetch();
  const workspaceId = 'ws-api-csv-test';
  const dispatchReq = mockHttp('POST', '/api/marketing/dispatch', {
    workspace_id: workspaceId,
    prompt: 'Commercial industrial brochure blast'
  });
  await marketingApi(dispatchReq.req, dispatchReq.res);
  const corrId = dispatchReq.get().data.correlation_id;

  const csvBody = [
    'Name,Mobile No.,Mail,Consent Source,WhatsApp Consent',
    'Vikram Seth,9830077777,vikram@example.com,opt_in_event,yes',
    'Sunita Rao,9830088888,sunita@example.com,opt_in_event,yes'
  ].join('\n');

  const importReq = mockHttp('POST', '/api/marketing/import-leads', {
    workspace_id: workspaceId,
    correlation_id: corrId,
    csv: csvBody
  });
  await marketingApi(importReq.req, importReq.res);

  const res = importReq.get();
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'ok');
  assert.equal(res.data.total_count, 2);
  assert.equal(res.data.accepted_count, 2);

  const task = orchestrator.getMarketingTask(workspaceId, corrId);
  assert.equal(task.audience_snapshot.total_count, 2);
  assert.equal(task.audience_snapshot.contacts.length, 2);
  assert.equal(task.audience_snapshot.contacts[0].name, 'Vikram Seth');
  assert.equal(task.audience_snapshot.contacts[0].phone, '+919830077777');
  global.fetch = originalFetch;
});
