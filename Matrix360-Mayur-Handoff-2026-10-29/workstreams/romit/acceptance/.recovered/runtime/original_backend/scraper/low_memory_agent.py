"""Single-tab, bounded-memory Google Maps discovery for Matrix360 V4.

This module reuses the original place extraction and search queue. It does not
change verification policy, suppression, output schemas or CRM routing.
Google Maps can block automated browsing; such cases are reported, not bypassed.
"""
import asyncio
import os
from pathlib import Path
from typing import Any, Callable, Dict, List, Set

from playwright.async_api import async_playwright

from scraper.maps_agent import (
    block_heavy_assets,
    build_search_queue,
    extract_single_place,
)

# No application-level RAM ceiling; retain container memory telemetry.
DEFAULT_LINKS_PER_QUERY = 40
BROWSER_FLAGS = [
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-component-update',
    '--disable-sync',
    '--no-first-run',
    '--renderer-process-limit=1',
]


def _limit(name: str, default: int, floor: int, ceiling: int) -> int:
    try:
        return min(ceiling, max(floor, int(os.getenv(name, str(default)))))
    except (TypeError, ValueError):
        return default


def container_memory_bytes() -> int | None:
    """Return memory used by this cgroup, including Chromium child processes.

    Do not fall back to Python-only RSS: it omits browser subprocesses and
    would be a misleading assertion of compliance with the total RAM budget.
    """
    for path in ('/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes'):
        try:
            raw = Path(path).read_text().strip()
            value = int(raw)
            if value >= 0:
                return value
        except (OSError, ValueError):
            pass
    return None


class BudgetMonitor:
    # Telemetry only: do not stop solely because sampled cgroup usage is high.
    def __init__(self, budget_mb: int | None = None):
        self.budget_mb = None
        self.peak_bytes = 0

    def sample(self, phase: str) -> int | None:
        current = container_memory_bytes()
        if current is not None:
            self.peak_bytes = max(self.peak_bytes, current)
        return current


async def stream_maps_candidates_low_memory(
    keywords_str: str,
    locations_str: str,
    exclusions: List[str],
    suppressed_set: Set[str],
    on_candidate_found: Callable[[Dict], Any],
    log_callback: Callable[[str], Any],
    should_stop: Callable[[], bool],
    monitor: BudgetMonitor | None = None,
) -> None:
    """Separate Chromium discovery/extraction from network-based enrichment.

    The original code kept Chromium alive while on_candidate_found() performed
    DNS, off-site HTML parsing, and LinkedIn/registry verification. This
    version closes Chromium *before* calling the same enrichment callback.

    A single browser page is used per phase. URLs are bounded per query, and
    extraction groups are limited to three lightweight candidate dictionaries.
    No change is made to saved-lead qualification, suppression, or CRM auth.
    """
    import gc
    monitor = monitor or BudgetMonitor()
    candidates_per_query = _limit('M360_MAPS_LINKS_PER_QUERY', DEFAULT_LINKS_PER_QUERY, 5, 100)
    extraction_group_size = 3
    seen_urls: Set[str] = set()
    seen_names: Set[str] = set()
    queue = build_search_queue(keywords_str, locations_str)
    feed_failures = 0

    async def _open_tab(playwright):
        browser = await playwright.chromium.launch(headless=True, args=BROWSER_FLAGS)
        try:
            context = await browser.new_context(
                viewport={'width': 1024, 'height': 720},
                locale='en-US', service_workers='block', device_scale_factor=1,
                user_agent=(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) '
                    'Chrome/130.0.0.0 Safari/537.36'
                ),
            )
            await context.route('**/*', block_heavy_assets)
            page = await context.new_page()
            return browser, context, page
        except BaseException:
            await browser.close()
            raise

    # Reusing the Playwright driver avoids expensive driver reinitialization;
    # the Chromium browser itself is always closed before enrichment starts.
    async with async_playwright() as playwright:
        await log_callback('Low-RAM mode: close Chromium between discovery and enrichment batches.')
        for query_index, item in enumerate(queue, 1):
            if should_stop():
                break
            monitor.sample('before Maps search browser startup')
            query = item['query']
            await log_callback(f'Low-RAM Maps query {query_index}/{len(queue)}: {query}')
            links = []
            browser, context, page = await _open_tab(playwright)
            try:
                search_url = 'https://www.google.com/maps/search/' + query.replace(' ', '+') + '?hl=en'
                try:
                    await page.goto(search_url, timeout=20000, wait_until='domcontentloaded')
                    await page.wait_for_selector('div[role="feed"]', timeout=6000)
                except Exception as error:
                    feed_failures += 1
                    await log_callback(
                        f'Maps result feed unavailable ({feed_failures}/3) for {query}: '
                        f'{type(error).__name__}. Check Google Maps access or layout.'
                    )
                    if feed_failures >= 3:
                        raise RuntimeError(
                            'Google Maps result feed failed three consecutive searches. '
                            'Check provider availability, consent restrictions or page layout.'
                        ) from error
                    continue

                feed_failures = 0
                stagnant = 0
                for _ in range(15):
                    if should_stop() or len(links) >= candidates_per_query:
                        break
                    monitor.sample('reading Maps results')
                    hrefs = await page.locator('div[role="feed"] a[href*="/maps/place/"]').evaluate_all(
                        '(elements) => elements.map(a => a.href).filter(Boolean)'
                    )
                    new_count = 0
                    for href in hrefs:
                        if not isinstance(href, str):
                            continue
                        canonical = href.split('?', 1)[0]
                        if canonical in seen_urls or canonical.lower() in suppressed_set:
                            continue
                        seen_urls.add(canonical)
                        links.append(href)
                        new_count += 1
                        if len(links) >= candidates_per_query:
                            break
                    stagnant = stagnant + 1 if new_count == 0 else 0
                    if stagnant >= 3:
                        break
                    if len(links) < candidates_per_query:
                        await page.locator('div[role="feed"]').evaluate('(feed) => feed.scrollBy(0, 2300)')
                        await asyncio.sleep(0.40)
            finally:
                await context.close()
                await browser.close()
                gc.collect()
                monitor.sample('after Maps results browser closed')

            await log_callback(
                f'Maps query {query_index}/{len(queue)}: {len(links)} unique URLs found; '
                f'extracting in groups of {extraction_group_size}, then closing Chromium before enrichment.'
            )
            for offset in range(0, len(links), extraction_group_size):
                if should_stop():
                    break
                candidates = []
                browser, context, page = await _open_tab(playwright)
                try:
                    for href in links[offset:offset + extraction_group_size]:
                        if should_stop():
                            break
                        monitor.sample('extracting Maps business')
                        candidate = await extract_single_place(
                            worker_page=page, place_url=href, item=item,
                            exclusions=exclusions, seen_names=seen_names,
                            suppressed_set=suppressed_set,
                        )
                        if candidate:
                            candidates.append(candidate)
                finally:
                    await context.close()
                    await browser.close()
                    gc.collect()
                    monitor.sample('after extraction browser closed')

                # At this point there are ZERO open Chromium browsers/pages.
                # The unchanged callback verifies and persists leads individually.
                for candidate in candidates:
                    if should_stop():
                        break
                    await on_candidate_found(candidate)
                    monitor.sample('after website/contact enrichment, Chromium closed')
                candidates.clear()
            links.clear()

    await log_callback('Low-RAM Maps discovery completed; Chromium closed during enrichment.')
