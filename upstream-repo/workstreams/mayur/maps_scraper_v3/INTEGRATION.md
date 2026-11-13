# Matrix360 CRM and frontend integration

This is an independent Mayur sidecar. It does **not** write to Avinash's CRM and does not modify the Avinash frontend.

## Contract

- `GET /api/integration/matrix360/manifest` exposes the versioned integration manifest.
- `GET /api/integration/matrix360/leads` returns review-only mapped records.
- Both routes require the server-only `X-Matrix360-Integration-Key` header, configured with `MATRIX360_INTEGRATION_KEY`.
- The Avinash backend should proxy this server-side, verify the user's CRM workspace membership, and create CRM records only after a human reviews the evidence.

No integration key, CRM bearer token, or lead data belongs in browser JavaScript or Git.

## Candidate source

The live app uses Google Places API (New) through `GOOGLE_MAPS_API_KEY`; it does not browser-automate Google Maps. Official public websites remain the evidence source for qualification. The legacy direct-browser implementation is blocked in this shared build.
