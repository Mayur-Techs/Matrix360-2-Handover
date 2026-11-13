"""Check the loopback synthetic demo without real customer credentials.
Run from frontend repository root: python tools/check_synthetic_demo.py
"""
import subprocess
import sys
import time
from pathlib import Path
import httpx

ROOT=Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:9009'
FRONT='http://127.0.0.1:8000'

def main():
    server=subprocess.Popen([sys.executable,str(ROOT/'tools/run_synthetic_demo.py'),'--synthetic-demo'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    tests=[]
    def check(name,condition):
        assert condition, name
        tests.append(name)
    try:
        for _ in range(30):
            try:
                status=httpx.get(BASE+'/health',timeout=1)
                if status.status_code==200:break
            except httpx.HTTPError:pass
            time.sleep(.15)
        else:raise RuntimeError('Could not start local synthetic demo (ports 8000/9009 may be occupied)')
        check('synthetic status',status.json()['status']=='synthetic_demo_only')
        home=httpx.get(FRONT+'/index.html')
        check('approved website served',home.status_code==200 and 'Your business.' in home.text)
        html=httpx.get(FRONT+'/login.html').text
        check('local demo configured','window.MATRIX360_CRM_CONFIG' in html)
        check('anonymous CRM rejected',httpx.get(BASE+'/me/workspaces').status_code==401)
        login=httpx.post(BASE+'/auth/login',json={'username':'demo@matrix360.invalid','password':'demo-only'})
        check('synthetic login',login.status_code==200)
        h={'Authorization':'Bearer '+login.json()['access_token']}
        ws=httpx.get(BASE+'/me/workspaces',headers=h)
        check('four workspaces',ws.status_code==200 and len(ws.json())==4)
        workspace='biz_fourth_manufacturing_demo'
        stages=httpx.get(BASE+f'/workspaces/{workspace}/stages',headers=h)
        check('dynamic pipeline',stages.status_code==200 and 'enquiry' in stages.json())
        lead=httpx.post(BASE+f'/workspaces/{workspace}/leads',headers=h,json={'name':'Test demo buyer','stage':'enquiry'})
        check('synthetic lead creation',lead.status_code==201)
        lead_id=lead.json()['id']
        change=httpx.patch(BASE+f'/workspaces/{workspace}/leads/{lead_id}',headers=h,json={'stage':'qualified'})
        check('synthetic stage update',change.status_code==200)
        rows=httpx.get(BASE+f'/workspaces/{workspace}/leads',headers=h)
        check('synthetic lead read',rows.status_code==200 and any(x['id']==lead_id and x['stage']=='qualified' for x in rows.json()))
        check('other-tenant rejected',httpx.get(BASE+'/workspaces/biz_unassigned/leads',headers=h).status_code==403)
        check('model request not faked',httpx.post(BASE+f'/workspaces/{workspace}/ai/plan-draft',headers=h,json={'goal':'enquiries'}).status_code==404)
        cap=httpx.get(BASE+f'/workspaces/{workspace}/ai/capabilities',headers=h)
        check('AI unconfigured state',cap.status_code==200 and cap.json()['drafting_available'] is False)
        allowed=httpx.options(BASE+'/auth/login',headers={'Origin':FRONT,'Access-Control-Request-Method':'POST'})
        check('allowlisted origin',allowed.status_code==204)
        denied=httpx.options(BASE+'/auth/login',headers={'Origin':'https://untrusted.invalid','Access-Control-Request-Method':'POST'})
        check('outside origin rejected',denied.status_code==403)
        print(f'{len(tests)}/{len(tests)} SYNTHETIC LOCAL DEMO HTTP CHECKS PASSED. No real services used.')
    finally:
        server.terminate()
        try:server.wait(timeout=4)
        except subprocess.TimeoutExpired:server.kill()

if __name__=='__main__':main()
