# Maps Scraper V4

An independent Matrix360 Mayur sidecar for finding businesses from a plain-language search, checking evidence published on their official websites, and preparing leads for human review.

## Run locally

1. Copy `.env.example` to `.env` and add your local keys.
2. Install dependencies: `python -m pip install -r requirements.txt`
3. Start the app: `python -m uvicorn app:app --host 127.0.0.1 --port 8000`

`GOOGLE_MAPS_API_KEY` must be a key for a Google Cloud project with Google Places API (New) enabled. The local `leads.db`, real `.env`, browser state, generated exports, and caches are ignored by Git.

## Data sources and safety

The active candidate discovery path calls Google Places API (New). Qualification uses public pages from each business's own website. The shared build blocks legacy Google Maps browser automation and does not use LinkedIn, Yahoo, CAPTCHA bypasses, login bypasses, or guessed company facts.

## Matrix360 Preview integration

This project exposes a read-only, authenticated export contract for the existing Matrix360 CRM gateway. It deliberately does not write to the CRM or create another frontend. See [INTEGRATION.md](INTEGRATION.md) for the routes and human-review gate, and [DEPLOYMENT.md](DEPLOYMENT.md) for secured staging release gates.

## Verification

Run `python -m pytest -q`. These tests validate local data mapping and contract behavior; they do not make paid API calls or prove a production CRM rollout.
