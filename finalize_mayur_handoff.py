"""Finalize and integrity-check the reviewed handoff archive."""
from pathlib import Path
import ast
import hashlib
import json
import re
import zipfile

root=Path(__file__).resolve().parent
folder=root/'Matrix360-Mayur-Handoff-2026-10-29'
manifest_path=folder/'FILE_MANIFEST.json'
manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
source_env=root/'romit-acceptance-20261027 copy for anti gravity/workstreams/avinash/frontend/.env.local'
packaged_env=folder/'workstreams/avinash/frontend/.env.local'
packaged_env.write_bytes(source_env.read_bytes())
manifest[packaged_env.relative_to(folder).as_posix()]={'source':'Current workspace environment, included by project-owner request on 2026-10-29'}
logo=folder/'workstreams/avinash/frontend/matrix360-logo-full.png'
destination=folder/'workstreams/avinash/frontend-source/matrix360-logo-full.png'
destination.write_bytes(logo.read_bytes())
manifest[destination.relative_to(folder).as_posix()]={'source':'Current workspace logo copied into editable source assets'}

validation='''# Validation — 29 October 2026

- Original source archive checksum matched the recorded SHA-256 before extraction.
- `npm test`: 29 tests passed, 0 failed. Tests use mocked network services.
- Packaged local adapter started on 127.0.0.1:8029 independently of the existing preview.
- HTTP smoke checks passed for real login/dashboard, Control Center injection, compiled product/navigation/router JavaScript, versioned same-origin API configuration, missing-secret HTTP 503, and refusal to serve environment/API-source/manifest files.
- The current full logo was included in the editable asset directory.
- Python source parsed without executing backend services.
- `.env.local` was included at the project owner's explicit request. Its values were not printed.
- ZIP contents and SHA-256 manifest were verified after creation; databases, sessions, .vercel, Git metadata, caches, logs, lead exports and synthetic-demo launchers were excluded.

Not verified: real-account browser login in this extracted copy, live campaign execution, OpenAI/media generation, current hosted backend source parity, full Python backend startup or end-to-end browser regression. The portable adapter is development-only; Vercel deployment behavior still needs its own verification.
'''
(folder/'VALIDATION.md').write_text(validation,encoding='utf-8')
for file in folder.rglob('*.py'):
    ast.parse(file.read_text(encoding='utf-8-sig'),filename=str(file))

violations=[]
for file in folder.rglob('*'):
    if not file.is_file():continue
    rel=file.relative_to(folder)
    assert not any(p in {'.git','.vercel','__pycache__','node_modules','.venv','output'} for p in rel.parts),str(rel)
    assert not file.name.startswith('.env') or file.name in {'.env.example','.env.local'},str(rel)
    assert file.suffix not in {'.db','.sqlite','.sqlite3','.log','.pyc','.csv'},str(rel)
    if file != packaged_env and file.suffix in {'.js','.cjs','.py','.md','.txt','.json','.html','.ps1'}:
        text=file.read_text(encoding='utf-8-sig')
        if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-|svcacct-)[A-Za-z0-9_-]{30,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{15,}',text):
            violations.append(rel.as_posix())
    if file!=manifest_path:
        key=rel.as_posix()
        previous=manifest.get(key,{'source':'Handoff packaging addition, 2026-10-29'})
        previous['sha256']=hashlib.sha256(file.read_bytes()).hexdigest()
        manifest[key]=previous
assert not violations,'Credential-like literal detected in: '+', '.join(violations)
manifest_path.write_text(json.dumps(dict(sorted(manifest.items())),indent=2)+'\n',encoding='utf-8')
archive=root/(folder.name+'.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for file in sorted(folder.rglob('*')):
        if file.is_file():z.write(file,folder.name+'/'+file.relative_to(folder).as_posix())
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for rel,record in manifest.items():
        assert hashlib.sha256(z.read(folder.name+'/'+rel)).hexdigest()==record['sha256'],rel
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
(root/(archive.name+'.sha256')).write_text(digest+'  '+archive.name+'\n',encoding='ascii')
print(json.dumps({'zip':str(archive),'files':len(manifest)+1,'bytes':archive.stat().st_size,'sha256':digest},indent=2))
