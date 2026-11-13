# Repository cleanup — 3 November 2026

The retained application is `workstreams/avinash/frontend`, served locally by `tools/local-preview.cjs` on port 8050. Vercel uses this same frontend directory and its deployment allowlist.

## Removed older copies

- The sibling `Matrix360-Romit-Continuation-2026-10-31-FULL-SENSITIVE` tree, containing handoff and showcase snapshots.
- `workstreams/avinash/frontend-source`, the duplicate frontend outside the deployment root.
- `workstreams/avinash/frontend/approved_original`, the superseded homepage baseline.
- `workstreams/romit`, containing an old deployment-recovery launcher.
- `workstreams/mayur/maps_scraper_v3`, superseded by the retained V4 service.
- `workstreams/mayur/Matrix360_Engine_v4_and_Exports`, the older private-pilot engine snapshot. The cloud crawler source in `matrix_unified_sraperAndQualification` remains.
- `workstreams/mayur/matrix_unified_sraperAndQualification/quarantined_legacy`, explicitly retired and unserved assets.

Total: seven directories, 2,785 files. No Git history was rewritten. Backend services that are separate components rather than old frontend copies remain, including CRM, V4 discovery, the cloud crawler, and the prompt-driven discovery service.

## Verification

- SHA-256 comparison: all 93 protected files unchanged, covering active API/library/page/public source, Vercel configuration, private `.env.local`, and local data.
- Regression suite: 134 passed before cleanup; 134 passed after cleanup.
- Tests formerly reading the duplicate frontend now read canonical `frontend/frontend-source`. A stale copy-text assertion now checks the actual guard that preserves existing profile fields.
- Setup READMEs identify the sole deployment source. The Windows launcher explicitly selects port 8050.
- The obsolete homepage-baseline fidelity test was removed with its old baseline.

## Recovery

Before removal, every archived file was compared against its ZIP entry by SHA-256. Recovery copies are outside this repository at:

`C:\Users\User\.codex\visualizations\2026\11\01\01a19743-424e-7f50-a016-55353c120da9`

`cleanup-verified-backups.json` maps each removed directory to its recovery ZIP and archive hash. These are private local archives; they may contain old private configuration and must not be published or committed.

No GitHub push or Vercel deployment was performed for this local cleanup. Live generation, discovery, and email sending were not triggered.
