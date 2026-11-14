'use strict';
// Application workflow tests: SQLite is real; external CRM, AI and LinkedIn are test doubles.
const test=require('node:test'),assert=require('node:assert/strict');
const {createStore}=require('../lib/m360-linkedin-store');
const {createService}=require('../lib/m360-linkedin-service');
const ctx={workspace:'workflow-a',actor:'fixture-actor',role:'client_admin'};
function fixture(t,options={}){
 const store=createStore({path:':memory:',backend:'sqlite',env:{}});t.after(()=>store.close());
 const published=[];
 const provider={checkAuthority:async()=>true,publish:async(_token,post)=>{published.push(post.author);return {id:'urn:li:share:'+published.length};},...options.provider};
 const env={LINKEDIN_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,5).toString('base64'),LINKEDIN_SAFETY_GUARDRAILS:'false',...options.env};
 const service=createService({...options,store,provider,env});
 return {store,service,published};
}
async function connected(f){
 await f.store.put(ctx.workspace,'connections','grant',{status:'connected',expires_at:new Date(Date.now()+3600000).toISOString(),encrypted_tokens:f.service.seal({access_token:'DECLARED_TEST_TOKEN'},ctx.workspace)});
 for(const id of ['one','two'])await f.store.put(ctx.workspace,'destinations',id,{urn:'urn:li:person:'+id,connection_id:'grant',capabilities:{publish:true}});
}
test('cancelling remaining destinations excludes already published destinations from reschedule',async t=>{
 const f=fixture(t);await connected(f);
 const {campaign}=await f.service.handle('save',ctx,{text:'A real user draft in a mock-provider test',destination_ids:['one','two']});
 const scheduled=await f.service.handle('schedule',ctx,{campaign_id:campaign.id,revision:campaign.revision});
 const first=(await f.service.runOne()).job;
 const second=scheduled.jobs.find(j=>j.destination_id!==first.destination_id);
 await f.service.handle('cancel',ctx,{job_id:second.id});
 const reopened=await f.store.get(ctx.workspace,'campaigns',campaign.id);
 assert.deepEqual(reopened.destination_ids,[second.destination_id]);
 await f.service.handle('schedule',ctx,{campaign_id:reopened.id,revision:reopened.revision});
 await f.service.runOne();assert.equal(new Set(f.published).size,2);assert.equal(f.published.length,2);
});
test('an unknown peer prevents cancellation from reopening or changing its campaign evidence',async t=>{
 const f=fixture(t,{provider:{publish:async()=>{throw Object.assign(Error('mock timeout'),{uncertain:true});}}});await connected(f);
 const {campaign}=await f.service.handle('save',ctx,{text:'Evidence preserved',destination_ids:['one','two']});
 const scheduled=await f.service.handle('schedule',ctx,{campaign_id:campaign.id,revision:campaign.revision});
 const unknown=(await f.service.runOne()).job,other=scheduled.jobs.find(j=>j.id!==unknown.id);
 await f.service.handle('cancel',ctx,{job_id:other.id});
 const current=await f.store.get(ctx.workspace,'campaigns',campaign.id);assert.equal(current.status,'scheduled');
 await assert.rejects(f.service.handle('save',ctx,{...current,text:'Changed'}),{code:'CAMPAIGN_SCHEDULED'});
});
test('persistent handover and progress remain in the correct workspace',async t=>{
 const f=fixture(t),{handover}=await f.service.handle('handover',ctx,{objective:'Prepare a LinkedIn campaign'});
 const {campaign}=await f.service.handle('save',ctx,{text:'Saved draft',handover_id:handover.id});
 const progress=await f.service.handle('progress',ctx,{handover_id:handover.id});assert.equal(progress.campaign.id,campaign.id);assert.equal(progress.handover.status,'draft_saved');
 await assert.rejects(f.service.handle('progress',{...ctx,workspace:'workflow-b'},{handover_id:handover.id}),{code:'NOT_FOUND'});
 await assert.rejects(f.service.handle('save',{...ctx,workspace:'workflow-b'},{text:'Foreign link',handover_id:handover.id}),{code:'NOT_FOUND'});
});
test('AI revisions use visible unsaved text and only client material, return honest alternatives and date proposal',async t=>{
 let request;
 const f=fixture(t,{env:{LINKEDIN_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,5).toString('base64'),LINKEDIN_SAFETY_GUARDRAILS:'false',OPENAI_API_KEY:'DECLARED_TEST_AI_KEY',M360_OPENAI_SPEND_APPROVED:'yes'},profile:async()=>({version:3,business_name:'Client supplied company',approved_claims:['Client approved fact']}),fetchImpl:async(_url,opts)=>{request=JSON.parse(opts.body);return {ok:true,json:async()=>({model:'mock-only',choices:[{message:{content:JSON.stringify({text:'Revised test content',concepts:[{title:'Test concept',summary:'Test summary',text:'Variant'}],missing_information:['Client must supply an actual figure'],schedule_proposal:{scheduled_at:'2026-12-01T11:00:00+05:30',time_zone:'Asia/Kolkata',explanation:'Client requested date'}})}}]})};}});
 const result=await f.service.handle('prepare',ctx,{objective:'Revise the opening',text:'Visible unsaved user content',revision_request:'Shorten the first line',language:'Bengali'});
 const payload=JSON.parse(request.messages[1].content);assert.equal(payload.current_text,'Visible unsaved user content');assert.equal(payload.language,'Bengali');assert.equal(payload.brand.business_name,'Client supplied company');assert.equal(payload.contacts,undefined);
 assert.equal(result.source,'live_ai'); // This field means provider call path, not test evidence.
 assert.equal(result.schedule_proposal.scheduled_at,'2026-12-01T05:30:00.000Z');assert.equal(result.concepts[0].text,'Variant');
 assert.equal((await f.store.listJobs(ctx.workspace)).length,0);
});
test('existing Marketing route delegates LinkedIn without invoking legacy campaign handling',async()=>{
 const marketing=require('../api/marketing');let called=false,body;
 const service={authorize:async()=>ctx,handle:async(op)=>{called=op==='status';return {connections:[]};}};
 await marketing({url:'/api/linkedin?op=status',method:'GET',query:{action:'linkedin',op:'status',workspace_id:ctx.workspace},headers:{}},{setHeader(){},end(value){body=JSON.parse(value);}},{service});
 assert.equal(called,true);assert.deepEqual(body.connections,[]);
});
test('enquiry attribution verifies the workspace CRM record and deduplicates without copying contacts',async t=>{
 const f=fixture(t,{fetchImpl:async()=>({ok:true,json:async()=>[{id:42,stage:'enquiry',source:'Website form',email:'not-stored@example.invalid'}]})});
 const {campaign}=await f.service.handle('save',ctx,{text:'Campaign with real first-party enquiry attribution'});
 const request={campaign_id:campaign.id,lead_id:'42',source_url:'https://client.example.invalid/form/submission'};
 const authorized={...ctx,bearer:'Bearer DECLARED_TEST_CRM_SESSION'};
 const first=await f.service.handle('attribute',authorized,request);await f.service.handle('attribute',authorized,request);
 const rows=await f.store.list(ctx.workspace,'attributions');assert.equal(rows.length,1);assert.equal(first.attribution.attribution_kind,'operator_recorded');assert.equal(rows[0].stage,'enquiry');assert.ok(!JSON.stringify(rows).includes('not-stored'));
 await assert.rejects(f.service.handle('attribute',authorized,{...request,lead_id:'404'}),{code:'NOT_FOUND'});
 await assert.rejects(f.service.handle('attribute',{...authorized,workspace:'workflow-b'},request),{code:'NOT_FOUND'});
});
test('legacy LinkedIn token-vault endpoints direct clients to OAuth',async t=>{
 const original=global.fetch;t.after(()=>{global.fetch=original;});global.fetch=async()=>({ok:true,status:200,json:async()=>[{id:ctx.workspace,role:'client_admin'}]});
 const marketing=require('../api/marketing');
 for(const action of ['providers/configure','providers/verify']){
  let payload;const res={statusCode:0,setHeader(){},end(value){payload=JSON.parse(value);}};
  await marketing({url:'/api/marketing?action='+action,method:'POST',query:{action},headers:{authorization:'Bearer declared-fixture-session-123456'},body:{workspace_id:ctx.workspace,provider:'linkedin',token:'DO_NOT_STORE_THIS_TEST_TOKEN'}},res);
  assert.equal(res.statusCode,409);assert.equal(payload.status,'linkedin_oauth_required');assert.ok(!JSON.stringify(payload).includes('DO_NOT_STORE'));
 }
});
