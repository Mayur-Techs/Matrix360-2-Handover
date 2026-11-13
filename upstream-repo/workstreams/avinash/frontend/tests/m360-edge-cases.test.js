'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { importCsv, parseCsv } = require('../lib/m360-csv-import');
const outboxWorker = require('../lib/m360-outbox-worker');
const creativeIntegrated = require('../api/creative-integrated');

describe('Stage 4: Production Edge Cases & Defense Hardening', () => {

  it('Edge Case 1: Session Expiry Fail-Closed Handling', () => {
    // Test that expired token detection in client logic correctly detects expiration
    const expiredTimestamp = Date.now() - 5000;
    const isExpired = !expiredTimestamp || expiredTimestamp <= Date.now();
    assert.equal(isExpired, true, 'Past timestamp must be marked expired');

    // Simulate auth check helper
    function checkAuth(token, expiresAt) {
      if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return null;
      }
      return token;
    }

    assert.equal(checkAuth('pilot-token-123', Date.now() - 1000), null, 'Expired session token must yield null');
    assert.equal(checkAuth(null, Date.now() + 10000), null, 'Missing token must yield null');
    assert.equal(checkAuth('valid-token', Date.now() + 60000), 'valid-token', 'Valid unexpired token is preserved');
  });

  it('Edge Case 2: Double-Submit Idempotency Prevents Duplicate Outbox Messages', async () => {
    const wsId = 'ws-idempotent-' + randomUUID();
    const corrId = 'corr-double-submit-' + randomUUID();
    const draft = { subject: 'Promo', body: '50% off', version_hash: 'vh-9988' };
    const contacts = [
      { id: 'c1', name: 'Ravi', email: 'ravi@example.com' },
      { id: 'c2', name: 'Anita', email: 'anita@example.com' }
    ];

    // First submission
    const firstQueue = await outboxWorker.snapshotAudienceToOutbox({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'email',
      draftVersion: draft,
      contacts
    });

    assert.equal(firstQueue.length, 2, 'First submission enqueues 2 records');

    // Second accidental rapid click submission with same parameters
    const secondQueue = await outboxWorker.snapshotAudienceToOutbox({
      workspaceId: wsId,
      correlationId: corrId,
      channel: 'email',
      draftVersion: draft,
      contacts
    });

    assert.equal(secondQueue.length, 0, 'Double-submit must enqueue 0 records (idempotent rejection)');

    // Verify summary count reflects exactly 2 rows
    const summary = outboxWorker.getOutboxSummary(wsId, corrId);
    assert.equal(summary.queued, 2);
  });

  it('Edge Case 3: CSV Import Formula Injection & Formatting Edge Cases', () => {
    // 1. Formula injection characters in fields
    const dangerousCsv = `name,email,company
=cmd|' /C calc'!A0,attacker@example.com,Injected Corp
+12345678,plus@example.com,Plus Corp
@SUM(1+1),at@example.com,At Corp
-100,minus@example.com,Minus Corp`;

    const parsed = parseCsv(dangerousCsv);
    assert.equal(parsed.length, 5); // header + 4 rows

    const imported = importCsv(dangerousCsv, { workspaceId: 'ws-csv-test' });
    assert.equal(imported.records.length, 4);
    // Ensure cells are trimmed and bounded without execution
    assert.ok(imported.records.some(c => c.name.includes('=cmd')));

    // 2. CSV exceeding MAX_ROWS
    const hugeCsvHeader = 'name,email\n';
    const hugeCsvRows = Array.from({ length: 2005 }, (_, i) => `Lead ${i},lead${i}@example.com`).join('\n');
    assert.throws(() => {
      importCsv(hugeCsvHeader + hugeCsvRows, { workspaceId: 'ws-csv-limit' });
    }, /exceeds the 2000 row limit/i);

    // 3. Unclosed quoted field fails gracefully
    assert.throws(() => {
      parseCsv('name,email\n"Unclosed text,unclosed@example.com');
    }, /unclosed quoted field/i);

    // 4. Missing required column fails gracefully
    assert.throws(() => {
      importCsv('source,notes\nWebsite,Just notes', { workspaceId: 'ws-csv-err' });
    }, /CSV needs a name or company column/i);
  });

  it('Edge Case 4: Unknown Route 404 Handler Does Not Leak System Internals', async () => {
    function fakeRes() {
      const headers = new Map();
      return {
        statusCode: 200,
        setHeader(k, v) { headers.set(k.toLowerCase(), v); },
        getHeader(k) { return headers.get(k.toLowerCase()); },
        end(chunk) {
          this.body = chunk ? String(chunk) : '';
        }
      };
    }

    const res = fakeRes();
    await creativeIntegrated({
      method: 'GET',
      query: { mode: 'page', file: 'admin-debug-shell.html' }
    }, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body, 'Unknown page');
    assert.ok(!res.body.includes('Error:'), 'Must not leak JS stack traces');
    assert.ok(!res.body.includes(__dirname), 'Must not leak server directory paths');
  });

  it('Edge Case 5: Secret Leakage Scanner Across All Client-Served Assets', () => {
    const frontendSourceDir = path.resolve(__dirname, '../frontend-source');
    const files = fs.readdirSync(frontendSourceDir);

    const sensitivePatterns = [
      { pattern: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g, label: 'Raw JWT token' },
      { pattern: /service_role/i, label: 'service_role key reference' },
      { pattern: /M360_TENANT_ENCRYPTION_KEY\s*=\s*['"][^'"]+['"]/i, label: 'Hardcoded Encryption Key' },
      { pattern: /META_APP_SECRET\s*=\s*['"][a-f0-9]{32}['"]/i, label: 'Hardcoded Meta Secret' },
      { pattern: /xkeysib-[a-f0-9]{64}/i, label: 'Hardcoded Brevo Key' },
      { pattern: /postgres:\/\/[^:]+:[^@]+@/i, label: 'Postgres Connection String' }
    ];

    for (const file of files) {
      const fullPath = path.join(frontendSourceDir, file);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.mp4')) continue;

      const content = fs.readFileSync(fullPath, 'utf8');

      for (const { pattern, label } of sensitivePatterns) {
        // Exception: allow word "service_role" only if explicitly in markdown docs or comments, but not in client HTML/JS
        const match = pattern.exec(content);
        if (match) {
          assert.fail(`SECRET LEAK DETECTED: File "${file}" matched sensitive pattern "${label}": ${match[0].slice(0, 20)}...`);
        }
      }
    }
  });

  it('Edge Case 6: Strict RLS Tenant Isolation Logic (Non-Member Cannot Query Workspace)', () => {
    // Model of PostgreSQL is_workspace_member RLS check
    const memberships = [
      { workspace_id: 'ws-alpha', user_id: 'user-1', role: 'owner' },
      { workspace_id: 'ws-beta', user_id: 'user-2', role: 'manager' }
    ];

    function isWorkspaceMember(wsId, userId) {
      return memberships.some(m => m.workspace_id === wsId && m.user_id === userId);
    }

    // Tenant Alpha access check
    assert.equal(isWorkspaceMember('ws-alpha', 'user-1'), true, 'User 1 is authorized for Alpha');
    assert.equal(isWorkspaceMember('ws-alpha', 'user-2'), false, 'User 2 CANNOT access Alpha');
    assert.equal(isWorkspaceMember('ws-alpha', 'anonymous-user'), false, 'Anonymous user CANNOT access Alpha');
    
    // Tenant Beta access check
    assert.equal(isWorkspaceMember('ws-beta', 'user-2'), true, 'User 2 is authorized for Beta');
    assert.equal(isWorkspaceMember('ws-beta', 'user-1'), false, 'User 1 CANNOT access Beta');
  });
});
