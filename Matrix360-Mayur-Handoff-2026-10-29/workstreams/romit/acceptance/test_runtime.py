"""Offline regression and gap characterization of checksum-recovered runtime.

No browser is launched. External socket connections are prohibited. All data
and gateway keys below are synthetic fixtures in temporary directories.
Set M360_TEST_PATCHED=1 to apply the reviewed Romit cleanup patch in memory.
"""
import asyncio
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx

if sys.platform == 'win32':
    # ProactorEventLoop's socketpair setup can block in restricted Windows
    # sandboxes; these tests need no proactor-only subprocess or pipe support.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

try:
    from .recover_candidate import apply_diff
except ImportError:  # Direct execution from this directory.
    from recover_candidate import apply_diff

HERE = Path(__file__).resolve().parent
RUNTIME = HERE / '.recovered/runtime'
TEMP = tempfile.TemporaryDirectory()
os.environ['M360_TENANT_DATA_ROOT'] = str(Path(TEMP.name) / 'tenants')
os.environ['M360_ORIGINAL_BACKEND_DIR'] = str(RUNTIME / 'original_backend')
os.environ['M360_ROMIT_ORIGINAL_SCRAPER_PREVIEW_KEY'] = 'offline-fixture-key-' * 3
sys.path.insert(0, str(RUNTIME / 'original_backend'))
sys.path.insert(0, str(RUNTIME))
import scraper_database as db
db.DB_PATH = str(Path(TEMP.name) / 'bootstrap.db')
import preview_app as adapter
import scraper_service as service
import scraper.low_memory_agent as low

if os.environ.get('M360_TEST_PATCHED') == '1':
    patched = Path(TEMP.name) / 'patched'
    target = patched / 'scraper/low_memory_agent.py'
    target.parent.mkdir(parents=True)
    target.write_bytes((RUNTIME / 'original_backend/scraper/low_memory_agent.py').read_bytes())
    apply_diff(patched, (HERE / 'browser_cleanup.patch').read_text())
    spec = importlib.util.spec_from_file_location('patched_low_memory', target)
    low = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(low)


def lead(n):
    return {'business_name': f'Fixture Business {n}', 'maps_url': f'custom://fixture/{n}',
            'email': f'fixture{n}@example.invalid', 'email_status': 'Verified (MX)',
            'phone': '0000000000', 'phone_status': 'Valid', 'entity_type': 'Other',
            'turnover': 'Not Disclosed', 'dm_name': ''}


class OfflineCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Blocking socket.socket.connect also blocks asyncio's internal wakeup
        # socket on Windows. This blocks normal outbound sync clients while the
        # test doubles below replace every async network-producing dependency.
        self.connections = patch('socket.create_connection', side_effect=AssertionError('External network forbidden'))
        self.connections.start()
        self.addCleanup(self.connections.stop)


class RuntimeTests(OfflineCase):
    async def test_guard_disabled_even_with_explicit_budget(self):
        with patch.object(low, 'container_memory_bytes', return_value=600_000_000):
            monitor = low.BudgetMonitor(budget_mb=380)
            self.assertEqual(monitor.sample('fixture'), 600_000_000)
            self.assertEqual(monitor.peak_bytes, 600_000_000)
            self.assertIsNone(monitor.budget_mb)

    async def test_mocked_five_twenty_and_replay_preserve_lead_contract(self):
        for count in (5, 20):
            workspace = f'fixture-milestone-{count}'
            manager = adapter.manager(workspace)
            async def stream(**kwargs):
                for n in range(count):
                    if kwargs['should_stop']():
                        break
                    await kwargs['on_candidate_found'](lead(n))
            async def enrich(**kwargs):
                return kwargs['lead'], False
            with adapter.scope(workspace), patch.object(service, 'stream_maps_candidates_low_memory', stream), patch.object(service, 'enrich_and_verify_lead', enrich):
                await manager._execute_async_pipeline({'keyword': 'fixture', 'location': 'fixture', 'max_leads': count})
                rows = db.get_leads()
                self.assertEqual(manager.qualified_saved, count, manager.last_message)
                self.assertEqual(len(rows), count)
                ui = service.normalize_lead_for_ui(rows[0])
                self.assertEqual(ui['stage'], 'enquiry')
                self.assertEqual(ui['name'], ui['business_name'])
                ids = {r['id'] for r in rows}
                await manager._execute_async_pipeline({'keyword': 'fixture', 'location': 'fixture', 'max_leads': count})
                self.assertEqual({r['id'] for r in db.get_leads()}, ids)

    async def test_database_survives_new_manager_same_disk_but_job_state_does_not(self):
        with adapter.scope('fixture-restart'):
            db.upsert_lead(lead(31))
            old = adapter.manager('fixture-restart')
            old.qualified_saved = 1
            adapter._managers.pop('fixture-restart')
            fresh = adapter.manager('fixture-restart')
            self.assertEqual(len(db.get_leads()), 1)
            self.assertEqual(fresh.qualified_saved, 0)
            self.assertEqual(fresh.phase, 'Idle')
            self.assertNotIn('job_id', fresh.get_status())

    async def test_replacement_ephemeral_data_root_has_no_completed_rows(self):
        with adapter.scope('fixture-replacement'):
            db.upsert_lead(lead(32))
        with tempfile.TemporaryDirectory() as empty, patch.object(adapter, 'DATA_ROOT', Path(empty)):
            adapter._initialized.discard('fixture-replacement')
            with adapter.scope('fixture-replacement'):
                self.assertEqual(db.get_leads(), [])
        adapter._initialized.discard('fixture-replacement')

    async def test_stop_during_enrichment_still_commits_active_candidate(self):
        manager = adapter.manager('fixture-stop')
        async def stream(**kwargs):
            await kwargs['on_candidate_found'](lead(33))
        async def enrich(**kwargs):
            manager.request_stop()
            return kwargs['lead'], False
        with adapter.scope('fixture-stop'), patch.object(service, 'stream_maps_candidates_low_memory', stream), patch.object(service, 'enrich_and_verify_lead', enrich):
            await manager._execute_async_pipeline({'keyword': 'fixture', 'location': 'fixture', 'max_leads': 5})
            self.assertEqual(len(db.get_leads()), 1)
            self.assertEqual(manager.phase, 'Complete', manager.last_message)

    async def test_stop_before_worker_entry_is_reset(self):
        manager = adapter.manager('fixture-early-stop')
        manager.request_stop()
        observed = []
        async def stream(**kwargs):
            observed.append(kwargs['should_stop']())
        with adapter.scope('fixture-early-stop'), patch.object(service, 'stream_maps_candidates_low_memory', stream):
            await manager._execute_async_pipeline({'keyword': 'fixture', 'location': 'fixture', 'max_leads': 5})
        self.assertEqual(observed, [False])

    async def test_exact_upsert_idempotent_but_url_variants_without_phone_duplicate(self):
        with adapter.scope('fixture-idempotency'):
            fixture = lead(34)
            fixture['phone'] = ''
            first = db.upsert_lead(dict(fixture))
            self.assertEqual(db.upsert_lead(dict(fixture)), first)
            fixture['maps_url'] += '?hl=en'
            self.assertNotEqual(db.upsert_lead(dict(fixture)), first)
            self.assertEqual(len(db.get_leads()), 2)

    async def test_tenant_rows_suppression_status_and_stop_are_isolated(self):
        with adapter.scope('fixture-tenant-a'):
            db.upsert_lead(lead(35))
            db.add_suppression_items(['fixture-only-a'])
            adapter.manager('fixture-tenant-a').request_stop()
        with adapter.scope('fixture-tenant-b'):
            self.assertEqual(db.get_leads(), [])
            self.assertEqual(db.get_suppression_count(), 0)
            self.assertFalse(adapter.manager('fixture-tenant-b').stop_requested)
        with adapter.scope('fixture-tenant-a'):
            self.assertEqual(len(db.get_leads()), 1)
        with self.assertRaises(RuntimeError):
            db.get_leads()

    async def test_gateway_fails_closed_and_routes_use_verified_scope(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=adapter.app), base_url='http://fixture.invalid') as client:
            self.assertEqual((await client.get('/api/scraper/leads')).status_code, 403)
            headers = {'x-m360-preview-proxy-key': os.environ['M360_ROMIT_ORIGINAL_SCRAPER_PREVIEW_KEY'], 'x-m360-workspace-id': '../escape'}
            self.assertEqual((await client.get('/api/scraper/leads', headers=headers)).status_code, 403)
            headers['x-m360-workspace-id'] = 'fixture-tenant-b'
            response = await client.get('/api/scraper/leads', headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['leads'], [])


class BrowserTests(OfflineCase):
    async def exercise(self, failing_close=0, stop_after_one=False, extraction_error=False):
        browsers, saved = [], []
        stop = False
        class Page:
            async def goto(self, *args, **kwargs): pass
            async def wait_for_selector(self, *args, **kwargs): pass
            def locator(self, *args): return self
            async def evaluate_all(self, *args): return [f'https://fixture.invalid/maps/place/{n}' for n in range(5)]
            async def evaluate(self, *args): pass
        class Context:
            def __init__(self, index): self.index = index
            async def route(self, *args): pass
            async def new_page(self): return Page()
            async def close(self):
                if self.index == failing_close: raise RuntimeError('Fixture context close failed')
        class Browser:
            def __init__(self, index): self.index, self.closed = index, False
            async def new_context(self, **kwargs): return Context(self.index)
            async def close(self): self.closed = True
        class Playwright:
            chromium = None
            async def __aenter__(self): self.chromium = self; return self
            async def __aexit__(self, *args): pass
            async def launch(self, **kwargs):
                browser = Browser(len(browsers)+1)
                browsers.append(browser)
                return browser
        async def extract(**kwargs):
            if extraction_error: raise asyncio.CancelledError()
            return {'maps_url': kwargs['place_url']}
        async def save(candidate):
            nonlocal stop
            self.assertTrue(all(browser.closed for browser in browsers))
            saved.append(candidate)
            if stop_after_one: stop = True
        with patch.object(low, 'async_playwright', Playwright), patch.object(low, 'build_search_queue', return_value=[{'query': 'fixture'}]), patch.object(low, 'extract_single_place', extract), patch.object(low, 'container_memory_bytes', return_value=90_000_000), patch.dict(os.environ, {'M360_MAPS_LINKS_PER_QUERY': '5'}):
            try:
                await low.stream_maps_candidates_low_memory('fixture', 'fixture', [], set(), save, AsyncMock(), lambda: stop)
            finally:
                self.assertTrue(all(browser.closed for browser in browsers), 'Browser leaked when cleanup raised')
        return saved

    async def test_browser_closed_before_each_callback(self):
        self.assertEqual(len(await self.exercise()), 5)

    async def test_cooperative_stop_prevents_remaining_callbacks(self):
        self.assertEqual(len(await self.exercise(stop_after_one=True)), 1)

    async def test_discovery_context_close_failure_still_closes_browser(self):
        with self.assertRaisesRegex(RuntimeError, 'Fixture context close failed'):
            await self.exercise(failing_close=1)

    async def test_extraction_context_close_failure_still_closes_browser(self):
        with self.assertRaisesRegex(RuntimeError, 'Fixture context close failed'):
            await self.exercise(failing_close=2)

    async def test_task_cancellation_closes_browser(self):
        with self.assertRaises(asyncio.CancelledError):
            await self.exercise(extraction_error=True)


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        TEMP.cleanup()
