#!/usr/bin/env python3
"""Read-only unauthenticated recovery preview smoke test. No credentials or customer data."""
import argparse, urllib.request, urllib.error, json
p=argparse.ArgumentParser();p.add_argument("--frontend",required=True);a=p.parse_args()
if not a.frontend.startswith("https://"): raise SystemExit("HTTPS frontend required")
fail=False
for path,accepted in [("/api/crm/health",{200}),("/api/crm/me/workspaces",{401,403})]:
  try:
    with urllib.request.urlopen(urllib.request.Request(a.frontend.rstrip("/")+path,headers={"Accept":"application/json","Cache-Control":"no-store"}),timeout=20) as r:
      status,ctype,data=r.status,r.headers.get("content-type",""),r.read(12000)
  except urllib.error.HTTPError as e:
    status,ctype,data=e.code,e.headers.get("content-type",""),e.read(12000)
  except Exception as e:
    print("BLOCKED",path,type(e).__name__);fail=True;continue
  try: json.loads(data);isjson=True
  except ValueError: isjson=False
  ok=status in accepted and isjson and "html" not in ctype.lower()
  print("PASS" if ok else "BLOCKED",path,"HTTP",status,"JSON" if isjson else "NOT_JSON")
  fail|=not ok
if fail: raise SystemExit("Hosted checks not verified. May require signed-in Vercel preview access.")
print("Unauthenticated proxy checks passed. Real login and tenant isolation NOT tested.")
