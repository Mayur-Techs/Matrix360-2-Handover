"""No real customer/provider calls; all data and LLM output are synthetic."""
import json
import os
import sys
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError
from fastapi import FastAPI, HTTPException, Header
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from matrix360_ai_plans import active_local_model, safe_stage_summary, prompt_messages, generate_model_draft, install_ai_plan_routes, ModelDraft, DraftRequest

FIXTURE = {
    'headline': 'Review qualified enquiries before preparing outreach',
    'rationale': 'The authorized CRM sample shows three records, but campaign metrics and buyer profiles are not available.',
    'steps': [
        {'title':'Review pipeline stages', 'action':'Verify the current stage and owner for each authorized CRM enquiry.'},
        {'title':'Define the customer profile', 'action':'Ask the account team to validate market, location and offer assumptions.'},
        {'title':'Seek explicit campaign approval', 'action':'Request channel, audience and creative review before authorizing any outreach.'}
    ]
}

@pytest.fixture(autouse=True)
def unset_model(monkeypatch):
    for key in ['M360_AI_ENABLED','M360_AI_LOCAL_URL','M360_AI_LOCAL_MODEL']:
        monkeypatch.delenv(key,raising=False)


def enable_model(monkeypatch, url='http://127.0.0.1:11434/v1/chat/completions'):
    monkeypatch.setenv('M360_AI_ENABLED','true')
    monkeypatch.setenv('M360_AI_LOCAL_URL',url)
    monkeypatch.setenv('M360_AI_LOCAL_MODEL','synthetic-test-model')


def test_disabled_default_and_non_loopback_denied(monkeypatch):
    assert active_local_model() is None
    enable_model(monkeypatch,'https://api.someservice.example/v1/chat/completions')
    assert active_local_model() is None
    enable_model(monkeypatch,'http://169.254.169.254/v1/chat/completions')
    assert active_local_model() is None
    enable_model(monkeypatch)
    assert active_local_model()[1]=='synthetic-test-model'


def test_evidence_never_contains_individual_identifiers():
    rows=[{'workspace_id':'biz_1','stage':'enquiry','name':'Sensitive Name','email':'secret@example.com','phone':'111'},
          {'workspace_id':'biz_1','stage':'qualified','name':'Other Name'}]
    ev=safe_stage_summary(rows,'biz_1')
    messages=json.dumps(prompt_messages('enquiries',ev))
    assert ev['stage_counts']=={'enquiry':1,'qualified':1}
    assert 'secret@example.com' not in messages
    assert 'Sensitive Name' not in messages
    assert '111' not in messages
    assert 'biz_1' not in messages


def test_cross_tenant_evidence_rejected():
    with pytest.raises(HTTPException) as err:
        safe_stage_summary([{'workspace_id':'biz_B','stage':'qualified'}],'biz_A')
    assert err.value.status_code==502


def test_sample_cap_and_invalid_counts_rejected():
    with pytest.raises(HTTPException):safe_stage_summary([{'workspace_id':'x','stage':'enquiry'}]*1001,'x')
    with pytest.raises(HTTPException):safe_stage_summary([{'workspace_id':'x','stage':None}],'x')

@pytest.mark.asyncio
async def test_real_model_protocol_with_mock_transport(monkeypatch):
    enable_model(monkeypatch)
    seen=[]
    def handler(request):
        assert request.url.host=='127.0.0.1'
        inp=json.loads(request.content)
        seen.append(inp)
        assert inp['response_format']=={'type':'json_object'}
        assert inp['model']=='synthetic-test-model'
        assert 'secret' not in json.dumps(inp)
        return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(FIXTURE)}}]})
    output=await generate_model_draft('conversion',{'sampled_rows':3,'sample_limit':1000,'may_be_truncated':False,'stage_counts':{'enquiry':2,'qualified':1}}, transport=httpx.MockTransport(handler))
    assert len(seen)==1
    assert len(output.steps)==3
    assert output.headline==FIXTURE['headline']

@pytest.mark.asyncio
async def test_invalid_model_response_is_fail_closed(monkeypatch):
    enable_model(monkeypatch)
    def handler(request):
        return httpx.Response(200,json={'choices':[{'message':{'content':'{"headline":"Unverified","steps":[]}'}}]})
    with pytest.raises(HTTPException) as err:
        await generate_model_draft('campaign',{'sampled_rows':0,'sample_limit':1000,'may_be_truncated':False,'stage_counts':{}},transport=httpx.MockTransport(handler))
    assert err.value.status_code==503


def make_api(monkeypatch, allow=True, cross=False):
    calls=[]
    app=FastAPI()
    async def auth(authorization: str|None=Header(None)):
        if authorization!='Bearer synthetic':raise HTTPException(401,'Login required')
        return {'id':'test_subject','token':'synthetic'}
    async def membership(workspace,user):
        if not allow or workspace !='biz_A':raise HTTPException(403,'Workspace access denied')
        return 'client_admin'
    async def rest(method,table,user,params=None):
        calls.append((method,table,params))
        return [{'workspace_id':'biz_B' if cross else 'biz_A','stage':'enquiry'},
                {'workspace_id':'biz_A','stage':'qualified'}]
    async def fake_model(goal,evidence,brief):
        calls.append(('model',goal,evidence,brief))
        return ModelDraft.model_validate(FIXTURE)
    install_ai_plan_routes(app,auth,membership,rest,generator=fake_model)
    return TestClient(app),calls


def test_auth_and_tenant_gate_without_model(monkeypatch):
    client,calls=make_api(monkeypatch)
    base='/workspaces/biz_A/ai/capabilities'
    assert client.get(base).status_code==401
    c=client.get(base,headers={'Authorization':'Bearer synthetic'})
    assert c.status_code==200 and c.json()['drafting_available'] is False
    assert client.post('/workspaces/biz_A/ai/plan-draft',headers={'Authorization':'Bearer synthetic'},json={'goal':'enquiries'}).status_code==503
    assert calls==[] # no RLS access when disabled


def test_deny_cross_tenant_even_when_enabled(monkeypatch):
    enable_model(monkeypatch)
    client,calls=make_api(monkeypatch,allow=False)
    assert client.post('/workspaces/biz_A/ai/plan-draft',headers={'Authorization':'Bearer synthetic'},json={'goal':'enquiries'}).status_code==403
    assert calls==[]


def test_enabled_draft_is_review_only_and_has_no_dispatch(monkeypatch):
    enable_model(monkeypatch)
    client,calls=make_api(monkeypatch)
    r=client.post('/workspaces/biz_A/ai/plan-draft',headers={'Authorization':'Bearer synthetic'},json={'goal':'conversion'})
    assert r.status_code==200, r.text
    data=r.json()
    assert data['model_generated'] and data['status']=='draft_for_review'
    assert data['workspace_id']=='biz_A'
    assert not data['saved'] and not data['dispatched']
    assert data['requires_human_review']
    assert data['evidence']['stage_counts']=={'enquiry':1,'qualified':1}
    assert all(x[0]!='POST' for x in calls if isinstance(x,tuple))
    assert client.post('/workspaces/biz_A/ai/plan-draft',headers={'Authorization':'Bearer synthetic'},json={'goal':'invalid'}).status_code==422


def test_fail_closed_when_provider_receives_wrong_workspace_rows(monkeypatch):
    enable_model(monkeypatch)
    client,calls=make_api(monkeypatch,cross=True)
    r=client.post('/workspaces/biz_A/ai/plan-draft',headers={'Authorization':'Bearer synthetic'},json={'goal':'enquiries'})
    assert r.status_code==502
    assert not any(x[0]=='model' for x in calls)


def test_plain_english_brief_accepts_context_but_rejects_contact_data():
    good=DraftRequest(goal='enquiries',brief='  I need better enquiries from industrial buyers  ')
    assert good.brief=='I need better enquiries from industrial buyers'
    for bad in ['call +919876543210','email me@company.com','visit https://example.com']:
        with pytest.raises(ValidationError):DraftRequest(goal='campaign',brief=bad)
    assert 'industrial buyers' in json.dumps(prompt_messages('enquiries',{'sampled_rows':0,'sample_limit':1000,'may_be_truncated':False,'stage_counts':{}}, good.brief))


@pytest.mark.asyncio
async def test_model_generated_contact_details_fail_closed(monkeypatch):
    enable_model(monkeypatch)
    for content in ['Contact sales@example.org for information',
                    'See https://sample.invalid for verified buyer data',
                    'Call +91 98765 43210 for the list']:
        fixture=json.loads(json.dumps(FIXTURE))
        fixture['steps'][0]['action']='This is the required next step: '+content
        def handler(request):
            return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps(fixture)}}]})
        with pytest.raises(HTTPException) as err:
            await generate_model_draft('enquiries',
              {'sampled_rows':1,'sample_limit':1000,'may_be_truncated':False,'stage_counts':{'enquiry':1}},
              transport=httpx.MockTransport(handler))
        assert err.value.status_code==503


def test_model_output_extra_fields_and_contact_info_rejected():
    for addition in ({'marketing_dispatch':True}, {'rationale':'Contact sales@example.org before briefing'}):
        fixture={**FIXTURE, **addition}
        with pytest.raises(ValidationError): ModelDraft.model_validate(fixture)
