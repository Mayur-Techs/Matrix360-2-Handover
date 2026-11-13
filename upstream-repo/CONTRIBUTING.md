# Contributor guide — Matrix360WIP

## First-time setup

```powershell
git clone https://github.com/AvinashWasHere21/Matrix360WIP.git
cd Matrix360WIP
git fetch origin
git switch work/avinash # Replace with work/mayur, work/pratha, or work/tanmayi
```

If `git switch` says the remote branch is unknown, check `git branch -r`. Ask the repository owner to run the initialization script rather than inventing or rewriting branch history.

## Daily workflow

```powershell
git switch work/avinash
git pull --ff-only origin work/avinash
# Copy in the recovered and reviewed source under workstreams/avinash/
git status --short
git add workstreams/avinash
git commit -m "feat(avinash): restore <component>"
git push origin work/avinash
```

**Do not execute the example unchanged as a blind paste:** replace the contributor's name and commit message. Do not stage the whole drive, local backups containing secrets, or raw datasets.

Open a PR at [GitHub Pull Requests](https://github.com/AvinashWasHere21/Matrix360WIP/pulls) for review. A PR must state: changed modules, commands actually executed, outcomes, screenshot/log evidence as appropriate, rollback plan, and whether production connections change.

## Boundaries

- Avinash: `workstreams/avinash/` — Frontend and CRM; retain existing Vercel/Render/Supabase configuration unless approved.
- Mayur: `workstreams/mayur/` — Audience Engine V4 and scraper must remain independent, and independent of Pratha.
- Pratha: `workstreams/pratha/` — Campaign Console; do not connect to Mayur without authorization.
- Tanmayi: `workstreams/tanmayi/` — Social Manager; no secrets for Cloudflare, AI media APIs or staging accounts in commits.

## Pull request release gate

1. Code reviewed by an authorized team member.
2. Genuine implementation tests added/run (the default safety workflows are not functional tests).
3. No credentials or personal data included.
4. No unauthorized cross-workstream integration.
5. Production rollout requires a separate, explicitly approved change and rollback instructions.
