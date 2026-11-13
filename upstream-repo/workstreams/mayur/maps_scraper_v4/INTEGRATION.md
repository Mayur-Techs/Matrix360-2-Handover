# Matrix360 CRM gateway integration

This is an independent Mayur sidecar. It does **not** write to the CRM and does not require a new customer-facing frontend.

## Contract

- `GET /api/integration/matrix360/manifest` exposes the versioned integration manifest.
- `GET /api/integration/matrix360/leads` returns review-only mapped records.
- In staging, every non-health request also requires the gateway-injected `X-Matrix360-App-Key`, configured by `MATRIX360_APP_ACCESS_KEY`.
- Both routes require the server-only `X-Matrix360-Integration-Key` header, configured with `MATRIX360_INTEGRATION_KEY`.
- The existing Avinash gateway should proxy this server-side, verify the user's CRM-business membership, and create CRM records only after a human reviews the evidence.

No integration key, CRM bearer token, or lead data belongs in browser JavaScript or Git.

## Candidate source

The live app uses Google Places API (New) through `GOOGLE_MAPS_API_KEY`; it does not browser-automate Google Maps. Official public websites remain the evidence source for qualification. The legacy direct-browser implementation is blocked in this shared build. See [DEPLOYMENT.md](DEPLOYMENT.md) for staging setup and functional release gates.
