"""Backup-only backend, tested through its actual FastAPI routes with mocked RLS REST.
No claims of hosted Supabase or identity-provider connectivity.
"""
import importlib
import os
import sys
from pathlib import Path
from fastapi.testclient import TestClient
from fastapi import HTTPException
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
os.environ.setdefault('MATRIX_SUPABASE_URL','https://test.supabase.co')
os.environ.setdefault('MATRIX_SUPABASE_PUBLISHABLE_KEY','test-only')
crm = importlib.import_module('app_cloud')
BIZ_A='biz_20261021_industrial'
BIZ_B='biz_20261021_realestate'

@pytest.fixture
def hosted(monkeypatch):
    history=[]
    access={BIZ_A:'client_admin',BIZ_B:'viewer'}
    records={BIZ_A:[],BIZ_B:[]}
    async def identity(): return {'id':'00000000-0000-4000-8000-000000000001','token':'synthetic-only'}
    async def db(method,table,user,params=None,payload=None,prefer=None):
        history.append((method,table,params,payload))
        if table=='m360_memberships':
            ws=params.get('workspace_id','').removeprefix('eq.')
            if ws:
                return ([{'role':access[ws]}] if ws in access else [])
            return [{'workspace_id':w,'role':r} for w,r in access.items()]
        if table=='m360_workspaces': return [{'id':w,'name':w} for w in access]
        if table!='m360_leads': raise AssertionError(table)
        ws=params.get('workspace_id','').removeprefix('eq.') if params and params.get('workspace_id') else (payload[0]['workspace_id'] if isinstance(payload,list) else payload['workspace_id'])
        if method=='GET':return list(records[ws])
        if method=='POST':
            values=payload if isinstance(payload,list) else [payload]
            inserted=[]
            for value in values:
                if any(value.get('import_key') and value.get('import_key')==row.get('import_key') for row in records[ws]):continue
                record={**value,'id':len(records[ws])+1};records[ws].append(record);inserted.append(record)
            return inserted
        if method=='PATCH':
            target=int(params['id'].removeprefix('eq.'))
            for r in records[ws]:
                if r['id']==target:r.update(payload);return [r]
            return []
        raise AssertionError(method)
    crm.app.dependency_overrides[crm.authenticated_user]=identity
    monkeypatch.setattr(crm,'rest',db)
    # dependency override does not alter membership route's reference to module rest? it does.
    with TestClient(crm.app) as client:
        yield client,history,access,records
    crm.app.dependency_overrides.clear()

def test_new_business_can_list_stages_create_lead_and_update(hosted):
    client,history,access,records=hosted
    assert client.get(f'/workspaces/{BIZ_A}/stages').json()==crm.GENERIC_STAGES
    new=client.post(f'/workspaces/{BIZ_A}/leads',json={'name':'Test machine buyer','stage':'enquiry'})
    assert new.status_code==201,new.text
    lead=new.json()
    assert lead['workspace_id']==BIZ_A
    assert client.get(f'/workspaces/{BIZ_A}/leads').json()[0]['id']==lead['id']
    updated=client.patch(f'/workspaces/{BIZ_A}/leads/{lead["id"]}',json={'stage':'qualified'})
    assert updated.status_code==200,updated.text
    assert records[BIZ_A][0]['stage']=='qualified'

def test_batch_import_retains_contact_and_consent_fields_and_deduplicates(hosted):
    client,_,_,records=hosted
    payload={'import_batch_id':'batch-1','records':[{'name':'Consented buyer','email':'buyer@example.com','source':'authorized CSV','stage':'enquiry','email_opt_in_status':'granted','consent_evidence':{'email':True,'source':'signed form','captured_at':'2026-11-01T00:00:00Z'}}]}
    first=client.post(f'/workspaces/{BIZ_A}/leads/import',json=payload)
    assert first.status_code==201 and first.json()['accepted_count']==1
    assert records[BIZ_A][0]['email']=='buyer@example.com'
    assert records[BIZ_A][0]['consent_evidence']['email'] is True
    second=client.post(f'/workspaces/{BIZ_A}/leads/import',json=payload)
    assert second.status_code==201 and second.json()['accepted_count']==0 and second.json()['rejected_count']==1

def test_viewer_cannot_write(hosted):
    client,history,access,_=hosted
    assert client.get(f'/workspaces/{BIZ_B}/stages').status_code==200
    assert client.post(f'/workspaces/{BIZ_B}/leads',json={'name':'Denied'}).status_code==403
    assert not any(x[0]=='POST' for x in history)

def test_nonmember_cannot_read_or_mutate(hosted):
    client,history,access,_=hosted
    unknown='biz_not_a_member'
    assert client.get(f'/workspaces/{unknown}/leads').status_code==403
    assert client.patch(f'/workspaces/{unknown}/leads/1',json={'stage':'won'}).status_code==403
    assert not any(x[1]=='m360_leads' for x in history)

def test_workspace_filter_injection_rejected(hosted):
    client,history,_,_=hosted
    result=client.get('/workspaces/x%2Cbad/stages')
    assert result.status_code==404
    assert not history

def test_legacy_stage_mapping_remains(hosted):
    client,history,access,_=hosted
    access['lakhotia']='client_admin'
    assert client.get('/workspaces/lakhotia/stages').json()==crm.STAGES['lakhotia']

def test_cross_tenant_rows_rejected(hosted,monkeypatch):
    client,history,access,_=hosted
    initial=crm.rest
    async def cross(method,table,user,params=None,payload=None,prefer=None):
        if table=='m360_leads':
            return [{'workspace_id':BIZ_B,'id':123,'stage':'enquiry'}]
        return await initial(method,table,user,params=params,payload=payload,prefer=prefer)
    monkeypatch.setattr(crm,'rest',cross)
    response=client.get(f'/workspaces/{BIZ_A}/leads')
    assert response.status_code==502

def test_workspaces_derived_from_actual_membership(hosted):
    client,_,access,_=hosted
    response=client.get('/me/workspaces')
    assert response.status_code==200
    assert set(x['id'] for x in response.json())==set(access)


def test_local_preview_cors_is_explicitly_allowlisted(hosted):
    client, _, _, _ = hosted
    for allowed in ('http://localhost:8000', 'http://127.0.0.1:8000'):
        r = client.options('/auth/login', headers={
            'Origin': allowed,
            'Access-Control-Request-Method':'POST',
            'Access-Control-Request-Headers':'content-type'
        })
        assert r.status_code == 200, r.text
        assert r.headers.get('access-control-allow-origin') == allowed
    blocked = client.options('/auth/login', headers={
        'Origin': 'https://untrusted.invalid',
        'Access-Control-Request-Method':'POST'
    })
    assert blocked.status_code == 400
