"use strict";
// Local-only adapter for the existing Vercel handlers. No auth bypass or fixtures.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../workstreams/avinash/frontend');
const envFile=path.join(root,'.env.local');
if(fs.existsSync(envFile))for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
 const match=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
 if(!match)continue;
 let value=match[2].trim();
 if(value.startsWith('"'))value=JSON.parse(value);
 else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);
 if(process.env[match[1]]===undefined)process.env[match[1]]=value;
}
const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
const autoLogin=require('./local-auto-login.cjs');
if(autoLogin.enabled())process.env.M360_SHOWCASE_ENABLED='false';
const CRM_HOST='https://matrix360-crm-backend-p9os.onrender.com';
function warmCrm(){fetch(CRM_HOST+'/docs',{signal:AbortSignal.timeout(6000)}).catch(()=>{});}
warmCrm();
const routes=config.rewrites.map(rule=>{
 const names=[];
 const pattern=rule.source.split('/').map(part=>{
  if(part.startsWith(':')){names.push(part.replace(/^:/,'').replace(/\*$/,''));return part.endsWith('*')?'(.*)':'([^/]+)';}
  return part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 }).join('/');
 return {...rule,regex:new RegExp('^'+pattern+'$'),names};
});
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','private,no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  const pathname=decodeURIComponent(url.pathname);
  if(await autoLogin.prepare(req,res,pathname))return;
  if(pathname==='/login.html'||pathname==='/api/crm/auth/login')warmCrm();
  if(pathname.includes('..')||pathname.includes('\\')||pathname.includes('\0')||pathname.split('/').some(p=>p.startsWith('.'))){res.statusCode=404;return res.end('Not found');}
  if(!['GET','HEAD'].includes(req.method)){
   let size=0;const chunks=[];
   for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024){res.statusCode=413;return res.end('Request too large');}chunks.push(chunk);}
   const body=Buffer.concat(chunks);
   if(String(req.headers['content-type']||'').includes('application/json')){
    try{req.body=body.length?JSON.parse(body.toString('utf8')):{};}catch{res.statusCode=400;return res.end('Invalid JSON');}
   }else req.body=body;
  }
  let destination;
  // Explicit remaps win; otherwise real local API files beat the catch-all asset rewrite.
  const direct=path.join(root,pathname+'.js');
  const explicitRemap=routes.some(rule=>rule.source===pathname&&new URL(rule.destination,'http://127.0.0.1').pathname!==pathname);
  if(!explicitRemap&&/^\/api\/[a-z0-9-]+$/.test(pathname)&&fs.existsSync(direct))destination=url;
  else for(const rule of routes){
   const match=rule.regex.exec(pathname);if(!match)continue;
   let target=rule.destination;
   rule.names.forEach((name,i)=>{target=target.replace(new RegExp(':'+name+'\\*?','g'),encodeURIComponent(match[i+1]));});
   destination=new URL(target,'http://127.0.0.1');
   for(const [name,value] of url.searchParams)if(!destination.searchParams.has(name))destination.searchParams.append(name,value);
   break;
  }
  if(!destination){res.statusCode=404;return res.end('Not found');}
  req.query=Object.fromEntries(destination.searchParams);
  if(destination.pathname.startsWith('/api/')){
   const file=path.resolve(root,'.'+destination.pathname+'.js');
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end('Not found');}
   return await require(file)(req,res);
  }
  const file=path.resolve(root,'.'+destination.pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end('Not found');}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.png')?'image/png':'application/octet-stream');
  res.end(req.method==='HEAD'?undefined:fs.readFileSync(file));
 }catch(error){
  if(res.headersSent){res.destroy();return;}
  res.statusCode=500;res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({status:'error',message:'Local preview request failed. Check configuration and source.'}));
  console.error('Local preview request failed:',error.code||error.name);
 }
});
const port=Number(process.env.PORT||8000);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Port is in use. Stop your own existing preview or set PORT to a free port.':error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log('Matrix360 real local preview: http://127.0.0.1:'+port+'/login.html'));
