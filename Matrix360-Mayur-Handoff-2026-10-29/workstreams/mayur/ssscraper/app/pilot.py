from __future__ import annotations

import argparse
import asyncio
import json
import time
import uuid
from pathlib import Path

from .crawler import PublicWebsiteCrawler, write_artifacts
from .seed import read_seeds, write_seeds


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the public 50-domain pilot")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--show-browser", action="store_true")
    parser.add_argument("--max-pages", type=int, default=4)
    parser.add_argument("--delay", type=float, default=1.0)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    job_id = f"cli-{uuid.uuid4().hex[:12]}"
    output = root / "output" / "jobs" / job_id
    seeds = read_seeds(root / "data" / "west_bengal_industrial_candidates.csv", args.limit)
    write_seeds(output / "source_rows.csv", seeds)
    started = time.time()
    with (output / "events.jsonl").open("a", encoding="utf-8") as event_file:
        def event(name: str, data: dict) -> None:
            line = json.dumps({"at_epoch": time.time(), "name": name, "data": data})
            print(line, flush=True)
            event_file.write(line + "\n")
            event_file.flush()
        results = asyncio.run(PublicWebsiteCrawler(output, args.max_pages, args.delay, args.show_browser, event).run(seeds))
    report = write_artifacts(output, results, started, time.time())
    print(json.dumps({"job_id": job_id, **{key: report[key] for key in ("source_rows", "pages_fetched", "contacts_extracted", "prepass", "review", "exclude", "blocked_or_failed")}}, indent=2))


if __name__ == "__main__":
    main()
