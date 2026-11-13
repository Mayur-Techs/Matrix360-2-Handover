'use strict';
// Offline browser fixture. Never deploy this server or use real credentials here.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../frontend');
if(!process.argv.includes('--fixtures'))throw Error('Explicit --fixtures is required.');
process.env.M360_CONTROL_CENTER_ENABLED='true';process.env.M360_CONTROL_CENTER_MODEL='offline-fixture';
process.env.OPENAI_API_KEY='offline-test-key-not-a-real-secret-0000';delete process.env.M360_AI_TRIAL_SUPABASE_SERVICE_KEY;
const handler=require('../frontend/api/control-center');
function sample(s){if(s.type==='object')return Object.fromEntries(Object.entries(s.properties).map(([k,v])=>[k,sample(v)]));if(s.type==='array')return [];if(s.type==='boolean')return false;return s.enum?.[0]||'';}
global.fetch=async(url,options)=>{
 if(url.endsWith('/me/workspaces'))return {status:200,ok:true,json:async()=>[{id:'fixture-a',name:'Fixture Business A',role:'client_admin',approved_facts:['This is synthetic test data.']},{id:'fixture-b',name:'Fixture Business B',role:'client_admin',approved_facts:[]}]};
 if(url!=='https://api.openai.com/v1/responses')throw Error('Outbound network disabled in fixture server');
 const request=JSON.parse(options.body),input=JSON.parse(request.input[1].content[0].text),prompt=input.prompt;
 if(prompt.includes('[network]'))throw Error('Synthetic network failure');
 if(prompt.includes('[timeout]'))throw Object.assign(Error('timeout'),{name:'TimeoutError'});
 if(prompt.includes('[rate]'))return {ok:false,status:429};
 const value=sample(request.text.format.schema);
 const engine=/outreach|WhatsApp|LinkedIn/i.test(prompt)?'marketing_activation':/content|campaign|Diwali/i.test(prompt)?'content_creation':'lead_pipeline';
 value.category=/market should|decide|prioritize/i.test(prompt)?'business_strategy':engine;
 value.response_type=value.category==='business_strategy'?'strategy':'handover';
 value.answer='Fixture analysis only. Objective: '+prompt;
 value.facts_used=['This is synthetic test data.','A model inference is not a verified fact.'];
 value.assumptions=['Budget and deadline have not been supplied.'];
 value.strategic_insight='Review audience fit before committing resources.';
 value.options=[{name:'Run a focused pilot',benefits:['Limits initial effort'],risks:['Small sample'],cost_implication:'Client budget decision required',time_implication:'Agree a deadline before execution'}];
 value.recommendation={summary:'Review a focused pilot.',rationale:'Validate the audience before scaling.',confidence:'low'};
 const workflow=/prospects.*campaign.*outreach|coordinated/i.test(prompt)?['lead_pipeline','content_creation','marketing_activation']:[engine];
 if(workflow.length>1)value.category='multi_engine';
 value.engine_handover={required:value.category!=='business_strategy',primary_engine:workflow[0],engine_route:'untrusted-model-route',workflow,task_title:'Fixture draft',task_summary:prompt,expected_outputs:['Reviewed specialist brief'],requires_approval:true};
 value.next_actions=['Confirm scope and review this draft.'];value.success_measures=['Client-approved pilot criteria'];
 if(prompt.includes('[slow]'))await new Promise(resolve=>setTimeout(resolve,1500));
 return {ok:true,status:200,json:async()=>({id:'offline-fixture-response',status:'completed',output:[{content:[{type:'output_text',text:prompt.includes('[invalid]')?'{}':JSON.stringify(value)}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}})};
};
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Matrix360 — OFFLINE FIXTURE</title><style>body{margin:0;font-family:Arial,sans-serif;background:#edf3f0;color:#173b31}header{padding:12px;background:#fff3cd}main{max-width:1160px;margin:auto;padding:20px}.card{padding:20px;background:white;margin:16px 0}button,select{font:inherit;padding:10px}.hidden{display:none}</style><header>OFFLINE TEST FIXTURE · Synthetic workspace · No live AI or engine execution<br><label for="workspace">Test business</label><select id="workspace"><option value="fixture-a">Fixture Business A</option><option value="fixture-b">Fixture Business B</option></select><button id="fixture-signout">End fixture session</button><button id="fixture-signin">Restore fixture session</button></header><main id="verified"><section id="overview" class="card"><h2>Supporting Overview content</h2><p>Existing functionality stays below the Control Center.</p></section><section id="leads" class="card"><h2>Lead Generation &amp; Pipeline</h2><p>Existing specialist page fixture.</p></section><section id="creative" class="card"><h2>Content Creation</h2><p>Existing specialist page fixture.</p></section><section id="marketing" class="card"><h2>Marketing Activation</h2><p>Existing specialist page fixture.</p></section></main><script>function restore(){sessionStorage.setItem('matrix360_pilot_token','offline-fixture-browser');sessionStorage.setItem('matrix360_pilot_expires_at',Date.now()+3600000)}restore();document.getElementById('fixture-signout').onclick=()=>{sessionStorage.clear();document.dispatchEvent(new Event('m360:session-ended'))};document.getElementById('fixture-signin').onclick=restore;</script><script src="/router.js"></script><script src="/control.js"></script></html>`;
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/control.js'||url.pathname==='/router.js'){
 res.setHeader('Content-Type','application/javascript');const file=url.pathname==='/control.js'?'m360-control-client.js':'m360-multipage-router.js';
 const full=path.join(root,'lib',file);delete require.cache[full];return res.end(file==='m360-control-client.js'?require(full):fs.readFileSync(full));}
 if(url.pathname==='/api/control-center'){
 let body='';for await(const chunk of req){body+=chunk;if(body.length>12000){res.statusCode=413;return res.end('{}')}}req.body=JSON.parse(body);return await handler(req,res);}
 if(url.pathname==='/favicon.ico'){res.statusCode=204;return res.end()}
 res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');return res.end(html);
 }catch{res.statusCode=500;res.end('Fixture server failure');}
});
server.listen(4317,'127.0.0.1',()=>console.log('Offline fixture: http://127.0.0.1:4317/dashboard'));
