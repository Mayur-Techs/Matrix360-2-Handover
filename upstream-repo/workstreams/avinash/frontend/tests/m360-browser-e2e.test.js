'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const creativeIntegrated = require('../api/creative-integrated');

function makeRequest(handler, reqOptions) {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const res = {
      statusCode: 200,
      setHeader(k, v) { headers.set(k.toLowerCase(), v); },
      getHeader(k) { return headers.get(k.toLowerCase()); },
      removeHeader(k) { headers.delete(k.toLowerCase()); },
      end(chunk) {
        this.body = chunk ? (Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)) : '';
        resolve({
          statusCode: this.statusCode,
          headers: Object.fromEntries(headers),
          body: this.body
        });
      }
    };

    try {
      handler(reqOptions, res);
    } catch (err) {
      reject(err);
    }
  });
}

test('Stage 2 E2E: Main Dashboard serves with HTTP 200 and wires all marketing action buttons', async () => {
  const res = await makeRequest(creativeIntegrated, {
    method: 'GET',
    query: { mode: 'dashboard' }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes('<!doctype html>'), 'Must serve HTML document');
  
  // Header Action Group
  assert.ok(res.body.includes('id="m360-header-marketing-actions"'), 'Must contain header action buttons group');
  assert.ok(res.body.includes('href="whatsapp-onboarding.html"'), 'Header must contain WhatsApp onboarding link');
  assert.ok(res.body.includes('href="whatsapp-status.html"'), 'Header must contain WhatsApp status link');
  assert.ok(res.body.includes('href="email-status.html"'), 'Header must contain Email Setup link');
  assert.ok(res.body.includes('href="analytics-dashboard.html"'), 'Header must contain Analytics link');
  assert.ok(res.body.includes('href="pilot.html"'), 'Header must contain Campaigns / Pilot link');

  // Sidebar Navigation Links
  assert.ok(res.body.includes('id="nav-whatsapp"'), 'Sidebar nav must contain WhatsApp link');
  assert.ok(res.body.includes('id="nav-email"'), 'Sidebar nav must contain Email link');
  assert.ok(res.body.includes('id="nav-analytics"'), 'Sidebar nav must contain Analytics link');
  assert.ok(res.body.includes('id="nav-pilot"'), 'Sidebar nav must contain Pilot link');

  // Services Cards
  assert.ok(res.body.includes('id="services-whatsapp-link"'), 'Services must contain WhatsApp card');
  assert.ok(res.body.includes('id="services-email-link"'), 'Services must contain Email card');
  assert.ok(res.body.includes('id="services-analytics-link"'), 'Services must contain Analytics card');
  assert.ok(res.body.includes('id="services-pilot-link"'), 'Services must contain Pilot card');
});

test('Stage 2 E2E: All 5 marketing subpages resolve with HTTP 200 and zero 404 errors', async () => {
  const pages = [
    { file: 'whatsapp-onboarding.html', expectedTitle: 'Connect WhatsApp Business' },
    { file: 'whatsapp-status.html', expectedTitle: 'WhatsApp Business Status' },
    { file: 'email-status.html', expectedTitle: 'Email Sender' },
    { file: 'analytics-dashboard.html', expectedTitle: 'Cross-Channel Analytics' },
    { file: 'pilot.html', expectedTitle: 'Guided One-Client Pilot Flow' }
  ];

  for (const p of pages) {
    const res = await makeRequest(creativeIntegrated, {
      method: 'GET',
      query: { mode: 'page', file: p.file }
    });

    assert.equal(res.statusCode, 200, `Page ${p.file} must resolve with HTTP 200`);
    assert.ok(!res.body.includes('Unknown page'), `Page ${p.file} must not return Unknown page`);
    assert.ok(res.body.includes(p.expectedTitle), `Page ${p.file} must contain title ${p.expectedTitle}`);
  }
});

test('Stage 2 E2E: Every marketing subpage contains a functional Back to Dashboard navigation link', async () => {
  const pages = [
    'whatsapp-onboarding.html',
    'whatsapp-status.html',
    'email-status.html',
    'analytics-dashboard.html',
    'pilot.html'
  ];

  for (const page of pages) {
    const res = await makeRequest(creativeIntegrated, {
      method: 'GET',
      query: { mode: 'page', file: page }
    });

    assert.equal(res.statusCode, 200);
    assert.ok(
      res.body.includes('href="client-dashboard.html"'),
      `Page ${page} must contain a back link to client-dashboard.html`
    );
    assert.ok(
      res.body.includes('Back to Dashboard'),
      `Page ${page} must display "Back to Dashboard" anchor text`
    );
  }
});

test('Stage 2 E2E: Primary action buttons and API handlers exist on all 5 subpages', async () => {
  // 1. WhatsApp Onboarding
  const waOnboarding = await makeRequest(creativeIntegrated, {
    method: 'GET',
    query: { mode: 'page', file: 'whatsapp-onboarding.html' }
  });
  assert.ok(waOnboarding.body.includes('id="connectBtn"'), 'Must have connectBtn');
  assert.ok(waOnboarding.body.includes('/api/marketing/whatsapp/onboarding/config'), 'Must query onboarding config');
  assert.ok(waOnboarding.body.includes('/api/marketing/whatsapp/onboarding/exchange'), 'Must call token exchange');

  // 2. WhatsApp Status
  const waStatus = await makeRequest(creativeIntegrated, {
    method: 'GET',
    query: { mode: 'page', file: 'whatsapp-status.html' }
  });
  assert.ok(waStatus.body.includes('id="sendTestBtn"'), 'Must have sendTestBtn');
  assert.ok(waStatus.body.includes('/api/marketing/whatsapp/onboarding/test-send'), 'Must call test-send endpoint');

  // 3. Email Status
  const emailStatus = await makeRequest(creativeIntegrated, {
    method: 'GET',
    query: { mode: 'page', file: 'email-status.html' }
  });
  assert.ok(emailStatus.body.includes('id="btn-recheck-dns"'), 'Must have btn-recheck-dns');
  assert.ok(emailStatus.body.includes('id="btn-send-test"'), 'Must have btn-send-test');
  assert.ok(emailStatus.body.includes('action=email/dns/check'), 'Must check email DNS status');
  assert.ok(emailStatus.body.includes('action=email/test-send'), 'Must call email send-test');

  // 4. Analytics Dashboard
  const analytics = await makeRequest(creativeIntegrated, {
    method: 'GET',
    query: { mode: 'page', file: 'analytics-dashboard.html' }
  });
  assert.ok(analytics.body.includes('id="btn-refresh"'), 'Must have btn-refresh');
  assert.ok(analytics.body.includes('id="btn-export-csv"'), 'Must have btn-export-csv');
  assert.ok(analytics.body.includes('action=analytics'), 'Must fetch real analytics telemetry');

  // 5. Pilot
  const pilot = await makeRequest(creativeIntegrated, {
    method: 'GET',
    query: { mode: 'page', file: 'pilot.html' }
  });
  assert.ok(pilot.body.includes('id="btn-approve"'), 'Must have btn-approve');
  assert.ok(pilot.body.includes('id="btn-dispatch"'), 'Must have btn-dispatch');
});

test('Stage 2 E2E: Empty state telemetry renders honest zeros without simulated filler', async () => {
  const analytics = await makeRequest(creativeIntegrated, {
    method: 'GET',
    query: { mode: 'page', file: 'analytics-dashboard.html' }
  });

  // Verify empty state container and truthful copy
  assert.ok(analytics.body.includes('No campaigns sent yet. Metrics will appear after your first dispatch.'), 'Must state no campaigns sent yet');
  assert.ok(analytics.body.includes('Matrix360 shows real delivery telemetry directly from Meta WhatsApp and Brevo Email webhooks. No simulated numbers or placeholder graphs.'), 'Must declare no simulated numbers or placeholder graphs');
  assert.ok(analytics.body.includes('System Status: Ready for Dispatch'), 'Must indicate real system readiness');
  
  // Verify no fake random filler generator exists in product scripts
  assert.ok(!analytics.body.includes('Math.random() * 1000'), 'Must never generate random fake analytics');
  assert.ok(!analytics.body.includes('Math.random()'), 'Zero random math anywhere in analytics');
});

test('Stage 2 E2E: Unauthorized/unknown page requests return strict 404', async () => {
  const res = await makeRequest(creativeIntegrated, {
    method: 'GET',
    query: { mode: 'page', file: 'secret-backdoor.html' }
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body, 'Unknown page');
});
