"""Standalone isolated hosting adapter for the *unchanged* Matrix 360 Maps V4 scraper.

The original service and database Python files are extracted without changes.
This adapter enforces server-side workspace isolation and a signed upstream gateway.
The storage is preview-only and ephemeral, not a production CRM data store.
"""
from __future__ import annotations

import asyncio
import contextvars
import hashlib
import os
import re
import secrets
import sqlite3
import sys
import threading
from contextlib import contextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse

BASE = Path(os.environ.get('M360_ORIGINAL_BACKEND_DIR', Path(__file__).parent / 'original_backend')).resolve()
DATA_ROOT = Path(os.environ.get('M360_TENANT_DATA_ROOT', Path(__file__).parent / 'tenant_data')).resolve()
DATA_ROOT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(BASE))

import scraper_database as database  # noqa: E402
import scraper_service as service  # noqa: E402

_active_workspace = contextvars.ContextVar('m360_scraper_workspace', default='')
_workspace_re = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$')
_init_lock = threading.RLock()
_managers_lock = threading.RLock()
_global_job_lock = threading.Lock()  # free-tier instance has one supported live browser job
_initialized = set()
_managers: dict[str, service.ScraperPipelineManager] = {}


def scoped_connection():
    workspace = _active_workspace.get()
    if not _workspace_re.fullmatch(workspace):
        raise RuntimeError('Scraper database requires authenticated workspace scope')
    name = hashlib.sha256(workspace.encode('utf-8')).hexdigest() + '.db'
    with _init_lock:
        DATA_ROOT.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(DATA_ROOT / name), timeout=25.0)
    connection.execute('PRAGMA journal_mode=WAL')
    connection.execute('PRAGMA synchronous=NORMAL')
    connection.execute('PRAGMA busy_timeout=25000')
    return connection


database.get_connection = scoped_connection


@contextmanager
def scope(workspace):
    token = _active_workspace.set(workspace)
    try:
        with _init_lock:
            if workspace not in _initialized:
                database.init_db()
                _initialized.add(workspace)
        yield
    finally:
        _active_workspace.reset(token)


class ScopedPipelineManager(service.ScraperPipelineManager):
    """Preserves original scraping logic; only propagates workspace to its thread."""
    def __init__(self, workspace):
        super().__init__()
        self.workspace = workspace

    def start_background_job(self, params):
        with self.lock:
            if self.is_running:
                return {'status': 'busy', 'message': 'This workspace already has an active discovery.'}
            if not _global_job_lock.acquire(blocking=False):
                return {'status': 'busy', 'message': 'Preview is serving another discovery; retry after it completes.'}
            self.is_running = True
        context = contextvars.copy_context()
        def target():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                context.run(loop.run_until_complete, self._execute_async_pipeline(params))
            finally:
                loop.close()
                _global_job_lock.release()
        try:
            threading.Thread(target=target, daemon=True).start()
        except Exception:
            self.is_running = False
            _global_job_lock.release()
            raise
        return {'status': 'started', 'target_quota': params.get('max_leads') or params.get('max_results') or 100}


def manager(workspace):
    with _managers_lock:
        if workspace not in _managers:
            _managers[workspace] = ScopedPipelineManager(workspace)
        return _managers[workspace]


app = FastAPI(title='Matrix 360 Original Maps V4 — Tenant-Isolated Preview')


@app.middleware('http')
async def require_authorized_gateway(request: Request, call_next):
    if request.url.path == '/health':
        return JSONResponse({'status': 'ok', 'service': 'original-maps-v4', 'tenant_scope': 'required', 'data': 'ephemeral'})
    expected = os.environ.get('M360_ROMIT_ORIGINAL_SCRAPER_PREVIEW_KEY', '')
    supplied = request.headers.get('x-m360-preview-proxy-key', '')
    workspace = request.headers.get('x-m360-workspace-id', '')
    if len(expected) < 32 or not secrets.compare_digest(expected, supplied):
        return JSONResponse({'status': 'error', 'message': 'Private gateway required'}, status_code=403)
    if not _workspace_re.fullmatch(workspace):
        return JSONResponse({'status': 'error', 'message': 'Verified workspace is required'}, status_code=403)
    request.state.workspace = workspace
    # Middleware and route may execute as different async task contexts. Set scope in route.
    return await call_next(request)


def authorized_ws(request: Request) -> str:
    workspace = getattr(request.state, 'workspace', '')
    if not _workspace_re.fullmatch(workspace):
        raise HTTPException(403, 'Invalid workspace')
    return workspace


@app.get('/api/scraper/leads')
async def leads(request: Request):
    with scope(authorized_ws(request)):
        return service.query_saved_leads(dict(request.query_params))


@app.delete('/api/scraper/leads')
async def clear(request: Request):
    with scope(authorized_ws(request)):
        if manager(request.state.workspace).is_running:
            raise HTTPException(409, 'Cannot clear leads during an active discovery')
        database.clear_leads()
        return {'status': 'ok', 'message': 'Cleared this workspace prospect database.'}


@app.post('/api/scraper/run')
async def run(request: Request):
    with scope(authorized_ws(request)):
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(422, 'Invalid discovery payload')
        quota = payload.get('max_leads', payload.get('max_results', 100))
        try:
            count = int(quota)
        except (ValueError, TypeError):
            raise HTTPException(422, 'Invalid quota')
        if not 1 <= count <= 2000:
            raise HTTPException(422, 'Quota must be 1–2000')
        query = (payload.get('keyword') or payload.get('query') or '').strip()
        location = (payload.get('location') or '').strip()
        if not query or not location or len(query)>300 or len(location)>300:
            raise HTTPException(422, 'Valid industry and location required')
        return manager(request.state.workspace).start_background_job(payload)


@app.get('/api/scraper/status')
async def status(request: Request):
    with scope(authorized_ws(request)):
        return manager(request.state.workspace).get_status()


@app.post('/api/scraper/stop')
async def stop(request: Request):
    with scope(authorized_ws(request)):
        manager(request.state.workspace).request_stop()
        return {'status': 'stopped', 'message': 'Stop requested in this workspace.'}


@app.get('/api/scraper/suppression')
async def suppression(request: Request):
    with scope(authorized_ws(request)):
        return {'status': 'ok', 'count': database.get_suppression_count(), 'items': database.get_suppression_items()}


@app.post('/api/scraper/suppression')
async def edit_suppression(request: Request):
    with scope(authorized_ws(request)):
        data = await request.json()
        action = str(data.get('action', 'add')).lower()
        if action == 'clear':
            database.clear_suppression_list()
        elif action == 'remove':
            database.remove_suppression_item(data.get('term_id') or (data.get('terms') or [''])[0])
        else:
            terms = data.get('terms') or []
            if data.get('raw_text') and not terms:
                import re
                terms = [s.strip() for s in re.split(r'[\r\n,]+', data['raw_text']) if s.strip()]
            database.add_suppression_items(terms)
        return {'status': 'ok', 'count': database.get_suppression_count(), 'items': database.get_suppression_items()}


@app.get('/api/scraper/export.csv')
async def export(request: Request):
    with scope(authorized_ws(request)):
        value = service.export_leads_csv_string(dict(request.query_params))
        return Response(content=value, media_type='text/csv', headers={'Content-Disposition':'attachment; filename="matrix360_verified_leads.csv"'})
