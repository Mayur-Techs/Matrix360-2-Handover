#!/usr/bin/env python3
"""Read-only anonymous Tanmayi recovery-staging API contract smoke check.
Never submits a prompt, creates media, reads client records or uses credentials.
"""
import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
BASE = "https://matrix360-socialmanager-recovery-staging.onrender.com"

def probe(path):
    request=Request(BASE+path,headers={"Accept":"application/json","Cache-Control":"no-store",
                                      "User-Agent":"Matrix360-Integration-ReadOnly/1"})
    try:
        response=urlopen(request,timeout=35)
    except HTTPError as exc:
        response=exc
    with response:
        raw=response.read(5000)
        status=response.status if hasattr(response,"status") else response.code
        content_type=response.headers.get("Content-Type","")
    try:
        content=json.loads(raw)
    except ValueError:
        content=None
    return status,content_type,content

def main():
    fails=0
    for path,expected in [("/health",{200}),("/api/capabilities",{401,403}),("/api/v2/clients",{401,403})]:
        try:
            code,ctype,data=probe(path)
            passed=code in expected and isinstance(data,(dict,list)) and "html" not in ctype.lower()
            if path=="/health" and isinstance(data,dict) and data.get("production_equivalent") is True:
                passed=False
            print(("PASS" if passed else "FAIL"),"Tanmayi",path,"HTTP",code)
            if not passed:fails+=1
        except (URLError,TimeoutError,OSError) as exc:
            print("BLOCKED",path,type(exc).__name__);fails+=1
    try:
        code, ctype, data = probe("/health/media")
        if code == 200 and isinstance(data, dict):
            keys = (
                "image_ready", "cloudflare_configured",
                "cloudflare_enabled", "cloudflare_quota_authorized",
                "pixabay_ready", "durable_cache_ready"
            )
            readiness = {key: data.get(key) for key in keys}
            print("LIVE MEDIA READINESS:", json.dumps(readiness, sort_keys=True))
        else:
            print("LIVE MEDIA READINESS: unavailable (HTTP %s)" % code)
    except (URLError, TimeoutError, OSError) as exc:
        print("LIVE MEDIA READINESS: transport unavailable (%s)" % type(exc).__name__)
    print("NOTE: provider-readiness flags do not prove completed images or playable MP4s.")
    print("NOTE: no key, real media creation, tenant bridge or playback is verified by this check.")
    return 1 if fails else 0
if __name__=="__main__":
    sys.exit(main())
