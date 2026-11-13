"""Independent contract tests: portable AI router with arbitrary dynamic tenants.
No Supabase or hosted model is called; mocks assert the API authorization boundary.
"""
import json
import sys
from pathlib import Path
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from matrix360_ai_plans import install_ai_plan_routes,ModelDraft

DYNAMIC_A='biz_20261020_aa529f87'
DYNAMIC_B='biz_20261020_bb13fa88'
RESPONSE=ModelDraft.model_validate({
    'headline':'Review known opportunities before outreach',
    'rationale':'The supplied pipeline sample is insufficient to claim any marketing conversion or prospect quality.',
    'steps':[
        {'title':'Validate eligible enquiries','action':'Review available CRM stage distribution with the business owner.'},
        {'title':'Confirm target market','action':'Request business approval of the location and buyer assumptions.'},
        {'title':'Prepare a draft briefing','action':'Keep campaign actions pending until the operator reviews the plan.'}
    ]
})

@pytest.fixture(autouse=True)
def enable_synthetic_adapter(monkeypatch):
    monkeypatch.setenv('M360_AI_ENABLED','true')
    monkeypatch.setenv('M360_AI_LOCAL_URL','http://127.0.0.1:11434/v1/chat/completions')
    monkeypatch.setenv('M360_AI_LOCAL_MODEL','test-fixture-only')


def create_dynamic_host(member_of=None,inject_cross_tenant=False,upstream_status=None):
    member_of=set(member_of or [DYNAMIC_A])
    trace=[]
    app=FastAPI()

    async def authenticated_user(authorization:str|None=Header(default=None)):
        trace.append(('auth',authorization))
        if authorization!='Bearer fixture-token':raise HTTPException(401,'Authentication required')
        return {'id':'synthetic-subject','token':'fixture-token'}

    async def dynamic_membership(workspace,user):
        trace.append(('membership',workspace))
        if workspace not in member_of:raise HTTPException(403,'No membership')
        return 'client_admin'

    async def scoped_rest(method,table,user,params=None):
        trace.append(('rest',method,table,params))
        assert method=='GET' and table=='m360_leads'
        assert params['select']=='workspace_id,stage'
        assert params['workspace_id']=='eq.'+DYNAMIC_A
        if upstream_status: raise HTTPException(upstream_status,'Provider unavailable')
        return [{'workspace_id':DYNAMIC_B if inject_cross_tenant else DYNAMIC_A,'stage':'enquiry'}]

    async def synthetic_model(goal,evidence,brief):
        trace.append(('model',goal,evidence,brief))
        return RESPONSE

    install_ai_plan_routes(app,authenticated_user,dynamic_membership,scoped_rest,generator=synthetic_model)
    return TestClient(app),trace


def test_dynamic_workspace_without_fixed_stage_registry():
    client,trace=create_dynamic_host()
    result=client.post('/workspaces/'+DYNAMIC_A+'/ai/plan-draft',
        headers={'Authorization':'Bearer fixture-token'},json={'goal':'enquiries','brief':'Manufacturing enquiries in West Bengal'})
    assert result.status_code==200,result.text
    assert result.json()['status']=='draft_for_review'
    assert result.json()['evidence']['stage_counts']=={'enquiry':1}
    assert [entry[0] for entry in trace]==['auth','membership','rest','model','membership']
    assert all(entry[0] not in ('dispatch','send','insert','update') for entry in trace)


def test_unknown_business_denied_before_data_and_model_access():
    client,trace=create_dynamic_host()
    r=client.post('/workspaces/'+DYNAMIC_B+'/ai/plan-draft',headers={'Authorization':'Bearer fixture-token'},json={'goal':'campaign'})
    assert r.status_code==403
    assert [x[0] for x in trace]==['auth','membership']


def test_anonymous_actor_denied_before_business_lookup():
    client,trace=create_dynamic_host()
    r=client.get('/workspaces/'+DYNAMIC_A+'/ai/capabilities')
    assert r.status_code==401
    assert [x[0] for x in trace]==['auth']


def test_provider_cross_tenant_rows_are_rejected_before_inference():
    client,trace=create_dynamic_host(inject_cross_tenant=True)
    r=client.post('/workspaces/'+DYNAMIC_A+'/ai/plan-draft',headers={'Authorization':'Bearer fixture-token'},json={'goal':'conversion'})
    assert r.status_code==502
    assert not any(x[0]=='model' for x in trace)


def test_unavailable_data_provider_does_not_call_model():
    client,trace=create_dynamic_host(upstream_status=503)
    r=client.post('/workspaces/'+DYNAMIC_A+'/ai/plan-draft',headers={'Authorization':'Bearer fixture-token'},json={'goal':'enquiries'})
    assert r.status_code==503
    assert not any(x[0]=='model' for x in trace)


def test_model_receives_only_aggregates_not_contact_fields():
    client,trace=create_dynamic_host()
    r=client.post('/workspaces/'+DYNAMIC_A+'/ai/plan-draft',headers={'Authorization':'Bearer fixture-token'},json={'goal':'enquiries','brief':'Improve high-quality industrial leads'})
    assert r.status_code==200
    generated=next(x for x in trace if x[0]=='model')
    assert generated[2]['stage_counts']=={'enquiry':1}
    assert 'workspace' not in json.dumps(generated[2]).lower()
    assert 'id' not in generated[2] and 'name' not in generated[2]


def test_revoke_membership_during_slow_inference_does_not_expose_plan():
    """A former member must not receive AI output when permission changes mid-request."""
    trace=[]
    app=FastAPI()
    grants={'allowed':True}

    async def auth(authorization: str|None=Header(default=None)):
        trace.append('auth')
        if authorization!='Bearer synthetic':raise HTTPException(401,'Sign in required')
        return {'id':'test-user','token':'synthetic'}

    async def membership(workspace,user):
        trace.append('membership')
        if workspace!=DYNAMIC_A or not grants['allowed']:
            raise HTTPException(403,'Membership revoked')
        return 'client_admin'

    async def rest(method,table,user,params=None):
        trace.append('rest')
        return [{'workspace_id':DYNAMIC_A,'stage':'enquiry'}]

    async def simulated_slow_model(goal,evidence,brief):
        trace.append('model')
        grants['allowed']=False  # Director revoked access during inference
        return RESPONSE

    install_ai_plan_routes(app,auth,membership,rest,generator=simulated_slow_model)
    r=TestClient(app).post('/workspaces/'+DYNAMIC_A+'/ai/plan-draft',
        headers={'Authorization':'Bearer synthetic'},json={'goal':'enquiries'})
    assert r.status_code==403
    assert 'headline' not in r.text
    assert trace==['auth','membership','rest','model','membership']


def test_caller_cannot_supply_dispatch_or_save_action_fields():
    client,trace=create_dynamic_host()
    for forbidden in ({'dispatch':True},{'save':True},{'run_campaign':True}):
        r=client.post('/workspaces/'+DYNAMIC_A+'/ai/plan-draft',
            headers={'Authorization':'Bearer fixture-token'},
            json={'goal':'campaign',**forbidden})
        assert r.status_code==422
        assert not any(x[0]=='model' for x in trace)
