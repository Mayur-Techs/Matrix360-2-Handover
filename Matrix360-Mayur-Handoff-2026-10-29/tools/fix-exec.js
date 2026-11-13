const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '../workstreams/avinash/frontend/lib/m360-marketing-orchestrator.js');
let content = fs.readFileSync(targetPath, 'utf8');

const oldFnStart = `async function executeMarketingChannel(workspaceId, correlationId, channel) {`;
const oldFnBody = `  const task = getMarketingTask(workspaceId, correlationId);
  if (!task) throw new Error('Task not found');
  if (!task.channel_readiness?.[channel]) throw new Error(\`Channel \${channel} not found in readiness checklist\`);

  const readiness = task.channel_readiness[channel];
  const g1 = readiness.gates.gate1_draft;
  const g2 = readiness.gates.gate2_audience;
  const g3 = readiness.gates.gate3_provider;

  if (!g1.passed) {
    const err = new Error(\`Gate 1 Blocked: Editorial approval required for \${channel} before launch.\`);
    err.code = 'GATE_1_BLOCKED';
    throw err;
  }
  if (!g2.passed || g2.eligible_count <= 0) {
    const err = new Error(\`Gate 2 Blocked: No eligible contacts with verified consent found for \${channel}.\`);
    err.code = 'GATE_2_BLOCKED';
    throw err;
  }
  if (!g3.passed) {
    const err = new Error(\`Gate 3 Blocked: \${g3.message || 'Provider connection not verified.'}\`);
    err.code = 'GATE_3_BLOCKED';
    throw err;
  }`;

const newFn = `async function executeMarketingChannel(workspaceId, correlationId, channel, options = {}) {
  const task = getMarketingTask(workspaceId, correlationId);
  if (!task) throw new Error('Task not found');
  if (!task.channel_readiness?.[channel]) throw new Error(\`Channel \${channel} not found in readiness checklist\`);

  const readiness = task.channel_readiness[channel];
  const g1 = readiness.gates.gate1_draft;
  const g2 = readiness.gates.gate2_audience;
  const g3 = readiness.gates.gate3_provider;

  if (!g1.passed) {
    const err = new Error(\`Gate 1 Blocked: Editorial approval required for \${channel} before launch.\`);
    err.code = 'GATE_1_BLOCKED';
    throw err;
  }

  // Test preview mode support for verified client testing
  if (options.mode === 'test_preview') {
    const curDraft = task.channel_draft_versions[channel]?.versions?.slice(-1)[0];
    const draftText = curDraft?.body || '';
    if (channel === 'WhatsApp') {
      const waUrl = \`https://wa.me/?text=\${encodeURIComponent(draftText)}\`;
      return {
        correlation_id: task.correlation_id,
        channel,
        status: 'test_preview_ready',
        provider: 'WHATSAPP_WEB_CLICK_TO_CHAT',
        test_url: waUrl,
        message: 'WhatsApp draft prepared. Open test URL to review and send from WhatsApp Web or Mobile.'
      };
    } else if (channel === 'Email') {
      return {
        correlation_id: task.correlation_id,
        channel,
        status: 'test_preview_ready',
        provider: 'EMAIL_TEST_PREVIEW',
        recipient: options.test_recipient_email || 'client@example.com',
        subject: curDraft?.subject || '',
        message: 'Email test preview prepared for human verification.'
      };
    }
  }

  if (!g2.passed || g2.eligible_count <= 0) {
    const err = new Error(\`Gate 2 Blocked: No eligible contacts with verified consent found for \${channel}.\`);
    err.code = 'GATE_2_BLOCKED';
    throw err;
  }
  if (!g3.passed) {
    const err = new Error(\`Gate 3 Blocked: \${g3.message || 'Provider connection not verified.'}\`);
    err.code = 'GATE_3_BLOCKED';
    throw err;
  }`;

if (content.includes(oldFnStart)) {
  content = content.replace(oldFnStart + '\n' + oldFnBody, newFn);
  fs.writeFileSync(targetPath, content, 'utf8');
  console.log('Successfully updated executeMarketingChannel');
} else {
  console.error('Could not find executeMarketingChannel signature');
  process.exit(1);
}
