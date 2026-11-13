"""Reconstruct inspectable sources, never execute the Render build command.

Only --download accesses the network (two checksum-pinned source archives).
No application imports, credentials, scraper execution or deployment actions.
"""
from pathlib import Path
import argparse
import ast
import base64
import hashlib
import io
import json
import re
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RECOVERED = HERE / '.recovered'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def apply_diff(root, patch):
    """Apply exact unified hunks without shell/build execution or fuzz."""
    lines = patch.splitlines(keepends=True)
    i = 0
    while i < len(lines):
        assert lines[i].startswith('--- ')
        old = lines[i][4:].strip()
        name = lines[i + 1][4:].strip().removeprefix('b/')
        target = root / name
        assert target.resolve().is_relative_to(root.resolve())
        original = [] if old == '/dev/null' else target.read_text(encoding='utf-8').splitlines(keepends=True)
        output, cursor = [], 0
        i += 2
        while i < len(lines) and lines[i].startswith('@@'):
            match = re.match(r'@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@', lines[i])
            start = max(0, int(match.group(1)) - 1)
            end = i + 1
            while end < len(lines) and not lines[end].startswith(('@@', '--- ')):
                end += 1
            expected = [line[1:] for line in lines[i+1:end] if line[0] in ' -']
            if original[start:start+len(expected)] != expected:
                positions = [p for p in range(cursor, len(original)+1)
                             if original[p:p+len(expected)] == expected]
                assert len(positions) == 1, (name, 'Non-unique exact patch context')
                start = positions[0]
            assert start >= cursor
            output.extend(original[cursor:start])
            cursor = start
            i += 1
            while i < len(lines) and not lines[i].startswith(('@@', '--- ')):
                line = lines[i]
                if line[0] in ' -':
                    assert original[cursor] == line[1:], (name, cursor + 1)
                    cursor += 1
                if line[0] in ' +':
                    output.append(line[1:])
                i += 1
        output.extend(original[cursor:])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(''.join(output), encoding='utf-8', newline='\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    build_file = ROOT / 'workstreams/romit/optimizations/RENDER_BUILD_COMMAND_ONE_LINE_20261024.txt'
    # Extract only a Python string literal from the shell wrapper.
    wrapper = build_file.read_text().strip()[len("python -c '"):-1]
    body = ast.literal_eval(ast.parse(wrapper).body[0].value.args[0])
    tree = ast.parse(body)
    encoded = next(n.args[0].value for n in ast.walk(tree)
                   if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                   and n.func.attr == 'b64decode')
    packed = base64.b64decode(encoded)
    dictionary, decoded = [b''], bytearray()
    for i in range(0, len(packed), 3):
        index, char = (packed[i] << 8) | packed[i+1], packed[i+2]
        word = dictionary[index] + (bytes([char]) if char else b'')
        dictionary.append(word)
        decoded.extend(word)
    build = decoded.decode()
    blocks = re.findall(r"python - <<'PY'\n(.*?)\nPY", build, re.S)
    sources = ast.literal_eval(next(n.value for n in ast.parse(blocks[0]).body
                                   if isinstance(n, ast.Assign) and n.targets[0].id == 'sources'))
    RECOVERED.mkdir(exist_ok=True)
    app = RECOVERED / 'runtime'
    backend = app / 'original_backend'
    backend.mkdir(parents=True, exist_ok=True)
    identities = []
    for index, (url, expected) in enumerate(sources):
        archive = RECOVERED / (expected + '.zip')
        if not archive.exists():
            if not args.download:
                raise SystemExit('Missing verified archive; run with --download once')
            with urllib.request.urlopen(url, timeout=45) as response:
                raw = response.read(2_000_001)
            assert len(raw) <= 2_000_000 and sha(raw) == expected
            archive.write_bytes(raw)
        raw = archive.read_bytes()
        assert sha(raw) == expected
        with zipfile.ZipFile(io.BytesIO(raw)) as zipped:
            for name in zipped.namelist():
                marker = '/workstreams/avinash/crm-backend/'
                if index == 0 and marker in name:
                    relative = name.split(marker, 1)[1]
                    if not relative.endswith('.py') or '__pycache__' in relative:
                        continue
                    target = backend / relative
                elif index == 1 and name == 'preview_app.py':
                    target = app / name
                else:
                    continue
                assert target.resolve().is_relative_to(app.resolve())
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(zipped.read(name))
        identities.append({'url': url, 'sha256': expected})
    maps = backend / 'scraper/maps_agent.py'
    maps.write_text(maps.read_text(encoding='utf-8').replace('for _ in range(6):', 'for _ in range(3):').replace('6-Tab', '3-Tab'), encoding='utf-8', newline='\n')
    service = backend / 'scraper_service.py'
    service.write_text(service.read_text(encoding='utf-8').replace('6-Tab', '3-Tab'), encoding='utf-8', newline='\n')
    for block in blocks:
        for node in ast.walk(ast.parse(block)):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'write_text' and node.args and isinstance(node.args[0], ast.Constant):
                patch = node.args[0].value
                if isinstance(patch, str) and patch.startswith('--- '):
                    # Apply no-guard replacement between the two checked-in patches.
                    if 'phase_separated.patch' in ast.unparse(node.func):
                        guard_block = next(b for b in blocks if 'old="""class BudgetMonitor:' in b)
                        replacements = {n.targets[0].id: ast.literal_eval(n.value) for n in ast.parse(guard_block).body if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id in ('old','new')}
                        low = backend / 'scraper/low_memory_agent.py'
                        before = low.read_text(encoding='utf-8')
                        assert before.count(replacements['old']) == 1
                        before = before.replace(replacements['old'], replacements['new'])
                        before = before.replace('# 400 MB decimal user requirement: leave 20 MB guard band for unobserved spikes.\nDEFAULT_BUDGET_MB = 380\n', '# No application-level RAM ceiling; retain container memory telemetry.\n')
                        low.write_text(before, encoding='utf-8', newline='\n')
                    apply_diff(backend, patch)
    files = {}
    for path in sorted(app.rglob('*.py')):
        ast.parse(path.read_text(encoding='utf-8-sig'))
        files[str(path.relative_to(app)).replace('\\', '/')] = sha(path.read_bytes())
    manifest = {'archives': identities, 'build_command_sha256': sha(build_file.read_bytes().rstrip(b'\r\n')),
                'decoded_build_script_sha256': sha(bytes(decoded)), 'files_sha256': files}
    (HERE / 'packaged-source-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'python_files': len(files), 'build_command_sha256': manifest['build_command_sha256'], 'decoded_build_script_sha256': manifest['decoded_build_script_sha256']}))


if __name__ == '__main__':
    main()
