# Current Matrix360 client application

This directory is the sole frontend deployment root. Pages and assets come from `frontend-source/`; integrated behavior comes from `api/` and `lib/` using rewrites in `vercel.json`.

For local use, run `START_LOCAL_WINDOWS.cmd` from the repository root. A plain static HTTP server cannot run the application handlers.

Keep `.env.local` and saved data private. The Vercel allowlist excludes them. Keep existing project environment variables when deploying this directory.

Run `npm test` from the repository root. Current tests read canonical source rather than a duplicate frontend. See the repository root README and `REPOSITORY_CLEANUP.md` for setup and cleanup details.
