# -*- coding: utf-8 -*-
with open('Matrix360-Mayur-Handoff-2026-10-29/workstreams/avinash/frontend/api/marketing.js', 'r', encoding='utf-8') as f:
    text = f.read()

idx = text.find("action === 'providers/verify'")
print(text[idx-50:idx+600])
