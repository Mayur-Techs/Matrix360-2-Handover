// This harness MUST execute the handler. Grep/string-matching the source is forbidden.
'use strict';

/**
 * Matrix360 Permanent Behavioural Exploit Suite
 * Turn each audit check into a permanent regression test executing real handlers.
 * 
 * Covers all 13 Phase 2 trust rails (E1-M1), 5 Phase 3 WhatsApp Go-Live rails (WG1-WG5),
 * and 6 Phase 5 Email & AI Campaign Assistant rails (EM1-EM3, AI1-AI3) - Total 24 checks.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runAudit } = require('../../../../tools/audit/exploits');

describe('Stage 7: Behavioural Exploit Audit Suite (All 24 Checks)', () => {
  it('executes all 24 checks against real handlers and confirms 24/24 NOT REPRODUCED', async () => {
    const results = await runAudit();
    const checks = [
      'E1', 'E2', 'W1', 'W2', 'C1', 'C2', 'V1', 'P1', 'P2', 'X1', 'S1', 'R1', 'M1',
      'WG1', 'WG2', 'WG3', 'WG4', 'WG5',
      'EM1', 'EM2', 'EM3', 'AI1', 'AI2', 'AI3'
    ];
    for (const c of checks) {
      assert.equal(results[c], 'NOT REPRODUCED', `Check ${c} must be NOT REPRODUCED via real execution`);
    }
  });

  it('WG1: exchange failure holds state and surfaces real error', async () => {
    const results = await runAudit();
    assert.equal(results['WG1'], 'NOT REPRODUCED');
  });

  it('WG2: registration and subscription must both confirm before state advances', async () => {
    const results = await runAudit();
    assert.equal(results['WG2'], 'NOT REPRODUCED');
  });

  it('WG3: a PENDING or REJECTED template cannot be used to live send', async () => {
    const results = await runAudit();
    assert.equal(results['WG3'], 'NOT REPRODUCED');
  });

  it('WG4: onboarding reaches ready ONLY after webhook-confirmed test delivery; missing ID is NO_PROVIDER_ID', async () => {
    const results = await runAudit();
    assert.equal(results['WG4'], 'NOT REPRODUCED');
  });

  it('WG5: two clients WABAs stay isolated — status callback for client A never alters client B', async () => {
    const results = await runAudit();
    assert.equal(results['WG5'], 'NOT REPRODUCED');
  });

  it('EM1: email broadcast sends only to consented, non-suppressed recipients with unsubscribe and compliance headers', async () => {
    const results = await runAudit();
    assert.equal(results['EM1'], 'NOT REPRODUCED');
  });

  it('EM2: email sender state reaches ready only upon webhook confirmation; complaint rate > 0.3% pauses sending', async () => {
    const results = await runAudit();
    assert.equal(results['EM2'], 'NOT REPRODUCED');
  });

  it('EM3: bulk email broadcast (>5,000) blocked when SPF/DKIM/DMARC unaligned', async () => {
    const results = await runAudit();
    assert.equal(results['EM3'], 'NOT REPRODUCED');
  });

  it('AI1: AI campaign assistant never sends messages, never invents contacts/consent, halts at approval gate', async () => {
    const results = await runAudit();
    assert.equal(results['AI1'], 'NOT REPRODUCED');
  });

  it('AI2: AI content agent with unconfigured LLM returns NO_MODEL_CONFIGURED with zero fabricated copy', async () => {
    const results = await runAudit();
    assert.equal(results['AI2'], 'NOT REPRODUCED');
  });

  it('AI3: external_send and spend tools refused without server-verified human approval ID', async () => {
    const results = await runAudit();
    assert.equal(results['AI3'], 'NOT REPRODUCED');
  });
});
