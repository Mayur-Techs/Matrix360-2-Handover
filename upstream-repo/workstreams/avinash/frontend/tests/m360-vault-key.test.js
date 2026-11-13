'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, createCipheriv, randomBytes } = require('node:crypto');

const orchestratorPath = path.resolve(__dirname, '../lib/m360-marketing-orchestrator.js');
const orchestrator = require('../lib/m360-marketing-orchestrator');
const marketingApi = require('../api/marketing');

describe('Stage 1 (V1): Required Vault Key & HKDF Derivation', () => {
  const originalEnv = { ...process.env };
  const validKey = Buffer.alloc(32, 0x5a).toString('base64');

  beforeEach(() => {
    process.env.M360_TENANT_ENCRYPTION_KEY = validKey;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('Grep test: no default key string in source code', () => {
    const code = fs.readFileSync(orchestratorPath, 'utf8');
    assert.equal(code.includes('matrix360-vault-key-default-2026'), false, 'Default key literal must not exist');
  });

  it('Throws VAULT_KEY_MISSING when env var is unset or empty', () => {
    delete process.env.M360_TENANT_ENCRYPTION_KEY;
    assert.throws(
      () => orchestrator.getTenantMasterKey(),
      err => err.code === 'VAULT_KEY_MISSING' || String(err.message).includes('VAULT_KEY_MISSING')
    );

    process.env.M360_TENANT_ENCRYPTION_KEY = '';
    assert.throws(
      () => orchestrator.getTenantMasterKey(),
      err => err.code === 'VAULT_KEY_MISSING' || String(err.message).includes('VAULT_KEY_MISSING')
    );
  });

  it('Throws VAULT_KEY_MISSING when decoded key is shorter than 32 bytes', () => {
    process.env.M360_TENANT_ENCRYPTION_KEY = Buffer.from('short-key').toString('base64');
    assert.throws(
      () => orchestrator.getTenantMasterKey(),
      err => err.code === 'VAULT_KEY_MISSING' || String(err.message).includes('VAULT_KEY_MISSING')
    );
  });

  it('Encrypt and decrypt round-trips with real key (Version 2 HKDF)', () => {
    const workspaceId = 'ws-test-vault-hkdf';
    const secretText = 'meta-system-user-token-secret-xyz';

    const encrypted = orchestrator.encryptSecret(secretText, workspaceId);
    assert.match(encrypted, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i, 'Encrypted payload must be 3 hex parts');

    const decrypted = orchestrator.decryptSecret(encrypted, workspaceId);
    assert.equal(decrypted, secretText, 'Decrypted text must match original secret');

    // Stored provider credentials must include key_version: 2
    const record = orchestrator.configureMarketingProvider(workspaceId, 'email', {
      smtpKey: secretText,
      smtpLogin: 'login-test',
      senderEmail: 'test@matrix360.in'
    });
    assert.equal(record.key_version, 2, 'Stored credential must specify key_version: 2');

    // Cross-workspace isolation: decrypting with a different workspaceId must fail
    assert.throws(() => {
      orchestrator.decryptSecret(encrypted, 'different-workspace');
    });
  });

  it('Backward compatibility: decrypts legacy v1 ciphertext', () => {
    const workspaceId = 'ws-migration-legacy';
    const secretText = 'legacy-v1-token-to-migrate';

    // Manually construct legacy v1 ciphertext (SHA256 derivation without HKDF)
    const masterBuf = Buffer.from(validKey, 'base64');
    const legacyKey = createHash('sha256').update(Buffer.concat([masterBuf, Buffer.from(':' + workspaceId, 'utf8')])).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', legacyKey, iv);
    let enc = cipher.update(secretText, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    const legacyPayload = `${iv.toString('hex')}:${tag}:${enc}`;

    // Assert orchestrator decrypts legacy v1 payload cleanly
    const decrypted = orchestrator.decryptSecret(legacyPayload, workspaceId);
    assert.equal(decrypted, secretText, 'Must successfully decrypt legacy v1 ciphertext during migration');
  });

  it('Marketing API refuses to serve (HTTP 503) when VAULT_KEY_MISSING', async () => {
    delete process.env.M360_TENANT_ENCRYPTION_KEY;

    let resBody = null;
    const req = {
      method: 'GET',
      url: '/api/marketing/tasks?workspace_id=ws-test',
      headers: {},
      query: { workspace_id: 'ws-test' }
    };
    const res = {
      statusCode: 200,
      setHeader() {},
      writeHead(code) { this.statusCode = code; return this; },
      end(data) { if (data) resBody = JSON.parse(data); }
    };

    await marketingApi(req, res);
    assert.equal(res.statusCode, 503, 'Must return HTTP 503 when master vault key is missing');
    assert.equal(resBody?.error, 'Marketing API unavailable: VAULT_KEY_MISSING');
  });

  it('Zero credential writes to disk: saveTasksToDisk does not write provider_credentials', () => {
    const testStorePath = path.resolve(__dirname, `../tmp/test-vault-store-${Date.now()}.json`);
    process.env.M360_MARKETING_TEST_STORE_PATH = testStorePath;

    // Configure a provider
    orchestrator.configureMarketingProvider('ws-disk-test', 'email', {
      smtpKey: 'my-secret-smtp-key',
      smtpLogin: 'my-login',
      senderEmail: 'noreply@matrix360.in'
    });

    orchestrator.saveTasksToDisk();

    if (fs.existsSync(testStorePath)) {
      const content = fs.readFileSync(testStorePath, 'utf8');
      const parsed = JSON.parse(content);
      assert.equal(parsed.provider_credentials, undefined, 'Disk cache must not contain provider_credentials');
      // Clean up test file
      fs.unlinkSync(testStorePath);
    }
    delete process.env.M360_MARKETING_TEST_STORE_PATH;
  });
});
