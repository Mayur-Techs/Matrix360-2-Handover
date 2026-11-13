const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { mode, isTestRecipient, isTestWorkspace } = require('../lib/m360-mode');

describe('m360-mode: Marketing Mode and Team-Testing Guardrails', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.M360_MARKETING_MODE;
    delete process.env.M360_TEST_RECIPIENTS;
    delete process.env.M360_TEST_WORKSPACES;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('mode() defaults to draft_only when unset or empty', () => {
    assert.equal(mode(), 'draft_only');
    process.env.M360_MARKETING_MODE = '';
    assert.equal(mode(), 'draft_only');
    process.env.M360_MARKETING_MODE = '   ';
    assert.equal(mode(), 'draft_only');
  });

  it('mode() returns draft_only, team_test, and live correctly', () => {
    process.env.M360_MARKETING_MODE = 'draft_only';
    assert.equal(mode(), 'draft_only');

    process.env.M360_MARKETING_MODE = 'team_test';
    assert.equal(mode(), 'team_test');

    process.env.M360_MARKETING_MODE = 'live';
    assert.equal(mode(), 'live');
  });

  it('mode() normalizes casing and whitespace', () => {
    process.env.M360_MARKETING_MODE = '  TEAM_TEST  ';
    assert.equal(mode(), 'team_test');

    process.env.M360_MARKETING_MODE = 'Live';
    assert.equal(mode(), 'live');
  });

  it('mode() rejects invalid mode names and falls back to draft_only', () => {
    process.env.M360_MARKETING_MODE = 'unrestricted';
    assert.equal(mode(), 'draft_only');

    process.env.M360_MARKETING_MODE = 'production_bypass';
    assert.equal(mode(), 'draft_only');
  });

  it('isTestRecipient() checks allowed tester emails and E.164 phone numbers', () => {
    process.env.M360_TEST_RECIPIENTS = 'mayur@matrix360.in, +919876543210, tester@example.com';

    assert.equal(isTestRecipient('mayur@matrix360.in'), true);
    assert.equal(isTestRecipient('MAYUR@MATRIX360.IN'), true);
    assert.equal(isTestRecipient('+919876543210'), true);
    assert.equal(isTestRecipient('tester@example.com'), true);

    assert.equal(isTestRecipient('unauthorized@client.com'), false);
    assert.equal(isTestRecipient('+911234567890'), false);
    assert.equal(isTestRecipient(''), false);
    assert.equal(isTestRecipient(null), false);
    assert.equal(isTestRecipient(undefined), false);
  });

  it('isTestRecipient() returns false when M360_TEST_RECIPIENTS is unset or empty', () => {
    delete process.env.M360_TEST_RECIPIENTS;
    assert.equal(isTestRecipient('mayur@matrix360.in'), false);

    process.env.M360_TEST_RECIPIENTS = '';
    assert.equal(isTestRecipient('mayur@matrix360.in'), false);
  });

  it('isTestWorkspace() checks allowed workspace IDs', () => {
    process.env.M360_TEST_WORKSPACES = '1, 42, lakhotia-qa, default';

    assert.equal(isTestWorkspace(1), true);
    assert.equal(isTestWorkspace('1'), true);
    assert.equal(isTestWorkspace(42), true);
    assert.equal(isTestWorkspace('lakhotia-qa'), true);
    assert.equal(isTestWorkspace('default'), true);

    assert.equal(isTestWorkspace(99), false);
    assert.equal(isTestWorkspace('prod-workspace'), false);
    assert.equal(isTestWorkspace(''), false);
    assert.equal(isTestWorkspace(null), false);
    assert.equal(isTestWorkspace(undefined), false);
  });

  it('isTestWorkspace() returns false when M360_TEST_WORKSPACES is unset or empty', () => {
    delete process.env.M360_TEST_WORKSPACES;
    assert.equal(isTestWorkspace('default'), false);

    process.env.M360_TEST_WORKSPACES = '   ';
    assert.equal(isTestWorkspace('default'), false);
  });
});
