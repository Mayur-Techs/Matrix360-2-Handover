'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const orchestrator = require('../lib/m360-marketing-orchestrator');
const permissions = require('../lib/m360-permissions');

describe('Stage 5 (P1 & P2): Verify-then-Save Providers & Honest WhatsApp States', () => {
  it('RBAC: sales_operator cannot configure providers; client_admin and platform_owner can', () => {
    assert.equal(permissions.hasPermission('sales_operator', 'configure_provider'), false, 'sales_operator cannot configure providers');
    assert.equal(permissions.hasPermission('marketing_operator', 'configure_provider'), false, 'marketing_operator cannot configure providers');
    assert.equal(permissions.hasPermission('viewer', 'configure_provider'), false, 'viewer cannot configure providers');
    assert.equal(permissions.hasPermission('client_admin', 'configure_provider'), true, 'client_admin can configure providers');
    assert.equal(permissions.hasPermission('platform_owner', 'configure_provider'), true, 'platform_owner can configure providers');
  });

  it('WhatsApp provider verification with invalid credentials leaves gate3 false and returns unverified', async () => {
    const wsId = randomUUID();
    const badVerify = await orchestrator.verifyMarketingProvider('whatsapp', {
      workspaceId: wsId,
      token: 'invalid_token',
      phoneNumberId: 'invalid_phone_id',
      wabaId: 'invalid_waba_id'
    });

    assert.equal(badVerify.verified, false, 'Invalid credentials must fail verification');

    // Create a task with creativePlan so channel_draft_versions are populated
    const envelope = orchestrator.createHandoverEnvelope({
      workspace_id: wsId,
      correlation_id: randomUUID(),
      business_profile_ref: 'lakhotia',
      requested_outcome: 'qualified_enquiries',
      payload: { business_name: 'Lakhotia Industrial Park', project: 'lakhotia' }
    });
    const task = await orchestrator.dispatchMarketingTask(envelope, {
      waitForDraft: true,
      keylessTestMode: true,
      creativePlan: {
        verified_content_task_id: randomUUID(),
        status: 'completed',
        test_data: true,
        artifact_refs: [{ id: 'art-1', kind: 'image' }]
      }
    });

    // When configured with bad verifyResult, gate3_provider remains passed = false
    orchestrator.configureMarketingProvider(wsId, 'whatsapp', {
      token: 'invalid_token',
      phoneNumberId: 'invalid_phone_id'
    }, badVerify);

    const updatedTask = orchestrator.getMarketingTask(wsId, task.correlation_id);
    const gate3 = (updatedTask.channel_readiness.WhatsApp || updatedTask.channel_readiness.whatsapp).gates.gate3_provider;
    assert.equal(gate3.passed, false, 'gate3_provider must remain passed=false on failed verification');
    assert.equal(gate3.status, 'unverified', 'gate3_provider status must be unverified');
  });

  it('Managed WhatsApp mode returns onboarding status, never verified: true', async () => {
    const wsId = randomUUID();
    const configResult = orchestrator.configureMarketingProvider(wsId, 'whatsapp', {
      mode: 'managed_concierge',
      business_name: 'Test Estate',
      reply_phone: '+919830099999',
      onboarding_step: 'awaiting_client_login'
    });

    assert.equal(configResult.provider, 'whatsapp');
    assert.equal(configResult.mode, 'managed_concierge');

    const verifyCheck = await orchestrator.verifyMarketingProvider('whatsapp', {
      workspaceId: wsId,
      mode: 'managed_concierge'
    });

    assert.equal(verifyCheck.verified, false, 'Managed mode must NOT be verified: true');
    assert.equal(verifyCheck.status, 'onboarding_in_progress');
    assert.equal(verifyCheck.whatsapp_onboarding, 'awaiting_client_login');
    assert.equal(orchestrator.WHATSAPP_ONBOARDING_STATES.includes(verifyCheck.whatsapp_onboarding), true);
  });

  it('All valid onboarding state machine transitions exist in WHATSAPP_ONBOARDING_STATES', () => {
    const expected = [
      'not_started',
      'awaiting_client_login',
      'number_registering',
      'templates_in_review',
      'ready_limited',
      'verified',
      'needs_attention'
    ];
    assert.deepEqual(orchestrator.WHATSAPP_ONBOARDING_STATES, expected);
  });
});
