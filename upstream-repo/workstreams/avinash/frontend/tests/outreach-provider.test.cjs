'use strict';

process.env.M360_TENANT_ENCRYPTION_KEY = process.env.M360_TENANT_ENCRYPTION_KEY || Buffer.alloc(32, 0x5a).toString('base64');

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('workspace writers can verify SMTP without acquiring approval or sending permissions',async()=>{
 const orchestratorPath=require.resolve('../lib/m360-marketing-orchestrator'),apiPath=require.resolve('../api/marketing');
 const original=require(orchestratorPath),previousApi=require.cache[apiPath],oldFetch=global.fetch;
 let role='sales_operator',calls=0,result={verified:true,status:'verified_connected'};
 require.cache[orchestratorPath].exports={...original,verifyMarketingProvider:async()=>{calls++;return result;},executeMarketingChannel:async()=>assert.fail('Verification must never execute a channel')};
 delete require.cache[apiPath];
 global.fetch=async()=>({status:200,ok:true,json:async()=>[{id:'workspace-a',role,name:'Example'}]});
 const handler=require('../api/marketing');
 async function call(action,body={},authorization='Bearer synthetic-session-token-long-enough'){
  const res={statusCode:200,setHeader(){},end(data){this.data=JSON.parse(data);}};
  await handler({method:'POST',url:'/api/marketing/'+action,headers:{authorization},body:{workspace_id:'workspace-a',provider:'email',...body},query:{}},res);
  return res;
 }
 try{
  const verified=await call('providers/verify');assert.equal(verified.statusCode,200);assert.equal(verified.data.verified,true);assert.equal(calls,1);
  for(const action of ['approve','execute'])assert.equal((await call(action)).statusCode,403);
  role='viewer';assert.equal((await call('providers/verify')).statusCode,403);
  role='sales_operator';assert.equal((await call('providers/verify',{workspace_id:'another-workspace'})).statusCode,403);
  assert.equal((await call('providers/verify',{},'')).statusCode,401);assert.equal(calls,1);
  result={verified:false,status:'configured_unverified',error:'SMTP_AUTHENTICATION_REJECTED'};
  const rejected=await call('providers/verify');assert.equal(rejected.statusCode,412);assert.equal(rejected.data.code,'SMTP_AUTHENTICATION_REJECTED');assert.equal(calls,2);
 }finally{
  require.cache[orchestratorPath].exports=original;global.fetch=oldFetch;
  if(previousApi)require.cache[apiPath]=previousApi;else delete require.cache[apiPath];
 }
});

test('an approved Email can request an allowlisted test without a manual connection check',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/m360-marketing-client.browser.js'),'utf8');
 const start=source.indexOf('  function testBlocker()');
 const end=source.indexOf('  function renderTestReadiness()',start);
 const draft={status:'approved',version:1};
 const context={activeTask:{channel_draft_versions:{Email:{versions:[draft]}}},$:()=>({value:'test@example.com'})};
 vm.runInNewContext(source.slice(start,end),context);
 assert.equal(context.testBlocker(),'');
 draft.status='draft_for_review';
 assert.match(context.testBlocker(),/Approve Email/);
 assert.doesNotMatch(source,/Check Brevo connection/);
});

test('Outreach labels preserve existing campaign routes and navigation keys',()=>{
 const router=fs.readFileSync(path.join(__dirname,'../lib/m360-multipage-router.js'),'utf8');
 assert.match(router,/title: 'Outreach'/);assert.match(router,/data-m360-goto="marketing">Outreach</);
 assert.match(router,/hashes: \['#marketing'/);
 new vm.Script(require('../lib/m360-control-client'));
 new vm.Script(require('../lib/m360-marketing-client'));
});

test('Outreach initializes after the asynchronous CRM workspace load',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/m360-marketing-client.browser.js'),'utf8');
 const start=source.indexOf("    document.addEventListener('m360:crm-loaded'");
 const end=source.indexOf("    $('workspace')?.addEventListener",start);
 let loaded;const requests=[],label={textContent:''};
 vm.runInNewContext(source.slice(start,end),{document:{addEventListener(event,fn){loaded=fn;}},ws:()=> 'workspace-a',$:()=>label,getActiveClientInfo:()=>({clientName:'Example Workspace'}),activeTask:null,loadSavedTaskForWorkspace:id=>requests.push(id)});
 loaded({detail:{workspace:'another-workspace'}});assert.equal(requests.length,0);
 loaded({detail:{workspace:'workspace-a'}});assert.deepEqual(requests,['workspace-a']);assert.equal(label.textContent,'Example Workspace');
});
