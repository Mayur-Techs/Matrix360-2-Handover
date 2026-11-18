'use strict';
const {timingSafeEqual}=require('node:crypto');
const {createService}=require('./m360-linkedin-service');
const reads=new Set(['status','campaigns','assets','asset','progress']);
const publishOps=new Set(['connect','callback','disconnect','destinations','approve','schedule','cancel','retry','reconcile','configure-ai']);
function send(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(data));}
function secretMatch(actual,expected){return expected.length>=32&&actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
module.exports=async(req,res,options={})=>{
 try{
  const service=options.service||createService(),body=req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body)?req.body:{};
  const query=req.query||Object.fromEntries(new URL(req.url,'http://localhost').searchParams),op=query.op||'status';
  if(op==='worker'){
   if(req.method!=='POST')return send(res,405,{error:'METHOD_NOT_ALLOWED',message:'Use POST.'});
   if(!secretMatch(String(req.headers?.authorization||'').replace(/^Bearer /,''),String(process.env.LINKEDIN_WORKER_SECRET||'')))return send(res,401,{error:'UNAUTHENTICATED',message:'Worker authentication required.'});
   const result=await service.runOne();return send(res,200,{status:'ok',result});
  }
  if(req.method!==(reads.has(op)?'GET':'POST'))return send(res,405,{error:'METHOD_NOT_ALLOWED',message:reads.has(op)?'Use GET.':'Use POST.'});
  if(req.headers?.['sec-fetch-site']==='cross-site')return send(res,403,{error:'FORBIDDEN',message:'Open LinkedIn from Matrix360.'});
  const workspace=String(body.workspace_id||query.workspace_id||'');
  const ctx=await service.authorize(req,workspace,reads.has(op)?'read':publishOps.has(op)?'publish':'write');
  if(op==='content-start'||op==='content-status'){
   const {createContentBridge}=require('./m360-linkedin-content');
   const bridge=options.contentBridge||createContentBridge({store:require('./m360-linkedin-store'),service});
   return send(res,200,{status:'ok',...await (op==='content-start'?bridge.start(ctx,req,body):bridge.poll(ctx,req,body))});
  }
  if(op==='asset'){const result=await service.preview(ctx,String(query.id||''),query.index);res.statusCode=200;res.setHeader('Content-Type',result.mime);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.setHeader('Content-Length',result.bytes.length);return res.end(result.bytes);}
  return send(res,200,{status:'ok',...await service.handle(op,ctx,reads.has(op)?query:body)});
 }catch(error){
  const conflict=['REVISION_CONFLICT','LEASE_CONFLICT','JOB_CONFLICT'].includes(error.code),known=error.code&&error.code!=='ERR_INTERNAL_ASSERTION';
  return send(res,error.status>=400&&error.status<=599?error.status:conflict?409:known?503:500,{error:known?error.code:'LINKEDIN_ERROR',message:known?String(error.message).slice(0,400):'LinkedIn operation could not complete. Your saved work is preserved.'});
 }
};
