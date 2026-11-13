"""Actual in-process ASGI concurrency checks with a held synthetic generator.
No hosted API, external model, network or customer information is used.
"""
import asyncio
import sys
from pathlib import Path
import pytest
import httpx
from fastapi import FastAPI, Header, HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from matrix360_ai_plans import install_ai_plan_routes, ModelDraft

MODEL_RESPONSE=ModelDraft.model_validate({
    'headline':'Review pipeline evidence before outreach',
    'rationale':'The aggregate alone cannot establish conversion effectiveness or buyer readiness.',
    'steps':[
        {'title':'Review current stages','action':'Check authorized CRM pipeline stages with your team.'},
        {'title':'Review business assumptions','action':'Validate the target market before drafting a campaign.'},
        {'title':'Request human approval','action':'Have a manager review the draft before taking action.'},
    ]
})


def make_host(monkeypatch, generator, capacity='1'):
    monkeypatch.setenv('M360_AI_ENABLED','true')
    monkeypatch.setenv('M360_AI_LOCAL_URL','http://127.0.0.1:11434/v1/chat/completions')
    monkeypatch.setenv('M360_AI_LOCAL_MODEL','synthetic-local')
    monkeypatch.setenv('M360_AI_MAX_CONCURRENT',capacity)
    app=FastAPI()
    async def auth(authorization: str|None=Header(None)):
        if authorization!='Bearer local-fixture':raise HTTPException(401,'Login required')
        return {'id':'synthetic','token':'local-fixture'}
    async def membership(ws,user):
        if ws!='biz_synthetic':raise HTTPException(403,'Workspace denied')
        return 'client_admin'
    async def rest(method,table,user,params=None):
        assert method=='GET' and table=='m360_leads'
        assert params['workspace_id']=='eq.biz_synthetic'
        return [{'workspace_id':'biz_synthetic','stage':'enquiry'}]
    install_ai_plan_routes(app,auth,membership,rest,generator=generator)
    return app,auth,membership,rest


@pytest.mark.asyncio
async def test_burst_returns_429_and_never_runs_extra_generation(monkeypatch):
    started=asyncio.Event()
    release=asyncio.Event()
    invocations=[]
    async def held_generator(goal,evidence,brief):
        invocations.append(goal)
        started.set()
        await release.wait()
        return MODEL_RESPONSE
    app,*_=make_host(monkeypatch,held_generator,'1')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver') as client:
        url='/workspaces/biz_synthetic/ai/plan-draft'
        headers={'Authorization':'Bearer local-fixture'}
        first=asyncio.create_task(client.post(url,headers=headers,json={'goal':'enquiries'}))
        await asyncio.wait_for(started.wait(),timeout=1)
        second=await client.post(url,headers=headers,json={'goal':'conversion'})
        assert second.status_code==429,second.text
        assert second.headers['retry-after']=='1'
        assert invocations==['enquiries']  # overload never reaches model
        release.set()
        r=await asyncio.wait_for(first,timeout=1)
        assert r.status_code==200 and r.json()['requires_human_review']
        third=await client.post(url,headers=headers,json={'goal':'campaign'})
        assert third.status_code==200
        assert invocations==['enquiries','campaign']


@pytest.mark.asyncio
async def test_failed_generation_releases_capacity(monkeypatch):
    hits=[]
    async def failing_model(goal,evidence,brief):
        hits.append(goal)
        if len(hits)==1:raise HTTPException(503,'Synthetic model down')
        return MODEL_RESPONSE
    app,*_=make_host(monkeypatch,failing_model,'1')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver') as client:
        url='/workspaces/biz_synthetic/ai/plan-draft'
        headers={'Authorization':'Bearer local-fixture'}
        a=await client.post(url,headers=headers,json={'goal':'enquiries'})
        b=await client.post(url,headers=headers,json={'goal':'conversion'})
    assert (a.status_code,b.status_code)==(503,200)
    assert hits==['enquiries','conversion']


def test_duplicate_router_installation_fails_closed(monkeypatch):
    async def fake_model(goal,evidence,brief):return MODEL_RESPONSE
    app,auth,membership,rest=make_host(monkeypatch,fake_model)
    with pytest.raises(RuntimeError,match='already installed'):
        install_ai_plan_routes(app,auth,membership,rest,generator=fake_model)


def test_invalid_inference_limit_has_safe_fallback(monkeypatch):
    async def fake_model(goal,evidence,brief):return MODEL_RESPONSE
    for invalid in ['zero','0','999','-1']:
        app,*_=make_host(monkeypatch,fake_model,invalid)
        assert getattr(app.state,'_matrix360_ai_installed') is True


@pytest.mark.asyncio
async def test_hard_generation_timeout_cancels_model_and_releases_slot(monkeypatch):
    started=asyncio.Event()
    cancelled=asyncio.Event()
    hits=[]
    async def hanging_then_success(goal,evidence,brief):
        hits.append(goal)
        if goal=='enquiries':
            started.set()
            try:
                await asyncio.sleep(100)
            except asyncio.CancelledError:
                cancelled.set()
                raise
        return MODEL_RESPONSE
    # Configuration is captured during route installation.
    monkeypatch.setenv('M360_AI_GENERATION_TIMEOUT_SECONDS','1')
    app,*_=make_host(monkeypatch,hanging_then_success,'1')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver') as client:
        url='/workspaces/biz_synthetic/ai/plan-draft'
        headers={'Authorization':'Bearer local-fixture'}
        first=asyncio.create_task(client.post(url,headers=headers,json={'goal':'enquiries'}))
        await asyncio.wait_for(started.wait(),timeout=1)
        response=await asyncio.wait_for(first,timeout=2)
        assert response.status_code==503,response.text
        assert response.headers['retry-after']=='5'
        assert 'timed out' in response.json()['detail']
        assert cancelled.is_set()
        second=await client.post(url,headers=headers,json={'goal':'conversion'})
        assert second.status_code==200,second.text
        assert hits==['enquiries','conversion']


def test_hard_timeout_configuration_fails_to_bounded_default(monkeypatch):
    async def fake_model(goal,evidence,brief):return MODEL_RESPONSE
    for invalid in ['invalid','0','-10','900','1.2']:
        monkeypatch.setenv('M360_AI_GENERATION_TIMEOUT_SECONDS',invalid)
        app,*_=make_host(monkeypatch,fake_model)
        assert getattr(app.state,'_matrix360_ai_installed') is True
