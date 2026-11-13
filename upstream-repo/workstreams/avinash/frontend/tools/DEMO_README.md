# Matrix 360 — Safe, offline Director walkthrough

Requires Python 3.10+; no CRM provider, GitHub account, external network, LLM or paid subscription needed.

1. On Windows, run `START_SYNTHETIC_DEMO_WINDOWS.cmd`. Alternatively run `python tools/run_synthetic_demo.py --synthetic-demo` from the frontend repository root.
2. Open `http://127.0.0.1:8000/` in a browser. Describe a **non-sensitive fictional** marketing objective and choose **Continue in my workspace**.
3. On the login page use `demo@matrix360.invalid` and `demo-only`. Both are non-secret demo-only values.
4. Choose **Demo · Fourth Manufacturing Business** (or another fictional workspace). Observe preserved objective and CRM leads, create a synthetic lead and update its stage.
5. AI capabilities correctly show **not connected**. No campaigns, research, customer email, WhatsApp or model inference are available. All synthetic records exist in memory and disappear when the server stops.

The webserver binds only `127.0.0.1` on ports 8000 and 9009. It injects a synthetic API origin into the recovered login/CRM pages at response time and visibly labels the session as demo. The approved public website source is not modified.

Optional automated HTTP smoke test: `python tools/check_synthetic_demo.py` (requires `httpx`).

**This is not evidence that the actual Supabase, Render or Vercel integration works.** Do not expose the demo on the internet or use real customer details.
