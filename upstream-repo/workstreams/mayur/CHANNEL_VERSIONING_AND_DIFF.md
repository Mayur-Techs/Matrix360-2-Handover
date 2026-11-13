# Matrix360 Surgical Per-Channel Versioning & Visual Diff

## 1. Overview
The **Channel Versioner** (`m360-channel-versioner.js`) wraps the existing deterministic `channel-copy.js` formatter so that all 10 marketing channels maintain **isolated, immutable version trees**.

## 2. Supported Channels
1. **WhatsApp**
2. **Email**
3. **Facebook**
4. **Instagram**
5. **LinkedIn**
6. **X (Twitter)**
7. **YouTube**
8. **Google Business Profile**
9. **SMS**
10. **Website**

## 3. Immutability & Zero-Unintended Mutation Guarantee
When a user issues a targeted natural-language revision such as:
> *"Shorten WhatsApp and make LinkedIn more formal, keep Instagram unchanged"*

1. **Target Channel Parsing:**
   The engine extracts `['WhatsApp', 'LinkedIn']` as the explicit revision target.
2. **Selective Version Increment:**
   - WhatsApp version increments: $v_1 \rightarrow v_2$.
   - LinkedIn version increments: $v_1 \rightarrow v_2$.
3. **Byte-for-Byte Preservation:**
   - Instagram, Facebook, X, YouTube, Google Business Profile, SMS, and Website remain completely untouched.
   - Their version IDs, content hashes, and approval states remain byte-identical.
4. **Line-by-Line Visual Diff:**
   A compute diff algorithm compares the new version against its immediate parent:
   - `+ added` lines
   - `- removed` lines
   - `  unchanged` lines

## 4. Concurrency & Revisions
- All versions are stored as an append-only array.
- Approving a channel locks that channel's active version (`status: 'approved'`).
- Subsequent revisions to that channel automatically transition the new version back to `draft_for_review` without invalidating approvals on unrelated channels.
