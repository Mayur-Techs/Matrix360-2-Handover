'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../workstreams/avinash/frontend');
const envFile=path.join(root,'.env.local');
if(fs.existsSync(envFile))for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
 const match=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);if(!match||process.env[match[1]]!==undefined)continue;
 let value=match[2].trim();if(value.startsWith('"'))value=JSON.parse(value);else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);process.env[match[1]]=value;
}
const {createService}=require(path.join(root,'lib/m360-linkedin-service'));
const store=require(path.join(root,'lib/m360-linkedin-store'));
const service=createService();let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
(async()=>{do{try{const result=await service.runOne();if(!result.idle)console.log(JSON.stringify({event:'linkedin_job',id:result.job?.id||result.id,status:result.job?.status||result.status}));}catch(error){console.error(JSON.stringify({event:'linkedin_worker_error',code:error.code||'WORKER_ERROR'}));if(process.argv.includes('--once'))process.exitCode=1;}if(process.argv.includes('--once')||stopped)break;await new Promise(resolve=>setTimeout(resolve,5000));}while(!stopped);store.close();})().catch(()=>{process.exitCode=1;store.close();});
