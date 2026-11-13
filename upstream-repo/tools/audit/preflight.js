#!/usr/bin/env node
'use strict';

/**
 * Matrix360 Phase 6: Go-Live Preflight CLI
 *
 * Runs honest real-world integration checks across Supabase, Vault, Meta WhatsApp, Brevo, LLM, and Webhooks.
 * Prints a clean PASS / FAIL / NOT-CONFIGURED table.
 * Never prints secrets.
 */

const fs = require('node:fs');
const path = require('node:path');

// Auto-load .env.local if present
function loadEnv() {
  const candidates = [
    path.resolve(__dirname, '../../workstreams/avinash/frontend/.env.local'),
    path.resolve(__dirname, '../../.env.local'),
    path.resolve(__dirname, '../.env.local'),
    path.resolve(process.cwd(), '.env.local')
  ];

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const k = trimmed.substring(0, eqIdx).trim();
          let v = trimmed.substring(eqIdx + 1).trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (!process.env[k]) {
            process.env[k] = v;
          }
        }
      }
    }
  }
}
loadEnv();

const { runPreflightChecks } = require(path.join(__dirname, '../../workstreams/avinash/frontend/lib/m360-preflight.js'));

async function main() {
  console.log('========================================================================================');
  console.log('Matrix360 Phase 6: Production Go-Live Preflight Check');
  console.log('========================================================================================\n');

  const checks = await runPreflightChecks();

  console.log('| # | Integration     | Status         | Diagnostics / Action Required                            |');
  console.log('|:-:| :-------------- | :------------- | :------------------------------------------------------- |');

  checks.forEach((c, idx) => {
    const num = String(idx + 1);
    const svc = c.service.padEnd(14, ' ');
    let stTag = '';
    if (c.status === 'PASS') stTag = '✅ PASS          ';
    else if (c.status === 'FAIL') stTag = '❌ FAIL          ';
    else stTag = '⚠️ NOT-CONFIGURED';

    const diag = c.status === 'PASS' ? c.message : (c.fix ? `${c.message} Fix: ${c.fix}` : c.message);
    console.log(`| ${num} | ${svc} | ${stTag} | ${diag} |`);
  });

  console.log('\n========================================================================================');
  const passCount = checks.filter(c => c.status === 'PASS').length;
  const notConfiguredCount = checks.filter(c => c.status === 'NOT-CONFIGURED').length;
  const failCount = checks.filter(c => c.status === 'FAIL').length;

  console.log(`Summary: ${passCount} PASS | ${notConfiguredCount} NOT-CONFIGURED | ${failCount} FAIL`);
  if (failCount > 0) {
    console.log('⚠️ One or more configured integrations failed validation.');
  } else if (notConfiguredCount > 0) {
    console.log('ℹ️ Engine ready in safe draft/local mode. Missing providers marked NOT-CONFIGURED.');
  } else {
    console.log('🚀 ALL INTEGRATIONS CONFIGURED AND VERIFIED FOR PRODUCTION.');
  }
  console.log('========================================================================================\n');

  return checks;
}

if (require.main === module) {
  main().catch(err => {
    console.error('Preflight execution error:', err);
    process.exit(1);
  });
}

module.exports = { main };
