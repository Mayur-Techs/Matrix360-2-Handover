import sys
import os
import asyncio
import io
import csv
import logging
from typing import Any, List, Optional
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks, Query
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, FileResponse
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import httpx
import uvicorn

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import (
    init_db, upsert_lead, get_leads, clear_leads,
    add_suppression_items, get_suppression_set,
    get_suppression_count, clear_suppression_list,
    is_lead_suppressed
)
from scraper.maps_agent import stream_maps_candidates
from scraper.enrichment_agent import enrich_and_verify_lead
from scraper.exporter import save_csv, build_report
from v5_contract import (
    build_dual_drive_manifest,
    engine_info as v5_engine_info,
    generate_company_filters,
    qualify_strict,
    resolve_schema,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Matrix360 & Lakhotia B2B Industrial Lead Engine", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

templates = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))
init_db()


class ScrapeJobRequest(BaseModel):
    keyword: str = Field(
        default="Manufacturing, industrial, plant, factory, warehouse, logistics, distribution, 3PL"
    )
    location: str = Field(
        default="West Bengal, Kolkata, Howrah, Hooghly, Dankuni, Durgapur, Asansol"
    )
    max_leads: int = Field(default=500, ge=1, le=5000)
    target_titles: str = Field(
        default="Founder, Owner, MD, CEO, Director, Partner, COO, Plant Head, Expansion Head, Logistics Head"
    )
    exclusions: str = Field(
        default="IT, consulting, marketing, recruitment, BFSI, education, junior roles, retail, hotel, restaurant, residential"
    )
    company_size: str = Field(default="11–50 to 1,001–5,000")
    require_mode: str = Field(default="both")  # "both", "email", "phone", "either"
    headless: bool = Field(default=True)


class SuppressionRequest(BaseModel):
    raw_text: str
    reason: str = "campaign_exclusion"


class CrmPushRequest(BaseModel):
    workspace_id: str
    auth_token: str
    crm_api_base: str = "http://localhost:8000"
    stage: str = "qualified"
    limit: Optional[int] = 100


class V5SchemaResolveRequest(BaseModel):
    headers: List[str] = Field(min_length=1, max_length=250)
    sample_rows: List[List[Any]] = Field(default_factory=list, max_length=50)


class V5CompanyFiltersRequest(BaseModel):
    headers: List[str] = Field(min_length=1, max_length=250)
    client_profile: str = Field(default="lakhotia", max_length=80)


class V5QualifyLeadRequest(BaseModel):
    record: dict[str, Any]
    client_profile: str = Field(default="lakhotia", max_length=80)


class V5DualDriveManifestRequest(BaseModel):
    input_folder_id: str = Field(min_length=10, max_length=200)
    output_folder_id: str = Field(min_length=10, max_length=200)
    dataset_name: str = Field(min_length=1, max_length=160)


class JobManager:
    def __init__(self):
        self.is_running = False
        self.stop_requested = False
        self.qualified_saved = 0
        self.scanned_candidates = 0
        self.skipped_incomplete = 0
        self.target_quota = 500
        self.last_csv_path: Optional[str] = None
        self.last_report: Optional[dict] = None
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
    """
    Guarantees that ONLY leads with verified emails (DNS MX) and/or valid phones
    count toward the requested quota.
    """
    has_verified_email = lead.get("email_status") == "Verified (MX)" and bool(lead.get("email"))
    has_valid_phone = lead.get("phone_status") == "Valid" and bool(lead.get("phone"))

    if require_mode == "email":
        return has_verified_email
    elif require_mode == "phone":
        return has_valid_phone
    elif require_mode == "both":
        return has_verified_email and has_valid_phone
    else:  # "either"
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
        logger.info(text)
        await manager.broadcast({
            "type": "log",
            "message": text,
            "processed": manager.qualified_saved,
            "scanned": manager.scanned_candidates,
            "skipped": manager.skipped_incomplete,
            "total": manager.target_quota,
            "is_running": True
        })

    semaphore = asyncio.Semaphore(6)
    active_tasks = set()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8"
    }

    try:
        await log_msg(
            f"🚀 [Orchestrator] Starting Autonomous Verified Lead Engine: Target = {req.max_leads} Leads "
            f"(Requirement: {req.require_mode.upper()} | Headless: {req.headless})"
        )

        async with httpx.AsyncClient(headers=headers, timeout=12.0) as http_client:

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
                        target_company_size=req.company_size
                    )

                    if is_excluded or is_lead_suppressed(enriched, suppressed_set):
                        manager.skipped_incomplete += 1
                        await log_msg(
                            f"⏭ Skipped (Excluded/Suppressed): {enriched.get('business_name')} "
                            f"| Qualified: {manager.qualified_saved}/{manager.target_quota}"
                        )
                        return

                    if not meets_quota_requirement(enriched, req.require_mode):
                        manager.skipped_incomplete += 1
                        await log_msg(
                            f"⏭ Skipped (Missing verified {req.require_mode}): {enriched.get('business_name')} "
                            f"| Qualified: {manager.qualified_saved}/{manager.target_quota}"
                        )
                        return

                    if manager.qualified_saved >= manager.target_quota:
                        return

                    # Lead passed all verifications! Upsert to DB & count toward quota
                    upsert_lead(enriched)
                    suppressed_set.add(enriched["business_name"].lower())
                    manager.qualified_saved += 1

                    dm_badge = f" | 👤 {enriched['dm_name']} ({enriched['dm_role']})" if enriched.get("dm_name") else ""
                    await manager.broadcast({
                        "type": "lead",
                        "message": (
                            f"✅ [{manager.qualified_saved}/{manager.target_quota}] Verified & Saved: "
                            f"{enriched['business_name']}{dm_badge}"
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
                # Bounded queue to keep memory predictable
                if len(active_tasks) >= 20:
                    await asyncio.sleep(0.5)

            await stream_maps_candidates(
                keywords_str=req.keyword,
                locations_str=req.location,
                exclusions=exclusions_list,
                suppressed_set=suppressed_set,
                on_candidate_found=on_candidate,
                log_callback=log_msg,
                should_stop=lambda: manager.stop_requested or manager.qualified_saved >= manager.target_quota,
                headless=req.headless
            )

            if active_tasks:
                await asyncio.gather(*active_tasks, return_exceptions=True)

        # Build CSV and report automatically
        saved_leads = get_leads()
        csv_path = save_csv(saved_leads)
        manager.last_csv_path = csv_path
        report = build_report(
            saved_leads,
            manager.scanned_candidates,
            manager.skipped_incomplete,
            csv_path
        )
        manager.last_report = report

        await manager.broadcast({
            "type": "done",
            "message": (
                f"🎉 Target Quota Reached! Saved {manager.qualified_saved} Verified Leads "
                f"(Scanned: {manager.scanned_candidates}, Skipped: {manager.skipped_incomplete})."
            ),
            "processed": manager.qualified_saved,
            "scanned": manager.scanned_candidates,
            "skipped": manager.skipped_incomplete,
            "total": manager.target_quota,
            "is_running": False,
            "csv_path": csv_path
        })
    except Exception as e:
        logger.error(f"Pipeline error: {e}", exc_info=True)
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
    return templates.TemplateResponse("dashboard.html", {"request": request})


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


@app.get("/api/status")
async def api_status():
    leads = get_leads()
    return {
        "is_running": manager.is_running,
        "processed": manager.qualified_saved,
        "scanned": manager.scanned_candidates,
        "skipped": manager.skipped_incomplete,
        "total": manager.target_quota,
        "leads_in_db": len(leads),
        "suppression_count": get_suppression_count(),
        "csv_available": manager.last_csv_path is not None and os.path.exists(manager.last_csv_path or "")
    }


@app.get("/api/leads")
async def api_get_leads(
    has_email: bool = Query(False),
    has_phone: bool = Query(False),
    has_socials: bool = Query(False),
    has_dm: bool = Query(False),
    verdict: str = Query("")
):
    return get_leads(
        has_email=has_email,
        has_phone=has_phone,
        has_socials=has_socials,
        has_dm=has_dm,
        verdict=verdict
    )


@app.get("/api/leads/csv")
@app.get("/api/download/csv")
async def api_export_csv():
    leads = get_leads()
    output = io.StringIO()
    fieldnames = [
        "id", "business_name", "niche", "location", "company_size",
        "phone", "phone_status", "email", "email_status", "website",
        "dm_name", "dm_role", "dm_linkedin", "dm_email",
        "verdict", "confidence", "facility_evidence",
        "instagram", "linkedin", "facebook", "twitter",
        "rating", "reviews", "address", "maps_url", "created_at"
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(leads)
    output.seek(0)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=matrix360_verified_leads_{ts}.csv"}
    )


@app.get("/api/report")
async def api_get_report():
    if manager.last_report:
        return manager.last_report
    leads = get_leads()
    return build_report(leads, manager.scanned_candidates, manager.skipped_incomplete, manager.last_csv_path or "")


@app.delete("/api/leads")
async def api_clear_leads():
    clear_leads()
    manager.qualified_saved = 0
    manager.scanned_candidates = 0
    manager.skipped_incomplete = 0
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
@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        # Send initial status
        leads = get_leads()
        await websocket.send_json({
            "type": "init",
            "is_running": manager.is_running,
            "processed": len(leads),
            "scanned": manager.scanned_candidates,
            "skipped": manager.skipped_incomplete,
            "total": manager.target_quota,
            "message": "Connected. Ready to generate verified industrial leads."
        })
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


@app.get("/api/v5/engine/info")
async def api_v5_engine_info():
    """Describe the locally available V5 bridge capabilities and safety limits."""
    return v5_engine_info()


@app.post("/api/v5/schema/resolve")
async def api_v5_schema_resolve(req: V5SchemaResolveRequest):
    """Map uploaded headers without mutating or transmitting source values."""
    return resolve_schema(req.headers, req.sample_rows)


@app.post("/api/v5/filters/company")
async def api_v5_company_filters(req: V5CompanyFiltersRequest):
    """Return user-reviewable filters inferred from a dataset schema."""
    return generate_company_filters(req.headers, req.client_profile)


@app.post("/api/v5/qualify/lead")
async def api_v5_qualify_lead(req: V5QualifyLeadRequest):
    """Return an evidence-only campaign-priority signal; never infer interest."""
    return qualify_strict(req.record, req.client_profile)


@app.post("/api/v5/dual-drive/manifest")
async def api_v5_dual_drive_manifest(req: V5DualDriveManifestRequest):
    """Create a Drive transfer plan only; actual OAuth transfer remains opt-in elsewhere."""
    try:
        return build_dual_drive_manifest(req.input_folder_id, req.output_folder_id, req.dataset_name)
    except ValueError as error:
        return JSONResponse({"detail": str(error)}, status_code=422)


@app.get("/api/health")
async def api_health():
    return {
        "status": "healthy",
        "service": "Matrix360 Audience & Lakhotia Lead Engine",
        "version": "2.0.0",
        "timestamp": datetime.now().isoformat()
    }


@app.post("/api/leads/push-to-crm")
async def api_push_to_crm(req: CrmPushRequest):
    leads = get_leads()
    if not leads:
        return JSONResponse({"status": "error", "message": "No leads in database to push"}, status_code=400)

    target_leads = leads[:req.limit] if req.limit else leads
    pushed = 0
    failed = 0
    errors = []

    crm_url = req.crm_api_base.rstrip("/") + f"/workspaces/{req.workspace_id}/leads"
    headers = {
        "Authorization": f"Bearer {req.auth_token.strip()}",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        for lead in target_leads:
            name_parts = [lead.get("business_name", "").strip()]
            if lead.get("dm_name"):
                name_parts.append(f"({lead['dm_name']})")
            lead_name = " ".join(name_parts)[:200]

            source_desc = f"Audience Engine: {lead.get('niche', '')} | {lead.get('location', '')} | Tel: {lead.get('phone', '')} | Email: {lead.get('email', '')}"[:150]

            payload = {
                "name": lead_name,
                "source": source_desc,
                "stage": req.stage
            }
            try:
                resp = await client.post(crm_url, json=payload, headers=headers)
                if resp.status_code in (200, 201):
                    pushed += 1
                else:
                    failed += 1
                    if len(errors) < 5:
                        errors.append(f"HTTP {resp.status_code}: {resp.text[:100]}")
            except Exception as e:
                failed += 1
                if len(errors) < 5:
                    errors.append(str(e)[:100])

    return {
        "status": "completed",
        "pushed": pushed,
        "failed": failed,
        "total_attempted": len(target_leads),
        "workspace_id": req.workspace_id,
        "errors": errors
    }


if __name__ == "__main__":
    uvicorn.run("scraper.main:app", host="0.0.0.0", port=8765, reload=False)
