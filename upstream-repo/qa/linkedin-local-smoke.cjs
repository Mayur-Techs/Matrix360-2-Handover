'use strict';
// Read-only smoke check. Never visits the local auto-login route or invokes a provider.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
(async()=>{
 const origin=process.argv[2]||'http://127.0.0.1:8138';
 assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
 let child;
 if(!process.argv[2]){
  child=spawn(process.execPath,['tools/local-preview.cjs'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:'8138',M360_LOCAL_AUTO_LOGIN_ENABLED:'false'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Preview startup timed out'));},15000);child.once('exit',()=>{clearTimeout(timer);reject(Error('Preview exited before readiness'));});child.stdout.on('data',data=>{if(String(data).includes('Matrix360 real local preview:')){clearTimeout(timer);resolve();}});});
 }
 try{
 const response=await fetch(origin+'/api/linkedin?op=status&workspace_id=lakhotia',{signal:AbortSignal.timeout(15000)});
 const body=await response.json();assert.equal(response.status,401);assert.equal(body.error,'UNAUTHENTICATED');
 const script=await fetch(origin+'/m360-marketing-client.js',{signal:AbortSignal.timeout(15000)});assert.equal(script.status,200);assert.ok((await script.text()).includes('m360_linkedin_callback'));
 console.log(JSON.stringify({checks:2,passed:2,authenticated:false,providers_called:false}));
 }finally{child?.kill();}
})().catch(error=>{console.error(error.code||error.cause?.code||error.message);process.exitCode=1;});
