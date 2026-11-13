import ast
from pathlib import Path

ROOT=Path(__file__).parent

def test_app_source_compiles():
    ast.parse((ROOT/'app_cloud.py').read_text())

def test_no_sqlite_dependency_in_cloud_app():
    code=(ROOT/'app_cloud.py').read_text()
    assert 'from app import STAGES' not in code
    assert 'from stages import STAGES' in code
    assert 'sqlite3' not in code

def test_all_three_stages_present():
    ns={}
    exec((ROOT/'stages.py').read_text(), ns)
    assert set(ns['STAGES'])=={'lakhotia','shree','vrindavan'}

def test_gitignore_blocks_credentials():
    content=(ROOT/'.gitignore').read_text()
    assert '.env' in content and '.venv/' in content
