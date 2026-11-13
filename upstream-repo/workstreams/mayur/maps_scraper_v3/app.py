import os
import sys
import asyncio
import csv
import io
from typing import List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks, Header, HTTPException, Query
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from pydantic import BaseModel, Field
import httpx
import uvicorn

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from database import (
    init_db, upsert_lead, get_leads, clear_leads,
    add_suppression_items, get_suppression_set,
    get_suppression_count, clear_suppression_list,
    is_lead_suppressed
)
from scraper.authorized_places_agent import stream_authorized_places_candidates
from scraper.enrichment_agent import enrich_and_verify_lead
from integration import manifest as integration_manifest, to_matrix360_record

app = FastAPI(title="Matrix360 B2B Industrial & Decision-Maker Lead Engine")
templates = Jinja2Templates(directory="templates")
init_db()


class ScrapeJobRequest(BaseModel):
    keyword: str
    location: str
    max_leads: int = Field(default=100, ge=1, le=2000)
    target_titles: str = Field(
        default="Founder, Owner, MD, CEO, Director, Partner, COO, Plant Head, Expansion Head, Logistics Head"
    )
    exclusions: str = Field(
        default="IT, consulting, marketing, recruitment, BFSI, education, junior roles"
    )
    company_size: str = Field(default="11–50 to 1,001–5,000")
    require_mode: str = Field(default="both")  # "email", "phone", "both", "either"
    entity_filter: str = Field(default="all")  # "all", "pvt_ltd", "other"


class SuppressionRequest(BaseModel):
    raw_text: str
    reason: str = "campaign_exclusion"


class JobManager:
    def __init__(self):
        self.is_running = False
        self.stop_requested = False
        self.qualified_saved = 0
        self.scanned_candidates = 0
        self.skipped_incomplete = 0
        self.target_quota = 0
        self.clients: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.clients:
            self.clients.remove(ws)

    async def broadcast(self, message: dict):
        dead = []
        for ws in self.clients:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = JobManager()


def meets_quota_requirement(lead: dict, require_mode: str) -> bool:
    has_verified_email = lead.get("email_status") == "Verified (MX)" and bool(lead.get("email"))
    has_valid_phone = lead.get("phone_status") == "Valid" and bool(lead.get("phone"))

    if require_mode == "email":
        return has_verified_email
    elif require_mode == "phone":
        return has_valid_phone
    elif require_mode == "both":
        return has_verified_email and has_valid_phone
    else:
        return has_verified_email or has_valid_phone


async def execute_pipeline(req: ScrapeJobRequest):
    manager.is_running = True
    manager.stop_requested = False
    manager.qualified_saved = 0
    manager.scanned_candidates = 0
    manager.skipped_incomplete = 0
    manager.target_quota = req.max_leads

    titles_list = [t.strip() for t in req.target_titles.split(",") if t.strip()]
    exclusions_list = [e.strip() for e in req.exclusions.split(",") if e.strip()]
    suppressed_set = get_suppression_set()

    async def log_msg(text: str):
        await manager.broadcast({
            "type": "log",
            "message": text,
            "processed": manager.qualified_saved,
            "scanned": manager.scanned_candidates,
            "skipped": manager.skipped_incomplete,
            "total": manager.target_quota,
            "is_running": True
        })

    # High-speed 16-worker concurrent enrichment pool with connection reuse
    semaphore = asyncio.Semaphore(16)
    active_tasks = set()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
    }
    limits = httpx.Limits(max_connections=100, max_keepalive_connections=40)

    try:
        await log_msg(
            f"🚀 Starting High-Speed Stream: Quota = {req.max_leads} Verified Leads "
            f"(Mode: {req.require_mode.upper()} | Entity: {req.entity_filter.upper()})"
        )

        async with httpx.AsyncClient(headers=headers, limits=limits) as http_client:

            async def enrich_worker(candidate: dict):
                if manager.stop_requested or manager.qualified_saved >= manager.target_quota:
                    return

                async with semaphore:
                    if manager.stop_requested or manager.qualified_saved >= manager.target_quota:
                        return

                    manager.scanned_candidates += 1
                    enriched, is_excluded = await enrich_and_verify_lead(
                        client=http_client,
                        lead=candidate,
                        target_titles=titles_list,
                        exclusions=exclusions_list,
                        target_company_size=req.company_size,
                        entity_filter=req.entity_filter
                    )

                    if is_excluded or is_lead_suppressed(enriched, suppressed_set):
                        manager.skipped_incomplete += 1
                        return

                    if not meets_quota_requirement(enriched, req.require_mode):
                        manager.skipped_incomplete += 1
                        return

                    if manager.qualified_saved >= manager.target_quota:
                        return

                    upsert_lead(enriched)
                    suppressed_set.add(enriched["business_name"].lower())
                    manager.qualified_saved += 1

                    dm_badge = f" | 👤 {enriched['dm_name']}" if enriched.get("dm_name") else ""
                    rev_badge = f" | 💰 {enriched['turnover']}" if enriched.get("turnover") != "Not Disclosed" else ""
                    await manager.broadcast({
                        "type": "lead",
                        "message": (
                            f"✅ [{manager.qualified_saved}/{manager.target_quota}] {enriched['business_name']} "
                            f"({enriched['entity_type']}){rev_badge}{dm_badge}"
                        ),
                        "processed": manager.qualified_saved,
                        "scanned": manager.scanned_candidates,
                        "skipped": manager.skipped_incomplete,
                        "total": manager.target_quota,
                        "is_running": True,
                        "lead": enriched
                    })

                    if manager.qualified_saved >= manager.target_quota:
                        manager.stop_requested = True

            async def on_candidate(cand: dict):
                if manager.stop_requested or manager.qualified_saved >= manager.target_quota:
                    return
                task = asyncio.create_task(enrich_worker(cand))
                active_tasks.add(task)
                task.add_done_callback(active_tasks.discard)
                if len(active_tasks) >= 36:
                    await asyncio.sleep(0.15)

            await stream_authorized_places_candidates(
                keywords_str=req.keyword,
                locations_str=req.location,
                exclusions=exclusions_list,
                suppressed_set=suppressed_set,
                on_candidate_found=on_candidate,
                log_callback=log_msg,
                should_stop=lambda: manager.stop_requested or manager.qualified_saved >= manager.target_quota
            )

            if active_tasks:
                await asyncio.gather(*active_tasks, return_exceptions=True)

        await manager.broadcast({
            "type": "done",
            "message": (
                f"🎉 Job Complete! Saved {manager.qualified_saved} verified leads "
                f"(Scanned: {manager.scanned_candidates}, Skipped: {manager.skipped_incomplete})."
            ),
            "processed": manager.qualified_saved,
            "scanned": manager.scanned_candidates,
            "skipped": manager.skipped_incomplete,
            "total": manager.target_quota,
            "is_running": False
        })
    except Exception as e:
        await manager.broadcast({
            "type": "error",
            "message": f"❌ Pipeline error: {str(e)}",
            "processed": manager.qualified_saved,
            "scanned": manager.scanned_candidates,
            "skipped": manager.skipped_incomplete,
            "total": manager.target_quota,
            "is_running": False
        })
    finally:
        manager.is_running = False
        manager.stop_requested = False


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.post("/api/scrape")
async def start_scrape(req: ScrapeJobRequest, background_tasks: BackgroundTasks):
    if manager.is_running:
        return {"status": "busy", "message": "A scraping job is already running."}
    background_tasks.add_task(execute_pipeline, req)
    return {"status": "started", "target_quota": req.max_leads}


@app.post("/api/stop")
async def stop_scrape():
    if manager.is_running:
        manager.stop_requested = True
        return {"status": "stopping"}
    return {"status": "idle"}


@app.get("/api/leads")
async def api_get_leads(
    has_email: bool = Query(False),
    has_phone: bool = Query(False),
    has_dm: bool = Query(False),
    has_turnover: bool = Query(False),
    entity_category: str = Query("all")
):
    return get_leads(
        has_email=has_email,
        has_phone=has_phone,
        has_dm=has_dm,
        has_turnover=has_turnover,
        entity_category=entity_category
    )


def require_integration_key(value: str) -> None:
    expected = os.getenv("MATRIX360_INTEGRATION_KEY", "").strip()
    if not expected:
        raise HTTPException(503, "Matrix360 integration is not configured.")
    if value != expected:
        raise HTTPException(401, "Invalid Matrix360 integration key.")


@app.get("/api/integration/matrix360/manifest")
async def matrix360_manifest(
    x_matrix360_integration_key: str = Header(default="", alias="X-Matrix360-Integration-Key"),
):
    require_integration_key(x_matrix360_integration_key)
    return integration_manifest()


@app.get("/api/integration/matrix360/leads")
async def matrix360_leads(
    x_matrix360_integration_key: str = Header(default="", alias="X-Matrix360-Integration-Key"),
    entity_category: str = Query("all"),
):
    require_integration_key(x_matrix360_integration_key)
    return {"records": [to_matrix360_record(lead) for lead in get_leads(entity_category=entity_category)]}


@app.get("/api/leads/csv")
async def api_export_csv(entity_category: str = Query("all")):
    leads = get_leads(entity_category=entity_category)
    output = io.StringIO()
    fieldnames = [
        "id", "business_name", "entity_type", "turnover", "cin_or_gst",
        "niche", "location", "company_size",
        "phone", "phone_status", "email", "email_status", "website",
        "dm_name", "dm_role", "dm_linkedin", "dm_email",
        "instagram", "linkedin", "facebook", "twitter",
        "rating", "reviews", "address", "maps_url", "created_at"
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(leads)
    output.seek(0)
    filename = f"matrix360_{entity_category}_leads.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.delete("/api/leads")
async def api_clear_leads():
    clear_leads()
    return {"status": "cleared"}


@app.get("/api/suppression")
async def api_get_suppression():
    return {"count": get_suppression_count()}


@app.post("/api/suppression")
async def api_add_suppression(req: SuppressionRequest):
    lines = [
        item.strip()
        for line in req.raw_text.splitlines()
        for item in line.split(",")
        if item.strip()
    ]
    added = add_suppression_items(lines, req.reason)
    return {"added": added, "total": get_suppression_count()}


@app.delete("/api/suppression")
async def api_clear_suppression():
    clear_suppression_list()
    return {"status": "cleared", "total": 0}


@app.websocket("/ws/progress")
async def ws_progress(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
