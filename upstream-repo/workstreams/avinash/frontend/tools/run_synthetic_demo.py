"""Matrix 360 controlled LOCAL demo, backup-derived frontend, NO external connections.

Run `python tools/run_synthetic_demo.py --synthetic-demo` from the frontend repo root.
Only loopback 127.0.0.1 is used. No real passwords, Supabase, Render, AI or dispatch.
Never deploy this development-only script as a public service.
"""
import argparse
import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]
HOST = '127.0.0.1'
FRONT_PORT = 8000
API_PORT = 9009
ORIGINS = {'http://127.0.0.1:8000', 'http://localhost:8000'}
STAGES = ['enquiry','qualified','consultation','proposal','negotiation','won','lost']
WORKSPACES = [
    {'id':'biz_fourth_manufacturing_demo','name':'Demo · Fourth Manufacturing Business','role':'client_admin'},
    {'id':'shree','name':'Demo · Residential Client','role':'client_admin'},
    {'id':'lakhotia','name':'Demo · Industrial Client','role':'client_admin'},
    {'id':'vrindavan','name':'Demo · Plotted Development Client','role':'client_admin'},
]
INITIAL = {
    'biz_fourth_manufacturing_demo':[{'id':1,'workspace_id':'biz_fourth_manufacturing_demo','name':'Example industrial enquiry','source':'Synthetic website','stage':'enquiry'}],
    'shree':[{'id':1,'workspace_id':'shree','name':'Example homebuyer enquiry','source':'Synthetic event','stage':'qualified'}],
    'lakhotia':[], 'vrindavan':[]
}
state = {'token':secrets.token_urlsafe(25),'leads':{key:[dict(row) for row in val] for key,val in INITIAL.items()}}

class DemoAPI(BaseHTTPRequestHandler):
    def _cors(self):
        origin=self.headers.get('Origin','')
        return origin if origin in ORIGINS else None

    def send_json(self, code, obj):
        body=json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        allow=self._cors()
        if allow:self.send_header('Access-Control-Allow-Origin',allow)
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers();self.wfile.write(body)

    def authed(self):return self.headers.get('Authorization') == 'Bearer '+state['token']

    def read_payload(self):
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<0 or size>16384:raise ValueError()
            data=json.loads(self.rfile.read(size))
            if not isinstance(data,dict):raise ValueError()
            return data
        except (ValueError,UnicodeDecodeError,json.JSONDecodeError):return None

    def target(self):
        bits=unquote(urlsplit(self.path).path).strip('/').split('/')
        if len(bits)<3 or bits[0]!='workspaces':return None,None
        return bits[1],bits[2:]

    def do_OPTIONS(self):
        origin=self._cors()
        if not origin:self.send_json(403,{'detail':'Origin not authorized for the local demonstration'});return
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin',origin)
        self.send_header('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type')
        self.send_header('Access-Control-Max-Age','300')
        self.end_headers()

    def do_GET(self):
        path=urlsplit(self.path).path
        if path in ('/health','/ready'):
            self.send_json(200,{'status':'synthetic_demo_only','live_integrations':False});return
        if not self.authed():self.send_json(401,{'detail':'Synthetic sign-in required'});return
        if path=='/me/workspaces':self.send_json(200,WORKSPACES);return
        workspace,rest=self.target()
        if workspace not in state['leads']:
            self.send_json(403,{'detail':'Synthetic workspace not authorized'});return
        if rest==['stages']:self.send_json(200,STAGES);return
        if rest==['leads']:self.send_json(200,list(state['leads'][workspace]));return
        if rest==['ai','capabilities']:
            self.send_json(200,{'mode':'disabled','drafting_available':False,'reason':'No real model configured in synthetic demo'});return
        self.send_json(404,{'detail':'Not configured in synthetic demo'})

    def do_POST(self):
        path=urlsplit(self.path).path
        data=self.read_payload()
        if data is None:self.send_json(400,{'detail':'Invalid JSON request'});return
        if path=='/auth/login':
            if data.get('username')=='demo@matrix360.invalid' and data.get('password')=='demo-only':
                self.send_json(200,{'access_token':state['token'],'token_type':'bearer','expires_in':3600})
            else:self.send_json(401,{'detail':'Only published synthetic demo credentials work'})
            return
        if not self.authed():self.send_json(401,{'detail':'Synthetic sign-in required'});return
        if path=='/auth/logout':self.send_json(200,{'ok':True});return
        ws,rest=self.target()
        if ws not in state['leads']:
            self.send_json(403,{'detail':'Synthetic workspace not authorized'});return
        if rest!=['leads']:
            self.send_json(404,{'detail':'No campaign dispatch, model inference or registration in demo'});return
        name=data.get('name')
        if not isinstance(name,str) or not name.strip() or len(name)>200 or data.get('stage','enquiry') not in STAGES:
            self.send_json(422,{'detail':'Invalid demonstration lead'});return
        leads=state['leads'][ws]
        lead={'id':max([r['id'] for r in leads],default=0)+1,'workspace_id':ws,
              'name':name.strip(),'source':data.get('source') or None,'stage':data.get('stage','enquiry')}
        leads.insert(0,lead)
        self.send_json(201,lead)

    def do_PATCH(self):
        data=self.read_payload()
        if data is None:self.send_json(400,{'detail':'Invalid request'});return
        if not self.authed():self.send_json(401,{'detail':'Synthetic sign-in required'});return
        ws,rest=self.target()
        if ws not in state['leads']:
            self.send_json(403,{'detail':'Synthetic workspace not authorized'});return
        if not rest or len(rest)!=2 or rest[0]!='leads' or data.get('stage') not in STAGES:
            self.send_json(422,{'detail':'Invalid stage update'});return
        try:lead_id=int(rest[1])
        except ValueError:self.send_json(404,{'detail':'Lead not found'});return
        for lead in state['leads'][ws]:
            if lead['id']==lead_id:
                lead['stage']=data['stage'];self.send_json(200,{'ok':True,'id':lead_id,'stage':lead['stage']});return
        self.send_json(404,{'detail':'Lead not found'})

class DemoFrontend(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def do_GET(self):
        name=urlsplit(self.path).path.lstrip('/')
        if name in ('login.html','client-dashboard.html'):
            original=(ROOT/name).read_text(encoding='utf-8')
            script='<script>window.MATRIX360_CRM_CONFIG={apiBase:"http://127.0.0.1:9009"};</script>'
            assert '<script src="matrix360-api-config.js"></script>' in original
            html=original.replace('<script src="matrix360-api-config.js"></script>',script+'<script src="matrix360-api-config.js"></script>')
            banner='<script>document.addEventListener("DOMContentLoaded",()=>{const p=document.createElement("div");p.textContent="LOCAL SYNTHETIC DEMO — no real customers, AI or campaigns";Object.assign(p.style,{position:"fixed",bottom:"0",left:"0",right:"0",zIndex:"99999",background:"#183e31",color:"white",padding:"9px",font:"600 12px Arial",textAlign:"center"});document.body.appendChild(p);});</script>'
            html=html.replace('</body>',banner+'</body>')
            body=html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers();self.wfile.write(body);return
        super().do_GET()

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--synthetic-demo',action='store_true',help='Required explicit opt-in to run the local mock API')
    args=parser.parse_args()
    if not args.synthetic_demo:parser.error('Add --synthetic-demo; this never connects to real client systems')
    api=ThreadingHTTPServer((HOST,API_PORT),DemoAPI)
    app=ThreadingHTTPServer((HOST,FRONT_PORT),DemoFrontend)
    threading.Thread(target=api.serve_forever,daemon=True).start()
    print('\nMATRIX 360 — SYNTHETIC, LOOPBACK-ONLY DEMONSTRATION')
    print(f'Website: http://{HOST}:{FRONT_PORT}/')
    print('Demo username: demo@matrix360.invalid')
    print('Demo password: demo-only')
    print('AI, external research, campaign dispatch and real CRM: NOT CONNECTED')
    print('Stop with Ctrl+C; synthetic leads exist only in process memory.\n')
    try:app.serve_forever()
    except KeyboardInterrupt:pass
    finally:app.server_close();api.shutdown();api.server_close()
