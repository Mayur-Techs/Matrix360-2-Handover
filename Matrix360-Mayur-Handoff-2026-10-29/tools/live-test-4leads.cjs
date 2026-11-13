'use strict';

const path = require('node:path');
const fs = require('node:fs');

// 1. Load .env.local
const root = path.resolve(__dirname, '../workstreams/avinash/frontend');
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

process.env.MARKETING_LIVE_SEND_ENABLED = 'true';
process.env.MARKETING_ALLOWED_EMAILS = '*';
process.env.MARKETING_ALLOWED_RECIPIENT_MODE = 'all';

const orchestrator = require('../workstreams/avinash/frontend/lib/m360-marketing-orchestrator');

const { randomUUID } = require('node:crypto');

async function run() {
  console.log('1. Initializing campaign task for real 4-lead sample group...');
  const workspaceId = 'showcase';
  const correlationId = randomUUID();

  const envelope = orchestrator.createHandoverEnvelope({
    workspace_id: workspaceId,
    correlation_id: correlationId,
    origin_module: 'marketing',
    target_engine: 'marketing',
    payload: {
      prompt: 'Send personalized non-promotional executive briefing to eligible prospects',
      business_name: 'Matrix 360',
      project: 'Commercial Marketing AI',
      profile_type: 'b2b_industrial'
    }
  });

  const task = await orchestrator.dispatchMarketingTask(envelope, {
    waitForDraft: true,
    keylessTestMode: false,
    creativePlan: {
      subject: 'Strategic Discussion — Commercial Pipeline Alignment with Matrix 360',
      caption: 'Direct executive briefing regarding autonomous growth architecture.',
      cta: 'Reply to this email'
    }
  });

  console.log('Task dispatched:', task.correlation_id);

  // 2. Define the 4 leads with distinct names, titles, and companies
  const leads = [
    {
      id: 'lead-mayur-1',
      name: 'Mayur Nikumbh',
      email: 'mayurnn.12@gmail.com',
      company_name: 'Nikumbh Technologies',
      title: 'Founder & CEO',
      phone: '+919820011221',
      segment: 'AI & Enterprise Software',
      email_opt_in_status: 'granted',
      consent_evidence: { email: true, source: 'lead_generator_verified', timestamp: new Date().toISOString() }
    },
    {
      id: 'lead-mayur-2',
      name: 'M. R. Nikumbh',
      email: 'nikumbhmayur4@gmail.com',
      company_name: 'Apex Industrial Systems',
      title: 'Managing Director',
      phone: '+919820033442',
      segment: 'Manufacturing & Industrial Operations',
      email_opt_in_status: 'granted',
      consent_evidence: { email: true, source: 'lead_generator_verified', timestamp: new Date().toISOString() }
    },
    {
      id: 'lead-alok-3',
      name: 'Alok Sharma',
      email: 'altufaltu1027@gmail.com',
      company_name: 'Horizon Dynamics',
      title: 'Head of Strategic Growth',
      phone: '+919820055663',
      segment: 'Commercial Partnerships',
      email_opt_in_status: 'granted',
      consent_evidence: { email: true, source: 'lead_generator_verified', timestamp: new Date().toISOString() }
    },
    {
      id: 'lead-matrix-4',
      name: 'Consulting Review Desk',
      email: 'matrix360consulting@gmail.com',
      company_name: 'Matrix 360 Strategic Group',
      title: 'Principal Strategy Lead',
      phone: '+919820077884',
      segment: 'Revenue Operations & Governance',
      email_opt_in_status: 'granted',
      consent_evidence: { email: true, source: 'lead_generator_verified', timestamp: new Date().toISOString() }
    }
  ];

  console.log('2. Ingesting 4 leads into campaign audience...');
  orchestrator.importLeadsToTask(workspaceId, correlationId, leads, { testData: false });

  // 3. Set the clean, non-promotional, personalized email copy
  const emailDraft = task.channel_draft_versions.Email.versions.at(-1);
  emailDraft.subject = 'Strategic Discussion regarding {{company}} — Collaboration with Matrix 360';
  emailDraft.non_promotional = true;
  emailDraft.preview_text = ''; // omit promotional preview text div
  emailDraft.body = [
    'Hi {{first_name}},',
    '',
    'I am writing to you directly regarding your commercial operations and client pipeline strategy at {{company}}.',
    '',
    'As {{title}}, you understand the operational friction of coordinating lead discovery, multi-channel outreach, and pipeline tracking across disconnected systems.',
    '',
    'Over the past few months, we have developed Matrix 360 to unify these functions into a single autonomous workflow:',
    '• Decision-Maker Discovery: Identifying verified prospective partners with validated contact records.',
    '• Coordinated Outreach: Executing personalized communication across Email, WhatsApp, and Social platforms with zero manual entry.',
    '• Real-Time Pipeline Synchronization: Binding provider delivery receipts directly to CRM lifecycle stages.',
    '',
    'Given {{company}}\'s focus, I wanted to share this overview to see whether our architecture could support your growth priorities this quarter.',
    '',
    'If you are open to a brief 10-minute introductory conversation next week, please reply directly to this email with a time that works for you.',
    '',
    'Best regards,',
    '',
    'Mayur Nikumbh',
    'Matrix 360 Executive Team',
    'matrix360consulting@gmail.com'
  ].join('\n');

  // Re-hash and finalize draft version
  const { finalizeDraftVersion } = require('../workstreams/avinash/frontend/lib/m360-channel-versioner');
  finalizeDraftVersion(emailDraft, emailDraft.body, { non_promotional: true });

  console.log('3. Approving Email draft (Gate 1)...');
  orchestrator.approveChannelDraft(workspaceId, correlationId, 'Email', emailDraft.version_hash, {
    role: 'marketing_operator',
    id: 'mayur_operator'
  });

  console.log('4. Checking readiness gates...');
  const readiness = task.channel_readiness.Email;
  console.log('Gate 1 (Draft Approval):', readiness.gates.gate1_draft.passed, readiness.gates.gate1_draft.status);
  console.log('Gate 2 (Audience Eligibility):', readiness.gates.gate2_audience.passed, 'Eligible count:', readiness.gates.gate2_audience.eligible_count);
  console.log('Gate 3 (Provider Connection):', readiness.gates.gate3_provider.passed, readiness.gates.gate3_provider.status);

  console.log('5. Executing live Brevo SMTP dispatch to all 4 recipients...');
  const result = await orchestrator.executeMarketingChannel(workspaceId, correlationId, 'Email', {
    mode: 'live',
    operatorApproved: true,
    approvalPhrase: 'SEND_APPROVED_EMAIL_CAMPAIGN',
    versionHash: emailDraft.version_hash
  });

  console.log('------------------------------------------------------------');
  console.log('EXECUTION RESULT:');
  console.log('Status:', result.status);
  console.log('Sent:', result.sent);
  console.log('Recipient Count:', result.recipient_count);
  console.log('Individual Deliveries:');
  for (const exec of result.executions) {
    console.log(`• Message ID: ${exec.provider_message_ids[0]} | Provider: ${exec.provider} | Status: ${exec.status}`);
  }
  console.log('------------------------------------------------------------');

  // Save to disk
  orchestrator.saveTasksToDisk();
  console.log('Task saved to disk successfully.');
}

run().catch(err => {
  console.error('Execution failed:', err);
  process.exitCode = 1;
});
