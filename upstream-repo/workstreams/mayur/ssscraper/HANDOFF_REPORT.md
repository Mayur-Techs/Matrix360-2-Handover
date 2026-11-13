# SSScraper / Lakhotia Public-Web Research Pilot — Handoff Report

Date: 22 October 2026

## Purpose

This local FastAPI application performs evidence-bound research on public company websites for the Lakhotia Industrial Complex use case. It targets manufacturing, engineering, warehousing, logistics and other industrial candidates in the Kolkata, Howrah, Hooghly and broader West Bengal catchment.

It is independent of Matrix360 and other workstreams. It does not connect to a CRM, Vercel, Render, Supabase, paid enrichment provider or production service.

## What was accessed

- Local Windows workspace: `C:\Users\MAYUR\Documents\ChatGPT\SSScraper`.
- Public company websites only, rendered with local Chromium through Playwright.
- Each approved page was accessed after a `robots.txt` check and only through the official homepage or actual in-domain links observed on that homepage.
- GitHub documentation was consulted for collaborator invitation and repository access workflow.

No login-protected site, CAPTCHA, robots rule, certificate error, or other access control was bypassed. No paid scraping/enrichment tool was used.

## Components built

- `app/main.py` — FastAPI dashboard and CSV/report/screenshot download endpoints.
- `app/crawler.py` — Chromium rendering, robots check, canonical in-domain discovery, screenshots, contact extraction and evidence events.
- `app/rules.py` — reproducible industrial/geographic PREPASS, REVIEW and EXCLUDE rules.
- `app/store.py` — local SQLite persisted job/event state.
- `app/reprocess.py` — evidence-only reclassification; it makes no additional network requests.
- `app/templates/` and `app/static/` — dashboard displaying current job activity and the latest rendered-page screenshot.
- `tests/` — parser, link-safety, contact provenance and filtering tests.

## Live pilot evidence

Job ID: `f72d9af9f83d`

- Candidate source rows: 50
- Browser-rendered pages and screenshots: 96
- Source-linked contact rows: 459
- PREPASS: 47; REVIEW: 2; EXCLUDE: 1
- Blocked or failed candidates retained in report: 14
- Contact CSV SHA-256: `229BEE117511A10CCA6D7138A66F01FF14AF0EE576BF81BD24891EB6380CEA63`
- Evidence report SHA-256: `85BFE44F07E5C03416F15E98AFE4CF5991AA86348826EA2A80A15B5AE370B65A`

The completed artifacts remain local under `output/jobs/f72d9af9f83d/`. They are intentionally gitignored. Contact rows are source-linked findings, not validated deliverability, customer consent, or a statement that every finding is a sales lead.

## Validation completed

```text
python -m pytest -q        # 8 passed
python -m compileall -q app
git diff --check
```

The local dashboard at `http://127.0.0.1:8011` was checked for completed-job status and HTTP 200 downloads for the CSV, report and screenshot endpoints.

## Known limitations and review requirements

- 14 source candidates were blocked or failed because of HTTP restrictions, TLS/DNS failures, timeouts, an interrupted navigation, or a PDF download. Exact reasons are in `report.json`.
- Classification is evidence-based but heuristic; the 47 PREPASS and 2 REVIEW companies require human review before outreach.
- Public emails/phones have not been validated. No enrichment, CRM upload, contact scoring, consent validation, or scale run has occurred.
- Addresses and location types are extracted only where public rendered-page text supports them; otherwise they remain unknown. The input location hint is kept separately.

## GitHub handoff recommendation

Target repository: `https://github.com/AvinashWasHere21/Matrix360WIP.git`

1. The repository owner should invite GitHub user `Mayur Techs` with **Write** access (or add the user/team under the organisation's approved access policy). The invitation must be accepted before pushing.
2. Confirm that remote branch `work/mayur` exists. If it does not, ask the owner to run the repository initialization process; do not create or rewrite shared history.
3. Clone the target repository, switch to `work/mayur`, pull fast-forward only, then create `workstreams/mayur/ssscraper/`.
4. Copy only reviewed source: `README.md`, `requirements.txt`, `app/`, `tests/`, `.gitignore`, and this report. Do not copy `output/`, `data/jobs.sqlite3`, caches, browser screenshots, or other live research artifacts.
5. The seed CSV contains real-company research data. Obtain explicit owner approval before committing it; otherwise keep it local and document how an approved seed is supplied at runtime.
6. Run the stated checks, inspect `git status --short`, stage only `workstreams/mayur/ssscraper/`, commit, push `work/mayur`, then create a PR.

## Required PR statement

- Modules changed: independent SSScraper pilot only.
- Commands actually executed and outcomes: include the validation commands above.
- Evidence: attach a redacted screenshot or reference non-sensitive local evidence; do not upload raw contact exports without approval.
- Rollback: revert the one feature commit or close the PR before merge.
- Production connections: none changed.

## Next gates

1. Authorize review of the seed data and of the 47 PREPASS/2 REVIEW records.
2. Replace or resolve the 14 blocked candidates with approved alternative official sources.
3. Improve reviewed address/contact precision and validate public business emails only with explicit authorization.
4. Require reconciliation, manual-review sampling and a no-secrets scan before a 500-domain run.
5. Treat the 5,000-domain run as a separate approved operational change with concurrency, storage, rate-limit, retention and privacy review.
