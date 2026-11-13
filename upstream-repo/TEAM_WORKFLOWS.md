# Four independent development workflows

| Workstream | Workflow file | Branch | Paths watched | Deliverable evidence |
|---|---|---|---|---|
| Avinash | `.github/workflows/avinash.yml` | `work/avinash` | `workstreams/avinash/**` | Frontend+CRM tests, tenant isolation, auth and staging URLs |
| Mayur | `.github/workflows/mayur.yml` | `work/mayur` | `workstreams/mayur/**` | Data reconciliation, filtering, export manifests, scraper tests |
| Pratha | `.github/workflows/pratha.yml` | `work/pratha` | `workstreams/pratha/**` | Ingest, eligibility, mock dispatch, persistence, auth tests |
| Tanmayi | `.github/workflows/tanmayi.yml` | `work/tanmayi` | `workstreams/tanmayi/**` | Generated content/reels evidence, basic prompt reproducibility and UI tests |

## Important: these workflows do not deploy

They only check that the named workstream directory exists and no obviously sensitive filenames are tracked under it. They deliberately avoid claiming any application test has passed before the recovered source and its dependencies are committed. Update each job with actual executable test steps; require passing tests before merging.

## Branch-to-PR model

- `main`: coordination/integration review; protected by process until branch protection is configured.
- `work/avinash`, `work/mayur`, `work/pratha`, `work/tanmayi`: persistent developer starting branches.
- For each task, optionally create `feature/<name>/<short-task>` from that developer's current work branch. Open a PR into the developer branch while development is ongoing, and a reviewed promotion PR to `main` when ready.
- No automatic merges from one developer's workstream to another.

## Repository administration

Avinash, as repository administrator, must use GitHub **Settings > Collaborators** to invite each developer's *confirmed* GitHub username. Invitations and branch-protection rules are **not** set by this starter. Use **Settings > Branches** or **Rules > Rulesets** to require PR reviews and completed CI for `main` when the repository plan permits it.
