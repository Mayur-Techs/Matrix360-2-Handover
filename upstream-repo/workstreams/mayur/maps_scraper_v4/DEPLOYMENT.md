# Staging deployment

The supported staging target is a private Docker web service. `render.yaml` is intentionally set to `autoDeploy: false`: a reviewer must approve each staging release.

## Required staging secrets

- `GOOGLE_MAPS_API_KEY`: Google Places API (New), with billing and permitted API restrictions.
- `MATRIX360_APP_ACCESS_KEY`: injected by the existing Matrix360 gateway as `X-Matrix360-App-Key` for every non-health request.
- `MATRIX360_INTEGRATION_KEY`: injected by the CRM backend as `X-Matrix360-Integration-Key` for review-export routes.

Set `MATRIX360_DEPLOYMENT_STAGE=staging`. The app fails closed if the app access key is missing or wrong. `/healthz` is intentionally public and exposes no research data.

## Release gates

1. GitHub Actions functional workflow passes.
2. Container starts and `/healthz` returns `200`.
3. A request without the gateway key returns `401`; a staging service without a configured key returns `503`.
4. The existing CRM gateway proxies the integration endpoint server-side, verifies CRM-business membership, and keeps the browser away from both keys.
5. A reviewer checks exported evidence before an import. This sidecar never creates CRM records itself.
