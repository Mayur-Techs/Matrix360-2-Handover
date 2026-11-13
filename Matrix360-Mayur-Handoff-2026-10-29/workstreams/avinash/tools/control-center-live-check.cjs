'use strict';
// Live model probe with synthetic CRM membership. Never use this fixture to serve the application.
const fs = require('node:fs'), path = require('node:path');
if (!process.argv.includes('--live')) throw Error('Pass --live for five live acceptance requests.');
if (!process.env.OPENAI_API_KEY || !process.env.M360_CONTROL_CENTER_MODEL) throw Error('Key and dedicated model required.');
const originalFetch = global.fetch, originalInfo = console.info, audit = [];
console.info = value => audit.push(JSON.parse(value));
process.env.M360_AI_TRIAL_SUPABASE_SERVICE_KEY = '';
const handler = require('../frontend/api/control-center');
const cases = [
  ['Find manufacturers in Pune.', 'lead_pipeline'],
  ['Create a Diwali campaign for our residential project.', 'content_creation'],
  ['Plan WhatsApp and LinkedIn outreach.', 'marketing_activation'],
  ['Which market should we enter next?', 'business_strategy'],
  ['Find prospects, create a campaign and plan outreach.', 'multi_engine']
];
global.fetch = async (url, options) => {
  if (url === 'https://matrix360-crm-backend-p9os.onrender.com/me/workspaces') {
    if (options.headers.Authorization !== 'Bearer synthetic-acceptance-session') throw Error('Unexpected synthetic auth');
    return {ok:true, status:200, json:async () => [{id:'synthetic-acceptance', name:'Synthetic acceptance business', role:'client_admin', approved_facts:[
      'Synthetic test only: this fictional company develops residential property in Pune.',
      'Its fictional objective is to find suppliers, attract homebuyers and evaluate expansion into Mumbai or Bengaluru.',
      'Its fictional campaign audience is salaried homebuyers, using WhatsApp and LinkedIn.',
      'No real pipeline, budget, customer information or operational results are supplied.'
    ]}]};
  }
  if (url !== 'https://api.openai.com/v1/responses') throw Error('Unexpected acceptance destination');
  return originalFetch(url, options);
};
(async () => {
  const results = [];
  try {
    for (const [message, expected] of cases) {
      const res = {setHeader(){}, end(text){this.data = JSON.parse(text);}};
      await handler({method:'POST', headers:{authorization:'Bearer synthetic-acceptance-session'}, body:{message, workspace_id:'synthetic-acceptance', requested_mode:'auto', page_context:'overview'}}, res);
      const actual = res.data.category || null, passed = res.statusCode === 200 && actual === expected;
      results.push({message, expected, actual, http_status:res.statusCode, passed, response:res.data});
      originalInfo(JSON.stringify({expected, actual, http_status:res.statusCode, passed}));
    }
    fs.writeFileSync(path.resolve(__dirname, '../../../artifacts/control-center-verification/live-routing.json'), JSON.stringify({test_type:'live_model_synthetic_context', model:process.env.M360_CONTROL_CENTER_MODEL, created_at:new Date().toISOString(), results, audit}, null, 2));
    originalInfo('Saved synthetic live-model routing report.');
    if (results.some(result => !result.passed)) process.exitCode = 1;
  } finally { global.fetch = originalFetch; console.info = originalInfo; }
})().catch(() => { originalInfo('Live probe failed; credentials and provider bodies are not printed.'); process.exitCode = 1; });
