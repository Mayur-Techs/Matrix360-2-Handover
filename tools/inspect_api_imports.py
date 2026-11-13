# -*- coding: utf-8 -*-
with open('Matrix360-Mayur-Handoff-2026-10-29/workstreams/avinash/frontend/api/marketing.js', 'r', encoding='utf-8') as f:
    text = f.read()

idx = text.find('const {')
end_idx = text.find('} = require(\'../lib/m360-marketing-orchestrator\');')
print(text[idx:end_idx+60])
