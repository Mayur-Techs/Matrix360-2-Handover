const fs = require('fs');
const path = require('path');

const testPath = path.join(__dirname, '../workstreams/avinash/frontend/tests/marketing-engine.test.js');
let content = fs.readFileSync(testPath, 'utf8');

const newTest = `
test('Marketing engine test-preview mode produces verified WhatsApp click-to-chat URL while live execute fails closed', async () => {
  const dispatchReq = mockHttp('POST', '/api/marketing/dispatch', {
    workspace_id: 'ws-e2e-test',
    prompt: 'Launch a campaign for Shree Heights.'
  });
  await marketingApi(dispatchReq.req, dispatchReq.res);
  assert.equal(dispatchReq.get().status, 202);
  const corrId = dispatchReq.get().data.correlation_id;
  await new Promise(r => setTimeout(r, 60));

  const task = orchestrator.getMarketingTask('ws-e2e-test', corrId);
  assert.ok(task);
  const curVer = task.channel_draft_versions.WhatsApp.versions[0];

  // Gate 1: Approve draft
  orchestrator.approveChannelDraft('ws-e2e-test', corrId, 'WhatsApp', curVer.version_hash, 'client_admin');

  // Test preview execution returns real Click-to-Chat URL
  const previewResult = await orchestrator.executeMarketingChannel('ws-e2e-test', corrId, 'WhatsApp', { mode: 'test_preview' });
  assert.equal(previewResult.status, 'test_preview_ready');
  assert.equal(previewResult.channel, 'WhatsApp');
  assert.ok(previewResult.test_url.startsWith('https://wa.me/?text='));

  // Live execution without adapter still fails closed
  await assert.rejects(async () => {
    await orchestrator.executeMarketingChannel('ws-e2e-test', corrId, 'WhatsApp', { mode: 'live' });
  }, (err) => {
    assert.strictEqual(err.code, 'PROVIDER_ADAPTER_NOT_IMPLEMENTED');
    return true;
  });
});

test.after(() => { global.fetch = originalFetch; });`;

if (!content.includes('Marketing engine test-preview mode produces verified WhatsApp click-to-chat URL')) {
  content = content.replace('test.after(() => { global.fetch = originalFetch; });', newTest);
  fs.writeFileSync(testPath, content, 'utf8');
  console.log('Successfully added test to marketing-engine.test.js');
} else {
  console.log('Test already present');
}
