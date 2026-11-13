'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const util = require('node:util');
const execFile = util.promisify(require('node:child_process').execFile);
const path = require('node:path');
const fs = require('node:fs');
const durableStore = require('../lib/m360-marketing-durable-store.js');
const orchestrator = require('../lib/m360-marketing-orchestrator.js');

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

test('Stage 4 (M1): Durable store save and multi-process reload returns identical campaign', async () => {
  const db = {
    marketing_campaigns: new Map(),
    marketing_tasks: new Map(),
    campaign_calendar_events: new Map(),
    whatsapp_onboarding: new Map()
  };

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, 'http://127.0.0.1');
    const table = parsed.pathname.replace('/rest/v1/', '').split('?')[0];

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch {}
        const key = table === 'whatsapp_onboarding' ? payload.workspace_id : `${payload.workspace_id}:${payload.correlation_id || payload.id}`;
        if (!db[table]) db[table] = new Map();
        db[table].set(key, payload);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
      return;
    }

    if (req.method === 'GET') {
      const matchWs = /workspace_id=eq\.([^&]+)/.exec(parsed.search);
      const matchCorr = /correlation_id=eq\.([^&]+)/.exec(parsed.search);
      const ws = matchWs ? decodeURIComponent(matchWs[1]) : '';
      const corr = matchCorr ? decodeURIComponent(matchCorr[1]) : '';
      const key = `${ws}:${corr}`;

      if (table === 'whatsapp_onboarding') {
        const row = db.whatsapp_onboarding ? db.whatsapp_onboarding.get(ws) : null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(row ? [row] : []));
        return;
      }

      if (table === 'marketing_campaigns') {
        const row = db.marketing_campaigns.get(key);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(row ? [row] : []));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const mockDbUrl = `http://127.0.0.1:${port}`;
  const mockKey = 'mock-supabase-service-role-key-32-chars-long';

  const prevEnabled = process.env.M360_MARKETING_DURABLE_ENABLED;
  const prevUrl = process.env.M360_MARKETING_SUPABASE_URL;
  const prevKey = process.env.M360_AI_TRIAL_SUPABASE_SERVICE_KEY;

  process.env.M360_MARKETING_DURABLE_ENABLED = 'true';
  process.env.M360_MARKETING_SUPABASE_URL = mockDbUrl;
  process.env.M360_AI_TRIAL_SUPABASE_SERVICE_KEY = mockKey;

  const tmpRunnerPath = path.resolve(__dirname, `../tmp/test-runner-${Date.now()}.js`);
  fs.mkdirSync(path.dirname(tmpRunnerPath), { recursive: true });

  try {
    const workspaceId = 'ws-durable-2proc-test';
    const correlationId = '11111111-2222-3333-4444-555555555555';
    const campaignTask = {
      workspace_id: workspaceId,
      correlation_id: correlationId,
      prompt: 'Durable multi-process persistence test',
      status: 'draft_ready',
      storage_version: 1,
      channel_draft_versions: {
        Email: {
          versions: [{
            version_id: 'ver-email-1',
            version: 1,
            subject: 'Durable Email Subject',
            body: 'Durable Email Body Content',
            version_hash: 'hash-email-1',
            status: 'draft_for_review',
            created_at: new Date().toISOString()
          }]
        }
      }
    };

    // Process 1 saves to durable store
    const saveResult = await durableStore.saveTask(campaignTask);
    assert.equal(saveResult.status, 'verified_durable_store');
    assert.equal(saveResult.durable, true);

    // Process 2: write small dedicated runner file to test reload in a fresh Node process
    const runnerContent = [
      "'use strict';",
      `const durableStore = require(${JSON.stringify(path.resolve(__dirname, '../lib/m360-marketing-durable-store.js'))});`,
      "async function main() {",
      `  const task = await durableStore.loadTask(${JSON.stringify(workspaceId)}, ${JSON.stringify(correlationId)});`,
      "  process.stdout.write(JSON.stringify(task));",
      "}",
      "main().catch(err => { console.error(err); process.exit(1); });"
    ].join('\n');

    fs.writeFileSync(tmpRunnerPath, runnerContent, 'utf8');

    // Async execution ensures Process 1's event loop continues serving HTTP requests
    const { stdout } = await execFile(process.execPath, [tmpRunnerPath], {
      env: {
        ...process.env,
        M360_MARKETING_DURABLE_ENABLED: 'true',
        M360_MARKETING_SUPABASE_URL: mockDbUrl,
        M360_AI_TRIAL_SUPABASE_SERVICE_KEY: mockKey
      },
      encoding: 'utf8'
    });

    const proc2Task = JSON.parse(stdout);
    assert.equal(proc2Task.workspace_id, workspaceId);
    assert.equal(proc2Task.correlation_id, correlationId);
    assert.equal(proc2Task.prompt, 'Durable multi-process persistence test');
    assert.equal(proc2Task.status, 'draft_ready');
    assert.equal(proc2Task.channel_draft_versions.Email.versions[0].subject, 'Durable Email Subject');
  } finally {
    if (fs.existsSync(tmpRunnerPath)) {
      try { fs.unlinkSync(tmpRunnerPath); } catch {}
    }
    server.close();
    if (prevEnabled !== undefined) process.env.M360_MARKETING_DURABLE_ENABLED = prevEnabled;
    else delete process.env.M360_MARKETING_DURABLE_ENABLED;
    if (prevUrl !== undefined) process.env.M360_MARKETING_SUPABASE_URL = prevUrl;
    else delete process.env.M360_MARKETING_SUPABASE_URL;
    if (prevKey !== undefined) process.env.M360_AI_TRIAL_SUPABASE_SERVICE_KEY = prevKey;
    else delete process.env.M360_AI_TRIAL_SUPABASE_SERVICE_KEY;
  }
});

test('Stage 4 (M1): Zero disk writes when durable store is active', () => {
  const testStorePath = path.resolve(__dirname, `../tmp/test-m1-disk-${Date.now()}.json`);
  process.env.M360_MARKETING_TEST_STORE_PATH = testStorePath;
  process.env.M360_MARKETING_DURABLE_ENABLED = 'true';

  try {
    orchestrator.saveTasksToDisk();
    assert.equal(fs.existsSync(testStorePath), false, 'Disk file must NOT be created when M360_MARKETING_DURABLE_ENABLED=true');
  } finally {
    delete process.env.M360_MARKETING_TEST_STORE_PATH;
    delete process.env.M360_MARKETING_DURABLE_ENABLED;
  }
});

test('Stage 2: WhatsApp onboarding durable store save and multi-process reload via syncWhatsAppOnboardingFromDurable', async () => {
  const db = {
    whatsapp_onboarding: new Map()
  };

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, 'http://127.0.0.1');
    const table = parsed.pathname.replace('/rest/v1/', '').split('?')[0];

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch {}
        db.whatsapp_onboarding.set(payload.workspace_id, payload);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
      return;
    }

    if (req.method === 'GET') {
      const matchWs = /workspace_id=eq\.([^&]+)/.exec(parsed.search);
      const ws = matchWs ? decodeURIComponent(matchWs[1]) : '';
      const row = db.whatsapp_onboarding.get(ws);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(row ? [row] : []));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const mockDbUrl = `http://127.0.0.1:${port}`;
  const mockKey = 'mock-supabase-service-role-key-32-chars-long';

  const prevEnabled = process.env.M360_MARKETING_DURABLE_ENABLED;
  const prevUrl = process.env.M360_MARKETING_SUPABASE_URL;
  const prevKey = process.env.M360_AI_TRIAL_SUPABASE_SERVICE_KEY;

  process.env.M360_MARKETING_DURABLE_ENABLED = 'true';
  process.env.M360_MARKETING_SUPABASE_URL = mockDbUrl;
  process.env.M360_AI_TRIAL_SUPABASE_SERVICE_KEY = mockKey;

  const tmpRunnerPath = path.resolve(__dirname, `../tmp/test-runner-whatsapp-${Date.now()}.js`);
  fs.mkdirSync(path.dirname(tmpRunnerPath), { recursive: true });

  try {
    const workspaceId = 'ws-wa-durable-2proc-' + Date.now();
    const onboardingRecord = {
      workspace_id: workspaceId,
      waba_id: 'waba-durable-proc-1',
      phone_number_id: 'phone-durable-proc-2',
      display_phone_number: '+91 98765 00000',
      verified_name: 'Matrix Real Estate Durable',
      state: 'ready_limited',
      tier: 'tier_250',
      templates: [
        { name: 'm360_starter_intro', status: 'APPROVED' }
      ],
      test_delivery_confirmed_at: '2026-11-09T10:00:00.000Z'
    };

    // Process 1: Saves WhatsApp onboarding record to PostgREST/Supabase
    const saveResult = await durableStore.saveWhatsAppOnboarding(onboardingRecord);
    assert.equal(saveResult.status, 'saved');
    assert.equal(saveResult.durable, true);

    // Process 2: Launch a fresh independent Node process to prove cold-start hydration
    const runnerContent = [
      "'use strict';",
      `const { syncWhatsAppOnboardingFromDurable, getWhatsAppOnboardingRecord, clearWhatsAppOnboardingStore } = require(${JSON.stringify(path.resolve(__dirname, '../lib/m360-whatsapp-onboarding.js'))});`,
      "async function main() {",
      "  clearWhatsAppOnboardingStore();",
      `  const before = getWhatsAppOnboardingRecord(${JSON.stringify(workspaceId)});`,
      `  const hydrated = await syncWhatsAppOnboardingFromDurable(${JSON.stringify(workspaceId)});`,
      "  process.stdout.write(JSON.stringify({",
      "    beforeState: before.state,",
      "    hydratedState: hydrated.state,",
      "    waba_id: hydrated.waba_id,",
      "    phone_number_id: hydrated.phone_number_id,",
      "    tier: hydrated.tier,",
      "    test_delivery_confirmed_at: hydrated.test_delivery_confirmed_at",
      "  }));",
      "}",
      "main().catch(err => { console.error(err); process.exit(1); });"
    ].join('\n');

    fs.writeFileSync(tmpRunnerPath, runnerContent, 'utf8');

    const { stdout } = await execFile(process.execPath, [tmpRunnerPath], {
      env: {
        ...process.env,
        M360_MARKETING_DURABLE_ENABLED: 'true',
        M360_MARKETING_SUPABASE_URL: mockDbUrl,
        M360_AI_TRIAL_SUPABASE_SERVICE_KEY: mockKey
      },
      encoding: 'utf8'
    });

    const proc2Result = JSON.parse(stdout);

    // Prove in-memory map was initially unhydrated (proving it's only a cache)
    assert.equal(proc2Result.beforeState, 'not_started', 'In-memory map in fresh process must start empty/default');

    // Prove cold-start hydration successfully loaded the durable state from Supabase
    assert.equal(proc2Result.hydratedState, 'ready_limited', 'Cold-start must hydrate state from durable store');
    assert.equal(proc2Result.waba_id, 'waba-durable-proc-1');
    assert.equal(proc2Result.phone_number_id, 'phone-durable-proc-2');
    assert.equal(proc2Result.tier, 'tier_250');
    assert.equal(proc2Result.test_delivery_confirmed_at, '2026-11-09T10:00:00.000Z');
  } finally {
    if (fs.existsSync(tmpRunnerPath)) {
      try { fs.unlinkSync(tmpRunnerPath); } catch {}
    }
    server.close();
    if (prevEnabled !== undefined) process.env.M360_MARKETING_DURABLE_ENABLED = prevEnabled;
    else delete process.env.M360_MARKETING_DURABLE_ENABLED;
    if (prevUrl !== undefined) process.env.M360_MARKETING_SUPABASE_URL = prevUrl;
    else delete process.env.M360_MARKETING_SUPABASE_URL;
    if (prevKey !== undefined) process.env.M360_AI_TRIAL_SUPABASE_SERVICE_KEY = prevKey;
    else delete process.env.M360_AI_TRIAL_SUPABASE_SERVICE_KEY;
  }
});
