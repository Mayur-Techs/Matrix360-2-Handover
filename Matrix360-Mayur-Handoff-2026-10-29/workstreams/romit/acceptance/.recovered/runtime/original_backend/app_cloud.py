"""Supabase-backed Matrix360 DEV CRM. No service-role key. PostgREST enforces RLS."""
import os
import re
import httpx
from fastapi import FastAPI, Header, HTTPException, Depends, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from stages import STAGES  # Legacy client-specific labels, not an access-control allowlist

# Safe standard pipeline for new dynamically onboarded businesses.
GENERIC_STAGES = ["enquiry", "qualified", "consultation", "proposal", "negotiation", "won", "lost"]
_WORKSPACE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")

def valid_workspace_id(workspace: str) -> str:
    # Never interpolate arbitrary path characters into PostgREST eq filters.
    if not _WORKSPACE_ID.fullmatch(workspace):
        raise HTTPException(404, "Workspace not found")
    return workspace

def pipeline(workspace: str) -> list[str]:
    return list(STAGES.get(workspace, GENERIC_STAGES))

URL = os.getenv('MATRIX_SUPABASE_URL', '').rstrip('/')
KEY = os.getenv('MATRIX_SUPABASE_PUBLISHABLE_KEY', '')
if not URL or not KEY:
    raise RuntimeError('Set MATRIX_SUPABASE_URL and MATRIX_SUPABASE_PUBLISHABLE_KEY; never use secret/service-role key')
if not URL.startswith('https://'):
    raise RuntimeError('Supabase URL must use HTTPS')
app = FastAPI(title='Matrix360 Cloud CRM - Development', version='0.7-dev')
origins=[s.strip() for s in os.getenv('MATRIX_CORS_ORIGINS','http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:8000,http://localhost:8000').split(',') if s.strip()]
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=False,allow_methods=['GET','POST','PATCH'],allow_headers=['Authorization','Content-Type'])

class Login(BaseModel):
    username:str  # email; retains existing frontend request contract
    password:str
class LeadCreate(BaseModel):
    name:str=Field(min_length=1,max_length=200)
    source:str|None=Field(default=None,max_length=150)
    stage:str='enquiry'
class StageUpdate(BaseModel):
    stage:str

async def supabase(method,path,token=None,params=None,json=None,prefer=None):
    headers={'apikey':KEY, 'Accept':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    if prefer: headers['Prefer']=prefer
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            response=await client.request(method,URL+path,headers=headers,params=params,json=json)
    except httpx.HTTPError:
        raise HTTPException(503,'Identity/database provider temporarily unavailable')
    return response

async def authenticated_user(authorization:str|None=Header(None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401,'Login required')
    token=authorization[7:]
    if not token or len(token)>8192: raise HTTPException(401,'Invalid token')
    response=await supabase('GET','/auth/v1/user',token=token)
    if response.status_code!=200: raise HTTPException(401,'Invalid or expired session')
    data=response.json()
    if not data.get('id'): raise HTTPException(401,'Invalid user')
    return {'id':data['id'],'token':token}

async def rest(method,table,user,params=None,payload=None,prefer=None):
    r=await supabase(method,'/rest/v1/'+table,token=user['token'],params=params,json=payload,prefer=prefer)
    if r.status_code in (401,403): raise HTTPException(r.status_code,'Permission denied')
    if r.status_code>=400: raise HTTPException(502,'Database request failed')
    try: return r.json() if r.content else []
    except ValueError: raise HTTPException(502,'Invalid database response')

async def membership(workspace,user,write=False):
    valid_workspace_id(workspace)
    data=await rest('GET','m360_memberships',user,params={'select':'role','workspace_id':'eq.'+workspace,'user_id':'eq.'+user['id']})
    if not data: raise HTTPException(403,'Workspace access denied')
    role=data[0]['role']
    if write and role not in {'platform_owner','agency_admin','client_admin','marketing_operator','sales_operator','client','member','user'}:
        raise HTTPException(403,'Workspace is read-only')
    return role

@app.get('/health')
async def health(): return {'status':'ok','mode':'supabase-dev-recovery'}

@app.get('/ready')
async def ready():
    # Process/config readiness; does not claim external provider availability.
    return {'status':'configured','identity_provider':'unverified'}

@app.post('/auth/login')
async def login(data:Login):
    r=await supabase('POST','/auth/v1/token',params={'grant_type':'password'},json={'email':data.username.strip(),'password':data.password})
    if r.status_code!=200: raise HTTPException(401,'Invalid credentials or unconfirmed email')
    body=r.json()
    if not body.get('access_token'): raise HTTPException(502,'Authentication provider returned no access token')
    return {'access_token':body['access_token'],'token_type':'bearer','expires_in':body.get('expires_in',3600)}

@app.post('/auth/logout')
async def logout(user=Depends(authenticated_user)):
    r=await supabase('POST','/auth/v1/logout',token=user['token'])
    if r.status_code not in (200,204): raise HTTPException(502,'Provider sign-out failed')
    return {'ok':True}

@app.get('/me/workspaces')
async def my_workspaces(user=Depends(authenticated_user)):
    ms=await rest('GET','m360_memberships',user,params={'select':'workspace_id,role','user_id':'eq.'+user['id']})
    ws=await rest('GET','m360_workspaces',user,params={'select':'id,name'})
    by_id={w['id']:w['name'] for w in ws}
    return sorted([{'id':m['workspace_id'],'name':by_id[m['workspace_id']],'role':m['role']} for m in ms if m['workspace_id'] in by_id],key=lambda x:x['name'])

@app.get('/workspaces/{workspace}/stages')
async def stages(workspace:str,user=Depends(authenticated_user)):
    await membership(workspace,user)
    return pipeline(workspace)

@app.get('/workspaces/{workspace}/leads')
async def leads(workspace:str,user=Depends(authenticated_user)):
    await membership(workspace,user)
    rows = await rest('GET','m360_leads',user,params={'select':'id,workspace_id,name,source,stage,created_at,updated_at','workspace_id':'eq.'+workspace,'order':'id.desc'})
    if not isinstance(rows,list) or any(row.get('workspace_id')!=workspace for row in rows):
        raise HTTPException(502,'Tenant-scoped data integrity check failed')
    return rows

@app.post('/workspaces/{workspace}/leads',status_code=201)
async def create(workspace:str,data:LeadCreate,user=Depends(authenticated_user)):
    await membership(workspace,user,write=True)
    if not data.name.strip() or data.stage not in pipeline(workspace):raise HTTPException(422,'Invalid lead data')
    rows=await rest('POST','m360_leads',user,payload={'workspace_id':workspace,'name':data.name.strip(),'source':data.source,'stage':data.stage,'created_by':user['id']},prefer='return=representation')
    if len(rows)!=1 or rows[0].get('workspace_id')!=workspace: raise HTTPException(502,'Unexpected insert response')
    return rows[0]

@app.patch('/workspaces/{workspace}/leads/{lead_id}')
async def stage_update(workspace:str,lead_id:int,data:StageUpdate,user=Depends(authenticated_user)):
    await membership(workspace,user,write=True)
    if data.stage not in pipeline(workspace):raise HTTPException(422,'Invalid stage')
    rows=await rest('PATCH','m360_leads',user,params={'workspace_id':'eq.'+workspace,'id':'eq.'+str(lead_id)},payload={'stage':data.stage},prefer='return=representation')
    if not rows:raise HTTPException(404,'Lead not found')
    if any(row.get('workspace_id')!=workspace for row in rows): raise HTTPException(502,'Tenant-scoped data integrity check failed')
    return {'ok':True,'id':lead_id,'stage':data.stage}

# Recovery-only local AI drafting extension, separate from CRM mutation endpoints.
from matrix360_ai_plans import install_ai_plan_routes
install_ai_plan_routes(app, authenticated_user, membership, rest)

# Matrix360 Maps Scraper V4 integration endpoints
class ScraperRunPayload(BaseModel):
    query: str = Field(default="Industrial Automation Suppliers")
    location: str = Field(default="Bengaluru")
    max_results: int = Field(default=50, ge=1, le=2000)
    enrich: bool = Field(default=True)
    contact_filter: str = Field(default="both")
    pvt_ltd_only: bool = Field(default=False)
    apply_suppression: bool = Field(default=True)

@app.get('/api/scraper/leads')
async def get_scraped_leads_endpoint(request: Request):
    try:
        from scraper_service import query_saved_leads
        params = dict(request.query_params)
        return query_saved_leads(params)
    except Exception as e:
        return {"status": "error", "message": str(e), "count": 0, "leads": []}

@app.delete('/api/scraper/leads')
async def delete_scraped_leads_endpoint():
    try:
        from scraper_service import clear_leads
        clear_leads()
        return {"status": "ok", "message": "Cleared leads database."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post('/api/scraper/run')
async def run_scraper_endpoint(request: Request):
    try:
        from scraper_service import pipeline_manager
        payload = await request.json()
        return pipeline_manager.start_background_job(payload)
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get('/api/scraper/status')
async def scraper_status_endpoint():
    try:
        from scraper_service import pipeline_manager
        return pipeline_manager.get_status()
    except Exception as e:
        return {"status": "error", "message": str(e), "running": False, "phase": "Error"}

@app.post('/api/scraper/stop')
async def scraper_stop_endpoint():
    try:
        from scraper_service import pipeline_manager
        pipeline_manager.request_stop()
        return {"status": "stopped", "message": "Stop requested."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get('/api/scraper/suppression')
async def get_suppression_endpoint():
    try:
        from scraper_database import get_suppression_count, get_suppression_items
        return {"status": "ok", "count": get_suppression_count(), "items": get_suppression_items()}
    except Exception as e:
        return {"status": "ok", "count": 0, "items": []}

@app.post('/api/scraper/suppression')
async def modify_suppression_endpoint(request: Request):
    try:
        from scraper_database import (
            add_suppression_items, remove_suppression_item, clear_suppression_list,
            get_suppression_count, get_suppression_items
        )
        payload = await request.json()
        action = str(payload.get("action", "add")).lower()
        if action == "clear":
            clear_suppression_list()
        elif action == "remove":
            target = payload.get("term_id") or (payload.get("terms", [""])[0] if payload.get("terms") else "")
            remove_suppression_item(target)
        else:
            raw_text = payload.get("raw_text", "")
            terms = payload.get("terms", [])
            if raw_text and not terms:
                terms = [s.strip() for s in re.split(r"[\r\n,]+", raw_text) if s.strip()]
            add_suppression_items(terms)
        return {"status": "ok", "count": get_suppression_count(), "items": get_suppression_items()}
    except Exception as e:
        return {"status": "error", "message": str(e), "count": 0, "items": []}

@app.get('/api/scraper/export.csv')
async def export_scraper_csv_endpoint(request: Request):
    try:
        from scraper_service import export_leads_csv_string
        params = dict(request.query_params)
        csv_data = export_leads_csv_string(params)
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="matrix360_verified_leads.csv"'}
        )
    except Exception:
        return Response(content="id,business_name,phone,email\n", media_type="text/csv")


