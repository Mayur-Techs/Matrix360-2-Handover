'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const permissions = require('../lib/m360-permissions');
const { checkWorkspaceQuota, recordSendQuotaUsage, resetQuotaStoreForTests } = require('../lib/m360-quota');
const orchestrator = require('../lib/m360-marketing-orchestrator');

describe('Stage 7 (E1 & E2): Roles, Quota & Safe Chat Drafts', () => {
  beforeEach(() => {
    resetQuotaStoreForTests();
  });

  it('RBAC (E2): sales_operator cannot approve or send campaigns; client_admin and platform_owner can', () => {
    assert.equal(permissions.can('sales_operator', 'approve'), false, 'sales_operator cannot approve');
    assert.equal(permissions.can('sales_operator', 'send'), false, 'sales_operator cannot send');
    assert.equal(permissions.can('sales_operator', 'configure_provider'), false, 'sales_operator cannot configure providers');
    assert.equal(permissions.can('sales_operator', 'write'), true, 'sales_operator can draft/write');
    assert.equal(permissions.can('sales_operator', 'read'), true, 'sales_operator can read');

    assert.equal(permissions.can('viewer', 'write'), false, 'viewer cannot write');
    assert.equal(permissions.can('viewer', 'approve'), false, 'viewer cannot approve');
    assert.equal(permissions.can('viewer', 'send'), false, 'viewer cannot send');

    assert.equal(permissions.can('client_admin', 'approve'), true, 'client_admin can approve');
    assert.equal(permissions.can('client_admin', 'send'), true, 'client_admin can send');
    assert.equal(permissions.can('client_admin', 'configure_provider'), true, 'client_admin can configure providers');

    assert.equal(permissions.can('platform_owner', 'approve'), true, 'platform_owner can approve');
    assert.equal(permissions.can('platform_owner', 'send'), true, 'platform_owner can send');
    assert.equal(permissions.can('platform_owner', 'configure_provider'), true, 'platform_owner can configure providers');
  });

  it('API Server-Side RBAC (E2): sales_operator gets HTTP 403 on approve and execute routes', async () => {
    const apiPath = require.resolve('../api/marketing');
    const oldFetch = global.fetch;
    const wsId = 'workspace-' + randomUUID();
    let currentRole = 'sales_operator';

    global.fetch = async () => ({
      status: 200,
      ok: true,
      json: async () => [{ id: wsId, role: currentRole, name: 'Test Tenant' }]
    });

    const handler = require('../api/marketing');
    async function callApi(action, body = {}) {
      const res = {
        statusCode: 200,
        setHeader() {},
        end(data) {
          try {
            this.data = JSON.parse(data);
          } catch {
            this.data = data;
          }
        }
      };
      await handler({
        method: 'POST',
        url: '/api/marketing/' + action,
        headers: { authorization: 'Bearer test-token-of-sufficient-length-for-auth' },
        body: { workspace_id: wsId, correlation_id: randomUUID(), channel: 'Email', ...body },
        query: {}
      }, res);
      return res;
    }

    try {
      // sales_operator calling approve -> 403
      currentRole = 'sales_operator';
      const approveRes = await callApi('approve', { version_hash: 'vh-123' });
      assert.equal(approveRes.statusCode, 403, 'sales_operator must receive 403 on approve');

      // sales_operator calling execute -> 403
      const executeRes = await callApi('execute', { mode: 'test_preview' });
      assert.equal(executeRes.statusCode, 403, 'sales_operator must receive 403 on execute');

      // client_admin calling approve on non-existent task gets past auth to 404/412 rather than 403
      currentRole = 'client_admin';
      const adminApprove = await callApi('approve', { version_hash: 'vh-123' });
      assert.notEqual(adminApprove.statusCode, 403, 'client_admin must not be blocked by RBAC on approve');
    } finally {
      global.fetch = oldFetch;
    }
  });

  it('Safe Chat Drafts (E1): Conversation prepares draft state without sending or generating synthetic contacts', async () => {
    const wsId = 'workspace-' + randomUUID();
    const oldFetch = global.fetch;
    let sendCallsCount = 0;

    global.fetch = async (url, opts) => {
      if (String(url).includes('/me/workspaces')) {
        return {
          status: 200,
          ok: true,
          json: async () => [{ id: wsId, role: 'marketing_operator', name: 'Lakhotia Industrial', profile_type: 'b2b_industrial' }]
        };
      }
      if (String(url).includes('/send') || String(url).includes('/messages')) {
        sendCallsCount++;
      }
      return { status: 200, ok: true, json: async () => ({}) };
    };

    const handler = require('../api/marketing');
    let responseData = null;
    let statusCode = 200;
    const res = {
      statusCode: 200,
      setHeader() {},
      end(data) {
        statusCode = this.statusCode;
        try { responseData = JSON.parse(data); } catch { responseData = data; }
      }
    };

    try {
      await handler({
        method: 'POST',
        url: '/api/marketing/conversations',
        headers: { authorization: 'Bearer test-token-of-sufficient-length-for-auth' },
        body: {
          workspace_id: wsId,
          message: 'Plan an outreach campaign to test1@example.com and test2@example.com about Lakhotia industrial plots'
        },
        query: {}
      }, res);

      assert.equal(statusCode, 202, 'Handler returns 202 accepted with dispatched task');
      assert.ok(responseData?.conversation, 'Returns conversation object');
      assert.equal(responseData.conversation.status, 'ready_for_review', 'Conversation status is ready_for_review');
      assert.equal(sendCallsCount, 0, 'Zero send-adapter calls executed');

      const task = orchestrator.getMarketingTask(wsId, responseData.correlation_id);
      assert.ok(task, 'Task was created');
      assert.equal(task.status, 'draft_ready', 'Task reached draft_ready');

      // Assert drafts are in draft_for_review
      const emailDraft = task.channel_draft_versions?.Email?.versions?.at(-1);
      if (emailDraft) {
        assert.equal(emailDraft.status, 'draft_for_review', 'Email draft status is draft_for_review');
      }
      const waDraft = task.channel_draft_versions?.WhatsApp?.versions?.at(-1);
      if (waDraft) {
        assert.equal(waDraft.status, 'draft_for_review', 'WhatsApp draft status is draft_for_review');
      }

      // Assert no synthetic contacts were created with fabricated consent
      const contacts = task.audience_snapshot?.contacts || [];
      const hasPromptEmail1 = contacts.some(c => c.email === 'test1@example.com');
      const hasPromptEmail2 = contacts.some(c => c.email === 'test2@example.com');
      assert.equal(hasPromptEmail1, false, 'test1@example.com was not injected as a fabricated contact');
      assert.equal(hasPromptEmail2, false, 'test2@example.com was not injected as a fabricated contact');
      const hasFabricatedConsent = contacts.some(c => c.consent_evidence === 'direct_user_prompt_instruction');
      assert.equal(hasFabricatedConsent, false, 'Zero contacts created with fabricated consent');

      // Assert execution history has 0 sends
      assert.equal((task.execution_history || []).length, 0, 'Zero dispatches in execution history');
    } finally {
      global.fetch = oldFetch;
    }
  });

  it('Send Quota (E2): Enforces daily and monthly limits atomically and rejects excess sends', () => {
    const wsId = 'ws-' + randomUUID();
    process.env.M360_WORKSPACE_DAILY_SEND_QUOTA = '50';
    process.env.M360_WORKSPACE_MONTHLY_SEND_QUOTA = '200';

    // Within quota
    const check1 = checkWorkspaceQuota(wsId, 30);
    assert.equal(check1.allowed, true);
    recordSendQuotaUsage(wsId, 30);

    // Another send within remaining daily quota (30 + 15 = 45 <= 50)
    const check2 = checkWorkspaceQuota(wsId, 15);
    assert.equal(check2.allowed, true);
    recordSendQuotaUsage(wsId, 15);

    // Third send exceeds daily limit (45 + 10 = 55 > 50)
    assert.throws(
      () => checkWorkspaceQuota(wsId, 10),
      (err) => err.code === 'QUOTA_EXCEEDED_DAILY' && err.status === 429
    );

    // Resetting store allows quota again
    resetQuotaStoreForTests();
    const checkAfterReset = checkWorkspaceQuota(wsId, 10);
    assert.equal(checkAfterReset.allowed, true);
  });
});
