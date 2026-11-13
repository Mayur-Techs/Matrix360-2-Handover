'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const util = require('node:util');
const execFile = util.promisify(require('node:child_process').execFile);
const path = require('node:path');
const fs = require('node:fs');

const { verifyStaticMigrations, MARKETING_TABLES } = require('../../../../tools/audit/verify-rls.js');
const durableStore = require('../lib/m360-marketing-durable-store.js');

test('Stage 1: Supabase Go-Live & RLS Enforcement Proof', async (t) => {
  await t.test('RLS verification: all 22 marketing tables have RLS enabled and is_workspace_member bound', () => {
    const migrationsDir = path.resolve(__dirname, '../../../../migrations');
    const results = verifyStaticMigrations(migrationsDir);

    assert.equal(results.length, 22, 'Must audit exactly 22 marketing tables');
    for (const r of results) {
      assert.equal(r.rlsEnabled, true, `Table ${r.table} must have RLS enabled`);
      assert.equal(r.selectPolicy, true, `Table ${r.table} must have SELECT policy referencing is_workspace_member`);
      assert.equal(r.writePolicy, true, `Table ${r.table} must have write policy referencing is_workspace_member`);
      assert.equal(r.status, 'PASS', `Table ${r.table} must PASS RLS verification`);
    }
  });

  await t.test('Two-process persistence proof: record written in Process A is hydrated in fresh Process B', async () => {
    const mockStorage = {
      marketing_campaigns: new Map(),
      marketing_tasks: new Map(),
      whatsapp_onboarding: new Map(),
      email_sender_onboarding: new Map()
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
          const key = (table === 'whatsapp_onboarding' || table === 'email_sender_onboarding')
            ? payload.workspace_id
            : `${payload.workspace_id}:${payload.correlation_id || payload.id}`;
          if (!mockStorage[table]) mockStorage[table] = new Map();
          mockStorage[table].set(key, payload);
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

        if (table === 'whatsapp_onboarding' || table === 'email_sender_onboarding') {
          const row = mockStorage[table] ? mockStorage[table].get(ws) : null;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(row ? [row] : []));
          return;
        }

        if (table === 'marketing_campaigns') {
          const row = mockStorage.marketing_campaigns.get(key);
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
    const mockServiceKey = 'mock-supabase-service-role-key-very-long-and-secure-32-chars';

    const prevEnabled = process.env.M360_MARKETING_DURABLE_ENABLED;
    const prevUrl = process.env.SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    process.env.M360_MARKETING_DURABLE_ENABLED = 'true';
    process.env.SUPABASE_URL = mockDbUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = mockServiceKey;

    try {
      const workspaceId = 'ws-supabase-stage1-proof';
      const correlationId = '99999999-8888-7777-6666-555555555555';

      // Process A: writes via durableStore
      const taskA = {
        workspace_id: workspaceId,
        correlation_id: correlationId,
        prompt: 'Cross-process persistence validation on Supabase',
        status: 'draft_ready',
        storage_version: 1,
        channel_draft_versions: {
          Email: {
            versions: [{
              version_id: 'ver-email-s1',
              version: 1,
              subject: 'Supabase Launch Announcement',
              body: 'Real persistence proven across separate Node processes.',
              status: 'draft_for_review',
              created_at: new Date().toISOString()
            }]
          }
        }
      };

      await durableStore.saveTask(taskA);

      // Verify Process A stored it in mockStorage
      assert.ok(mockStorage.marketing_campaigns.has(`${workspaceId}:${correlationId}`));

      // Process B: Launch an entirely independent Node process
      const childScript = `
        const durableStore = require('${path.resolve(__dirname, '../lib/m360-marketing-durable-store.js').replace(/\\/g, '/')}');
        (async () => {
          const loaded = await durableStore.loadTask('${workspaceId}', '${correlationId}');
          if (!loaded) {
            console.error('FAILED_TO_LOAD');
            process.exit(1);
          }
          if (loaded.prompt !== '${taskA.prompt}') {
            console.error('CORRUPT_DATA');
            process.exit(2);
          }
          console.log(JSON.stringify({ success: true, prompt: loaded.prompt }));
          process.exit(0);
        })().catch(err => {
          console.error(err);
          process.exit(3);
        });
      `;

      const { stdout } = await execFile(process.execPath, ['-e', childScript], {
        env: {
          ...process.env,
          M360_MARKETING_DURABLE_ENABLED: 'true',
          SUPABASE_URL: mockDbUrl,
          SUPABASE_SERVICE_ROLE_KEY: mockServiceKey
        }
      });

      const parsedOutput = JSON.parse(stdout.trim());
      assert.equal(parsedOutput.success, true);
      assert.equal(parsedOutput.prompt, taskA.prompt);
    } finally {
      server.close();
      if (prevEnabled !== undefined) process.env.M360_MARKETING_DURABLE_ENABLED = prevEnabled;
      else delete process.env.M360_MARKETING_DURABLE_ENABLED;
      if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
      else delete process.env.SUPABASE_URL;
      if (prevKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
      else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  await t.test('Client-side key safety: SUPABASE_SERVICE_ROLE_KEY is never shipped to the browser', () => {
    const frontendDir = path.resolve(__dirname, '../frontend-source');
    if (fs.existsSync(frontendDir)) {
      const files = fs.readdirSync(frontendDir);
      for (const file of files) {
        if (file.endsWith('.html') || file.endsWith('.js')) {
          const content = fs.readFileSync(path.join(frontendDir, file), 'utf8');
          assert.equal(content.includes('SERVICE_ROLE_KEY'), false, `File ${file} must never contain SERVICE_ROLE_KEY`);
          assert.equal(content.includes('service_role'), false, `File ${file} must never contain service_role`);
        }
      }
    }
  });
});
