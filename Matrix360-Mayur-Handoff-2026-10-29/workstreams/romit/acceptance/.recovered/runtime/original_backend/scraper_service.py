import asyncio
import os
import csv
import io
import sys
import threading
import time
from typing import Dict, Any, List
import httpx

from scraper_database import (
    init_db,
    upsert_lead,
    get_leads,
    clear_leads,
    add_suppression_items,
    get_suppression_items,
    remove_suppression_item,
    get_suppression_set,
    get_suppression_count,
    clear_suppression_list,
    is_lead_suppressed,
    flush_wal_checkpoint,
)
from scraper.maps_agent import stream_maps_candidates
from scraper.low_memory_agent import (
    BudgetMonitor, container_memory_bytes, stream_maps_candidates_low_memory,
)
from scraper.enrichment_agent import enrich_and_verify_lead

init_db()

CSV_FIELDNAMES = [
    "id", "business_name", "entity_type", "turnover", "cin_or_gst",
    "niche", "location", "company_size",
    "phone", "phone_status", "email", "email_status", "website",
    "dm_name", "dm_role", "dm_linkedin", "dm_email",
    "instagram", "linkedin", "facebook", "twitter",
    "rating", "reviews", "address", "maps_url", "created_at"
]


def normalize_lead_for_ui(row: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(row)
    out["name"] = out.get("business_name") or out.get("name") or ""
    out["business_name"] = out["name"]
    out["category"] = out.get("niche") or out.get("category") or ""
    out["niche"] = out["category"]
    out["source"] = f"Google Maps ({out['niche']})" if out.get("niche") else "Google Maps Scraper"
    out["stage"] = out.get("stage") or "enquiry"
    return out


def meets_quota_requirement(lead: dict, require_mode: str) -> bool:
    has_verified_email = lead.get("email_status") == "Verified (MX)" and bool(lead.get("email"))
    has_valid_phone = lead.get("phone_status") == "Valid" and bool(lead.get("phone"))

    mode = (require_mode or "both").lower()
    if mode in ("email", "email_only"):
        return has_verified_email
    elif mode in ("phone", "phone_only"):
        return has_valid_phone
    elif mode == "both":
        return has_verified_email and has_valid_phone
    else:
        return has_verified_email or has_valid_phone


class ScraperPipelineManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.is_running = False
        self.stop_requested = False
        self.qualified_saved = 0
        self.scanned_candidates = 0
        self.skipped_incomplete = 0
        self.target_quota = 0
        self.start_time = 0.0
        self.last_message = "Ready. 3-Tab Live Streaming + Factual Turnover & Entity Engine active."
        self.phase = "Idle"
        self.recent_leads: List[Dict[str, Any]] = []
        self.memory_peak_mb = 0.0
        self.low_memory_mode = False

    def compute_timing(self) -> tuple[int, int]:
        if not self.start_time:
            return 0, -1
        elapsed = max(1.0, time.time() - self.start_time)
        remaining_quota = max(0, self.target_quota - self.qualified_saved)
        if remaining_quota == 0:
            return int(elapsed), 0
        if self.qualified_saved >= 1:
            rate_per_sec = self.qualified_saved / elapsed
            eta_sec = int(remaining_quota / max(rate_per_sec, 0.001))
            return int(elapsed), eta_sec
        if self.scanned_candidates >= 2:
            est_qualified_rate = (self.scanned_candidates * 0.25) / elapsed
            eta_sec = int(remaining_quota / max(est_qualified_rate, 0.005))
            return int(elapsed), eta_sec
        return int(elapsed), -1

    def get_status(self) -> Dict[str, Any]:
        elapsed_sec, eta_sec = self.compute_timing()
        pct = 0.0
        if self.target_quota > 0:
            pct = min(100.0, round((self.qualified_saved / self.target_quota) * 100.0, 1))
        used = container_memory_bytes()
        if used is not None:
            self.memory_peak_mb = max(self.memory_peak_mb, used / 1_000_000)
        return {
            "status": "ok",
            "memory_mb": round(used / 1_000_000, 1) if used is not None else None,
            "peak_memory_mb": round(self.memory_peak_mb, 1),
            "memory_budget_mb": BudgetMonitor().budget_mb if self.low_memory_mode else None,
            "low_memory_mode": self.low_memory_mode,
            "running": self.is_running,
            "is_running": self.is_running,
            "phase": self.phase,
            "message": self.last_message,
            "processed": self.qualified_saved,
            "matched": self.qualified_saved,
            "scanned": self.scanned_candidates,
            "skipped": self.skipped_incomplete,
            "suppressed": self.skipped_incomplete,
            "total": self.target_quota,
            "percent": pct,
            "elapsed_seconds": elapsed_sec,
            "elapsed_sec": elapsed_sec,
            "eta_seconds": eta_sec,
            "eta_sec": eta_sec,
            "leads": [normalize_lead_for_ui(r) for r in self.recent_leads[:200]]
        }

    def request_stop(self):
        self.stop_requested = True
        self.last_message = "⏹ Stop requested. Finalizing active worker tasks..."

    async def _execute_async_pipeline(self, params: Dict[str, Any]):
        keyword = (params.get("keyword") or params.get("query") or "Manufacturing, industrial").strip()
        location = (params.get("location") or "West Bengal").strip()
        max_leads = max(1, min(2000, int(params.get("max_leads") or params.get("max_results") or 100)))
        target_titles = params.get(
            "target_titles",
            "Founder, Owner, MD, CEO, Director, Partner, COO, Plant Head, Expansion Head, Logistics Head"
        )
        exclusions = params.get(
            "exclusions",
            "IT, consulting, marketing, recruitment, BFSI, education, junior roles"
        )
        company_size = params.get("company_size", "11–50 to 1,001–5,000")

        require_mode = params.get("require_mode") or params.get("contact_filter") or "both"
        if require_mode == "email_only":
            require_mode = "email"
        elif require_mode == "phone_only":
            require_mode = "phone"
        elif require_mode == "all":
            require_mode = "either"

        entity_filter = params.get("entity_filter") or ("pvt_ltd" if params.get("pvt_ltd_only") else "all")

        self.is_running = True
        self.stop_requested = False
        self.qualified_saved = 0
        self.scanned_candidates = 0
        self.skipped_incomplete = 0
        self.target_quota = max_leads
        self.start_time = time.time()
        self.recent_leads = []
        self.memory_peak_mb = 0.0
        self.low_memory_mode = os.getenv("M360_MAPS_LOW_MEMORY", "1").strip().lower() not in ("0", "false", "off", "no")
        self.phase = ("Phase 1/3 • Single-Tab Low-RAM Maps Discovery" if self.low_memory_mode
                      else "Phase 1/3 • 3-Tab Maps Discovery")

        titles_list = [t.strip() for t in target_titles.split(",") if t.strip()]
        exclusions_list = [e.strip() for e in exclusions.split(",") if e.strip()]
        suppressed_set = get_suppression_set() if params.get("apply_suppression", True) else set()

        async def log_msg(text: str):
            self.last_message = text

        enrichment_slots = 1 if self.low_memory_mode else 16
        semaphore = asyncio.Semaphore(enrichment_slots)
        budget_monitor = BudgetMonitor() if self.low_memory_mode else None
        max_pending_tasks = 2 if self.low_memory_mode else 36
        active_tasks = set()
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9"
        }
        limits = (httpx.Limits(max_connections=4, max_keepalive_connections=2)
                  if self.low_memory_mode else httpx.Limits(max_connections=100, max_keepalive_connections=40))

        try:
            await log_msg(
                f"🚀 Starting {'single-tab low-RAM' if self.low_memory_mode else '3-Tab'} stream: Quota = {max_leads} Verified Leads "
                f"(Mode: {require_mode.upper()} | Entity: {entity_filter.upper()})"
            )

            async with httpx.AsyncClient(headers=headers, limits=limits) as http_client:

                async def enrich_worker(candidate: dict):
                    if self.stop_requested or self.qualified_saved >= self.target_quota:
                        return

                    async with semaphore:
                        if self.stop_requested or self.qualified_saved >= self.target_quota:
                            return

                        self.scanned_candidates += 1
                        self.phase = "Phase 2/3 • DNS MX + CIN/GST + LinkedIn X-Ray"
                        enriched, is_excluded = await enrich_and_verify_lead(
                            client=http_client,
                            lead=candidate,
                            target_titles=titles_list,
                            exclusions=exclusions_list,
                            target_company_size=company_size,
                            entity_filter=entity_filter
                        )

                        if is_excluded or is_lead_suppressed(enriched, suppressed_set):
                            self.skipped_incomplete += 1
                            self.last_message = f"⏭ Skipped (Excluded/Suppressed): {enriched.get('business_name', '')}"
                            return

                        if not meets_quota_requirement(enriched, require_mode):
                            self.skipped_incomplete += 1
                            self.last_message = f"⏭ Skipped (Missing verified {require_mode}): {enriched.get('business_name', '')}"
                            return

                        if self.qualified_saved >= self.target_quota:
                            return

                        upsert_lead(enriched)
                        suppressed_set.add(enriched["business_name"].lower())
                        self.qualified_saved += 1
                        self.recent_leads.insert(0, dict(enriched))
                        del self.recent_leads[200:]

                        dm_badge = f" | 👤 {enriched['dm_name']}" if enriched.get("dm_name") else ""
                        rev_badge = f" | 💰 {enriched['turnover']}" if enriched.get("turnover") != "Not Disclosed" else ""
                        self.last_message = (
                            f"✅ [{self.qualified_saved}/{self.target_quota}] {enriched['business_name']} "
                            f"({enriched['entity_type']}){rev_badge}{dm_badge}"
                        )

                        if self.qualified_saved >= self.target_quota:
                            self.stop_requested = True

                async def on_candidate(cand: dict):
                    if self.stop_requested or self.qualified_saved >= self.target_quota:
                        return
                    if self.low_memory_mode:
                        # Backpressure: browser and HTML parsing must never
                        # progress concurrently across multiple businesses.
                        await enrich_worker(cand)
                        budget_monitor.sample("after business enrichment")
                        return
                    task = asyncio.create_task(enrich_worker(cand))
                    active_tasks.add(task)
                    task.add_done_callback(active_tasks.discard)
                    while len(active_tasks) >= max_pending_tasks:
                        finished, _ = await asyncio.wait(active_tasks, return_when=asyncio.FIRST_COMPLETED)
                        active_tasks.difference_update(finished)

                stream_fn = (stream_maps_candidates_low_memory if self.low_memory_mode
                             else stream_maps_candidates)
                kwargs = {}
                if self.low_memory_mode:
                    kwargs["monitor"] = budget_monitor
                await stream_fn(
                    keywords_str=keyword,
                    locations_str=location,
                    exclusions=exclusions_list,
                    suppressed_set=suppressed_set,
                    on_candidate_found=on_candidate,
                    log_callback=log_msg,
                    should_stop=lambda: self.stop_requested or self.qualified_saved >= self.target_quota,
                    **kwargs
                )

                if active_tasks:
                    await asyncio.gather(*active_tasks, return_exceptions=True)

            flush_wal_checkpoint()
            self.phase = "Complete"
            self.last_message = (
                f"🎉 Job Complete! Saved {self.qualified_saved} verified leads "
                f"(Scanned: {self.scanned_candidates}, Skipped: {self.skipped_incomplete})."
            )
        except Exception as e:
            self.phase = "Error"
            self.last_message = f"❌ Pipeline error: {str(e)}"
        finally:
            self.is_running = False
            self.stop_requested = False

    def start_background_job(self, params: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            if self.is_running:
                return {"status": "busy", "message": "A scraping job is already running."}
            self.is_running = True

        def _thread_target():
            if sys.platform == "win32":
                asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(self._execute_async_pipeline(params))
            finally:
                loop.close()

        t = threading.Thread(target=_thread_target, daemon=True)
        t.start()
        return {"status": "started", "target_quota": params.get("max_leads") or params.get("max_results") or 100}


pipeline_manager = ScraperPipelineManager()


def query_saved_leads(params: Dict[str, Any]) -> Dict[str, Any]:
    contact_filter = (params.get("contact_filter") or params.get("require_mode") or "all").lower()
    has_email = str(params.get("has_email", "false")).lower() == "true" or contact_filter in ("both", "email", "email_only")
    has_phone = str(params.get("has_phone", "false")).lower() == "true" or contact_filter in ("both", "phone", "phone_only")
    has_dm = str(params.get("has_dm", "false")).lower() == "true"
    has_turnover = str(params.get("has_turnover", "false")).lower() == "true"

    entity_category = params.get("entity_category") or "all"
    if str(params.get("pvt_ltd_only", "false")).lower() == "true":
        entity_category = "pvt_ltd"

    search = params.get("search") or ""
    limit = int(params.get("limit") or 2000)

    rows = get_leads(
        has_email=has_email,
        has_phone=has_phone,
        has_dm=has_dm,
        has_turnover=has_turnover,
        entity_category=entity_category,
        search=search,
        limit=limit
    )
    normalized = [normalize_lead_for_ui(r) for r in rows]
    return {"status": "ok", "count": len(normalized), "leads": normalized}


def export_leads_csv_string(params: Dict[str, Any]) -> str:
    data = query_saved_leads(params)
    leads = data["leads"]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDNAMES, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(leads)
    return output.getvalue()


# Compatibility helpers for test harnesses & legacy signatures
def get_suppression_list() -> Dict[str, Any]:
    return {"status": "ok", "count": get_suppression_count(), "items": get_suppression_items()}


def add_suppression_terms(terms: List[str]) -> int:
    return add_suppression_items(terms)


def remove_suppression_term(val) -> int:
    return remove_suppression_item(val)


def fetch_scraped_leads(limit=2000, contact_filter="all", pvt_ltd_only=False, apply_suppression=True, search="", **kwargs):
    res = query_saved_leads({
        "limit": limit,
        "contact_filter": contact_filter,
        "pvt_ltd_only": pvt_ltd_only,
        "search": search
    })
    return res["leads"], 0, res["count"]


def get_job_status() -> Dict[str, Any]:
    return pipeline_manager.get_status()


def request_job_stop() -> Dict[str, Any]:
    pipeline_manager.request_stop()
    return {"status": "stopped", "matched": pipeline_manager.qualified_saved, "suppressed": pipeline_manager.skipped_incomplete}


def run_scraper_job(**kwargs):
    pipeline_manager.start_background_job(kwargs)
    res = query_saved_leads(kwargs)
    return res["leads"], 0


def export_leads_csv(leads: List[Dict[str, Any]]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_FIELDNAMES, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(leads)
    return output.getvalue()

