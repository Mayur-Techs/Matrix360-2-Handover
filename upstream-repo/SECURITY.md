# Security, privacy and deployment controls

**Repository status at setup:** public. Set it to **private** before uploading proprietary Matrix 360 code, recovered CRM source, configuration, lead datasets or client artifacts, unless publication is intentionally authorized.

Never commit `.env` files, API keys, Render/Vercel tokens, Supabase service-role keys, Google credentials, passwords, SSH keys, unredacted logs, private customer data, or lead databases. Use managed deployment environment variables and GitHub Actions secrets only after repository permissions and access are reviewed.

The included Actions workflows use read-only repository permissions and do not ingest external secrets. They catch a subset of dangerous filenames; they are **not** comprehensive secret scanning or code auditing.

Never push forcefully to `main` and never delete branches or old deployment services during migration without explicit approval and a verified backup.

Report a security problem privately to the repository administrator instead of opening a public issue with sensitive details.
