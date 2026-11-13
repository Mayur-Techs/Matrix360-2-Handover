from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .crawler import PublicWebsiteCrawler, write_artifacts
from .agents import FilterPolicy, run_agents
from .places import GooglePlacesDiscovery
from .planner import LeadPlan, PlanError, PlanRequest, create_plan
from .seed import write_seeds
from .settings import get_settings
from .store import JobStore

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUTPUT = ROOT / "output" / "jobs"
store = JobStore(DATA / "jobs.sqlite3")
app = FastAPI(title="Prompt-driven lead research")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=ROOT / "app" / "static"), name="static")
plans: dict[str, tuple[PlanRequest, LeadPlan]] = {}


class JobRequest(BaseModel):
    plan_id: str = Field(min_length=8, max_length=64)


def start_job(job_id: str, request: JobRequest) -> None:
    output_dir = OUTPUT / job_id
    try:
        store.update(job_id, "RUNNING")
        output_dir.mkdir(parents=True, exist_ok=True)
        record = plans.get(request.plan_id)
        if not record:
            raise ValueError("This research plan expired. Create a new plan before starting.")
        plan_request, plan = record
        settings = get_settings()
        candidate_budget = min(5_000, max(plan_request.lead_count * 3, 20))
        started = time.time()

        with (output_dir / "events.jsonl").open("a", encoding="utf-8") as event_file:
            def event(name: str, data: dict) -> None:
                entry = {"at_epoch": time.time(), "name": name, "data": data}
                event_file.write(json.dumps(entry) + "\n")
                event_file.flush()
                store.event(job_id, name, data)

            event("agent_started", {"agent": "AI planning agent", "goal": plan.client_goal})
            event("agent_finished", {"agent": "AI planning agent", "filters": plan.plain_filters})

            discovery = GooglePlacesDiscovery(settings.google_maps_api_key)
            seeds, discovery_summary = discovery.discover(plan.search_queries, candidate_budget, event)
            if not seeds:
                raise ValueError("No matching official business websites were found. Try adjusting your goal description.")

            write_seeds(output_dir / "source_rows.csv", seeds)
            event("agent_started", {"agent": "Candidate intake agent", "source_rows": len(seeds)})
            event("agent_finished", {"agent": "Candidate intake agent", "source_rows": len(seeds)})

            event("agent_started", {"agent": "Official website evidence agent"})
            crawler = PublicWebsiteCrawler(
                output_dir,
                max_pages_per_domain=4,
                delay_seconds=0.8,
                show_browser=False,
                event=event,
                include_terms=tuple(item.lower() for item in plan.include_terms),
                exclude_terms=tuple(item.lower() for item in plan.exclude_terms),
                geo_terms=tuple(item.lower() for item in plan.location_terms),
            )
            results = asyncio.run(crawler.run(seeds))
            event("agent_finished", {"agent": "Official website evidence agent"})

            policy = FilterPolicy(
                include_terms=tuple(item.lower() for item in plan.include_terms),
                exclude_terms=tuple(item.lower() for item in plan.exclude_terms),
                location_terms=tuple(item.lower() for item in plan.location_terms),
                allowed_statuses=("QUALIFIED", "PREPASS", "REVIEW"),
                require_mode=plan.require_mode,
                require_named_contact=plan.require_named_contact,
                target_roles=tuple(item.lower() for item in plan.target_roles),
                target_qualified_leads=plan_request.lead_count,
                validate_email_domains=True,
                client_goal=plan.client_goal,
            )
            pipeline = run_agents(
                results,
                policy,
                event,
                ai_key=settings.lead_ai_api_key,
                ai_model=settings.lead_ai_model,
            )

        report = write_artifacts(output_dir, results, started, time.time())
        report["pipeline"] = pipeline
        report["plan"] = plan.model_dump()
        report["discovery"] = discovery_summary.report()
        (output_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        store.event(job_id, "job_finished", {key: report[key] for key in ("source_rows", "pages_fetched", "contacts_extracted", "prepass", "review", "exclude", "blocked_or_failed")})
        store.update(job_id, "COMPLETE", str(output_dir / "report.json"))
    except Exception as exc:
        store.update(job_id, "FAILED", error=f"{type(exc).__name__}: {exc}")
        store.event(job_id, "job_failed", {"error": f"{type(exc).__name__}: {exc}"})


@app.get("/", response_class=HTMLResponse)
def dashboard() -> HTMLResponse:
    return HTMLResponse((ROOT / "app" / "templates" / "index.html").read_text(encoding="utf-8"))


@app.get("/api/status")
def system_status() -> dict:
    settings = get_settings()
    return {
        "has_ai_key": settings.has_ai_key,
        "has_maps_key": settings.has_maps_key,
        "ai_model": settings.lead_ai_model,
    }


@app.post("/api/plans")
def create_research_plan(request: PlanRequest) -> dict:
    settings = get_settings()
    try:
        plan = create_plan(request, settings)
    except PlanError as exc:
        raise HTTPException(502, str(exc)) from exc
    plan_id = uuid.uuid4().hex
    plans[plan_id] = (request, plan)

    setup_message = ""
    if not settings.has_ai_key:
        setup_message = "Tip: Add LEAD_AI_API_KEY in .env to unlock full AI planning and qualification."
    elif not settings.has_maps_key:
        setup_message = "Multi-engine web & LinkedIn discovery active (Google Maps key optional)."

    return {
        "id": plan_id,
        "plan": plan.model_dump(),
        "ready_to_start": True,
        "setup_message": setup_message,
    }


@app.get("/api/jobs")
def jobs() -> list[dict]:
    return store.recent()


@app.post("/api/jobs", status_code=202)
def create_job(request: JobRequest) -> dict:
    if request.plan_id not in plans:
        raise HTTPException(422, "Create a fresh research plan before starting.")
    job_id = uuid.uuid4().hex[:12]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    store.create(job_id, request.model_dump())
    threading.Thread(target=start_job, args=(job_id, request), daemon=True).start()
    return {"id": job_id, "status": "QUEUED"}


@app.get("/api/jobs/{job_id}")
def job(job_id: str) -> dict:
    item = store.get(job_id)
    if not item:
        raise HTTPException(404, "Unknown job")
    if item["report_path"] and Path(item["report_path"]).exists():
        item["report"] = json.loads(Path(item["report_path"]).read_text(encoding="utf-8"))
    return item


@app.get("/api/jobs/{job_id}/contacts.csv")
@app.get("/api/jobs/{job_id}/leads.csv")
def download_contacts(job_id: str) -> FileResponse:
    path = OUTPUT / job_id / "contacts.csv"
    if not path.exists():
        raise HTTPException(404, "Leads file is not available yet")
    return FileResponse(path, media_type="text/csv", filename=f"leads-{job_id}.csv")


@app.get("/api/jobs/{job_id}/report.json")
def download_report(job_id: str) -> FileResponse:
    path = OUTPUT / job_id / "report.json"
    if not path.exists():
        raise HTTPException(404, "Report is not available yet")
    return FileResponse(path, media_type="application/json", filename=f"lead-research-{job_id}-report.json")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "prompt-driven-lead-research"}


@app.get("/api/jobs/{job_id}/screenshots/{filename}")
def screenshot(job_id: str, filename: str) -> FileResponse:
    path = (OUTPUT / job_id / "screenshots" / filename).resolve()
    parent = (OUTPUT / job_id / "screenshots").resolve()
    if path.parent != parent or not path.is_file():
        raise HTTPException(404, "Screenshot not found")
    return FileResponse(path, media_type="image/png")


if __name__ == "__main__":
    import os
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8012"))
    uvicorn.run("app.main:app", host=host, port=port, reload=False)
