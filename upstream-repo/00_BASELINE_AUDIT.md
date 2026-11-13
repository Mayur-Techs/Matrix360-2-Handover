# Matrix360 Marketing baseline audit — 2026-11-01

- Worktree: `Matrix360WIP`; branch `release/matrix360-portable-20261101`; baseline `24a9a9c`.
- Runtime: Node `v24.22.1`, npm `11.19.1`.
- Baseline: `npm test` → 91 passed, 0 failed.
- Canonical web app: `workstreams/avinash/frontend`; Node `npm start` only.
- Existing verified local capabilities: Overview marketing intent dispatch, authenticated workspace binding, CRM audience lookup, ten-channel drafts, selective revisions, hash-bound approvals, readiness gates, non-sending preview.
- Confirmed gaps: reverse handoff HTTP 501, static Day 1/2 calendar, no CSV import contract, no provider adapters, local JSON/process persistence, absent hosted Content task verifier and unreviewed shared schema.
- Live boundary: no provider call, model call, scraper run, production mutation, deployment, push or send was authorized or performed.

Secrets: `.env.local` remains ignored and was not read into evidence. Environment documentation contains names only.
