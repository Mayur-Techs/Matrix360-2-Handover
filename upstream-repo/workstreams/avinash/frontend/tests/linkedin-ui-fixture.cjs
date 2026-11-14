'use strict';
// Isolated browser fixture: no real authentication, provider calls or production writes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const campaigns=[],jobs=[],attributions=[];
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1kAAAAASUVORK5CYII=','base64');
const destinations=[{id:'urn:li:person:fixture',name:'Fixture author',type:'member',capabilities:{publish:true,analytics:false}}];
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/client.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(__dirname,'../lib/m360-linkedin-client.browser.js')));}
  if(url.pathname==='/'){
    res.setHeader('Content-Type','text/html');
    return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LinkedIn UI — isolated fixture</title><body><h1>Isolated LinkedIn UI test fixture</h1><p>No real provider operations.</p><label>Workspace<select id="workspace"><option value="fixture-a">Fixture A</option><option value="fixture-b">Fixture B</option><option value="unconfigured">Unconfigured</option><option value="stale-worker">Stale Worker</option><option value="guardrails-off">Guardrails Off</option></select></label><main><section id="marketing-centre"></section></main><script>sessionStorage.setItem('matrix360_pilot_token','fixture-token-never-valid');sessionStorage.setItem('matrix360_pilot_expires_at',String(Date.now()+3600000));</script><script src="/client.js"></script></body></html>`);
  }
  if(url.pathname!=='/api/linkedin'){res.statusCode=404;return res.end();}
  let raw='';for await(const part of req)raw+=part;
  const body=raw?JSON.parse(raw):{},op=url.searchParams.get('op'),workspace=url.searchParams.get('workspace_id');
  res.setHeader('Content-Type','application/json');
  const respond=data=>res.end(JSON.stringify(data));
  if(op==='status'){
    if(workspace==='unconfigured'){
      return respond({connections:[],destinations:[],configuration:{oauth_ready:false,token_encryption_ready:false,worker_ready:false,ai_ready:false,missing_keys:['LINKEDIN_CLIENT_ID','LINKEDIN_CLIENT_SECRET','LINKEDIN_REDIRECT_URI','LINKEDIN_TOKEN_ENCRYPTION_KEY']},guardrails:{enabled:true,approval_required:true,media_rights_required:true}});
    }
    if(workspace==='stale-worker'){
      return respond({connections:[],destinations:[],configuration:{oauth_ready:true,token_encryption_ready:true,worker_ready:false,worker_last_seen:new Date(Date.now()-3600000).toISOString(),ai_ready:true},guardrails:{enabled:true,approval_required:true,media_rights_required:true}});
    }
    const guardrailsOn=workspace==='fixture-a';
    return respond({connections:[{id:'fixture-grant',name:'Fixture member',status:'active',scopes:['w_member_social']}],destinations,configuration:{oauth_ready:true,token_encryption_ready:true,worker_ready:true,ai_ready:true},guardrails:{enabled:guardrailsOn,approval_required:guardrailsOn,media_rights_required:guardrailsOn}});
  }
  if(op==='campaigns')return respond({campaigns:campaigns.filter(c=>c.workspace===workspace),jobs:jobs.filter(j=>j.workspace===workspace),attributions:attributions.filter(a=>a.workspace===workspace)});
  if(op==='assets')return respond({assets:[{id:'fixture-image',filename:'Isolated fixture pixel.png',mime:'image/png',size:image.length}],content_studio:{assets:[]}});
  if(op==='asset'){res.setHeader('Content-Type','image/png');return res.end(image);}
  if(op==='handover')return respond({handover:{id:'fixture-handover',objective:body.objective,correlation_id:body.correlation_id}});
  if(op==='prepare')return respond({text:'Fixture generated draft. <script>alert("must escape")</script>',concepts:[{title:'Fixture concept',text:'Chosen fixture concept'}]});
  if(op==='save'){
    const c={...body.campaign,id:body.campaign.id||'fixture-'+(campaigns.length+1),revision:(body.campaign.revision||0)+1,workspace};
    const index=campaigns.findIndex(item=>item.id===c.id&&item.workspace===workspace);if(index<0)campaigns.push(c);else campaigns[index]=c;
    return respond({campaign:c});
  }
  if(op==='approve'){const c=campaigns.find(c=>c.id===body.campaign_id&&c.workspace===workspace);if(c)c.approval={revision:c.revision};return respond({ok:true});}
  if(op==='schedule'){jobs.push({id:'fixture-job-'+jobs.length,campaign_id:body.campaign_id,workspace,destination_id:destinations[0].id,status:'queued',scheduled_for:new Date().toISOString()});return respond({ok:true});}
  if(op==='cancel'){const job=jobs.find(j=>j.id===body.job_id&&j.workspace===workspace);if(job)job.status='cancelled';return respond({ok:true});}
  if(op==='attribute'){const attribution={id:'fixture-attribution',workspace,campaign_id:body.campaign_id,lead_id:body.lead_id,source_url:body.source_url,stage:'fixture enquiry',source:'isolated test fixture',attribution_kind:'operator_recorded',recorded_at:new Date().toISOString()};attributions.push(attribution);return respond({attribution});}
  res.statusCode=400;respond({error:'Operation unavailable in isolated fixture.'});
});
module.exports=server;
if(require.main===module)server.listen(0,'127.0.0.1',()=>console.log('LINKEDIN_UI_FIXTURE=http://127.0.0.1:'+server.address().port));
