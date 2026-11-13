from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .crawler import extract_contacts, write_artifacts
from .models import CompanyResult, CompanySeed, PageEvidence
from .rules import classify
from .seed import read_seeds


def main() -> None:
    parser = argparse.ArgumentParser(description="Reclassify an existing crawl from its saved raw page evidence")
    parser.add_argument("job_id")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = root / "output" / "jobs" / args.job_id
    original = json.loads((output / "report.json").read_text(encoding="utf-8"))
    seeds = {item.source_id: item for item in read_seeds(output / "source_rows.csv")}
    results: list[CompanyResult] = []
    for row in original["companies"]:
        seed = seeds[row["source_id"]]
        result = CompanyResult(seed, "REVIEW", "low", error=row.get("error"))
        result.pages = [PageEvidence(**page) for page in row["pages"]]
        text = "\n".join(page.text for page in result.pages)
        result.fit_status, result.fit_confidence, result.reasons, result.exclusion_reasons, result.geographic_evidence = classify(seed, text)
        result.contacts = extract_contacts(seed, result)
        results.append(result)
    report = write_artifacts(output, results, original["started_at_epoch"], original["finished_at_epoch"])
    report["evidence_reclassified_at_epoch"] = time.time()
    report["reprocess_note"] = "Reclassified from the original rendered page text; no new network requests were made."
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("source_rows", "pages_fetched", "contacts_extracted", "prepass", "review", "exclude", "blocked_or_failed")}, indent=2))


if __name__ == "__main__":
    main()
