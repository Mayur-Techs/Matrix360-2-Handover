# Director Walkthrough & Live Marketing Demonstration

## 1. Demo Scenario Overview
This script provides the exact click-by-click procedure for the Director review, demonstrating the end-to-end journey from a natural-language marketing request to an approved multi-channel campaign with real CRM leads, surgical revisions, readiness checks, and budget math.

## 2. Walkthrough Steps

### Step 1: Open the Application
1. Navigate to: `http://127.0.0.1:8020/client-dashboard.html?page=marketing#marketing`
2. Observe the **Marketing Centre** workspace:
   - Notice the visual style matches Overview exactly (`#f6faf8` background, `#176451` dark teal headers, `#155b49` primary buttons, clean card containers).
   - Notice the complete absence of messy emojis—clean typography, crisp badge tags, and subtle indicators.

### Step 2: Natural-Language Campaign Dispatch
1. Click the suggested prompt pill:
   `Market Shree Heights to Chandannagar diaspora via WhatsApp & Email`
2. The prompt automatically fills the command textarea.
3. Click **Ask Marketing AI** (`.primary`).
4. Observe the live status spinner change to:
   *"Analyzing objective and orchestrating campaign..."*
5. The **Multi-Agent Neural Mesh** logs the dispatch in real-time, querying Leads AI and Content AI.
6. The **6-Step Progress Pipeline** marks steps 01 through 06 as complete (`Draft Ready`).

### Step 3: Inspect Strategy & B2C Affinity Logic
1. Look at the **Campaign Strategy & Positioning** card:
   - Notice the mode badge: `B2C Residential / Affinity Mode`.
   - Core affinity segments display: *Chandannagar Local Residents*, *Hooghly Belt Upgraders*, and *Kolkata & Metro Diaspora*.
   - Value proposition highlights serene riverfront living, 2/3BHK luxury, and ₹70L+ positioning.
2. Click the **Lakhotia Industrial (B2B)** profile button:
   - Observe the mode badge instantly switch to `B2B Industrial Mode`.
   - Strategy updates to NH6 trailer docking, HT substation power, and logistics MSME targeting.
3. Click back to **Shree Heights (B2C)**.

### Step 4: Examine CRM Audience Snapshot & 3-Gate Readiness
1. Scroll to the **CRM Audience Snapshot** table:
   - Displays 24 verified contacts from Leads & Pipeline.
   - 6 contacts have WhatsApp Opt-In `Opted-In`; 18 have `Pending Opt-In`.
2. Inspect the **3-Gate Channel Readiness** row:
   - `Gate 1: Editorial Draft Status` -> `Draft for Review` (warn).
   - `Gate 2: Audience Eligibility & Consent` -> `6/24 Verified Contacts Eligible` (WhatsApp consent enforced).
   - `Gate 3: Provider Connection Status` -> `Disconnected (Connection Required)`.
   - Outbound sending is blocked until all three gates pass.

### Step 5: WhatsApp Mockup & Email-to-CTWA Opt-In Bridge
1. Under WhatsApp preview, observe:
   - Clean enterprise smartphone mockup with business branding.
   - Character count (e.g. 214 chars out of Meta max 1,024).
   - Variables: `{{contact_name}}`, `{{project}}`.
   - CTA button: `Tap to Chat / Book Site Visit (wa.me/919830099999)`.
2. On the right, inspect the **Email-to-Click-to-WhatsApp (CTWA) Opt-In Bridge**:
   - Explicitly notes that 18 contacts have verified email but lack WhatsApp consent.
   - Click **Preview CTWA Bridge Email** to view the compliant draft allowing prospects to voluntarily opt in.

### Step 6: Channel Switching & Email Preview
1. Click the **Email** tab.
2. Observe the preview change to the desktop email client:
   - Subject: *Exclusive Preview Pass: Modern Living at Shree Heights*
   - From: `Shree Heights Outreach <outreach@shree_heights.in>`
   - Deliverability: `SPF: Pass • DKIM: Pass (2048-bit) • DMARC: Configured • List-Unsubscribe: Active`
   - Unsubscribe footer at bottom.
3. Gate 2 updates to `24/24 Verified Contacts Eligible` (all 24 contacts have verified emails).

### Step 7: Surgical Targeted Revision & Visual Diff
1. In the **Surgical Natural-Language Revision** box, type:
   `Shorten WhatsApp and make LinkedIn more formal, keep Instagram unchanged`
2. Click **Apply**.
3. Observe:
   - WhatsApp version increments from `v1` to `v2`.
   - LinkedIn version increments from `v1` to `v2`.
   - Click the **Instagram** tab: version remains `v1` with zero modification (Zero-Unintended Mutation Guarantee).
4. Click back to WhatsApp:
   - The **Line-by-Line Visual Diff Viewer** displays:
     - `  [existing lines]`
     - `+ Special Revision: Direct site booking passes available now.`
5. Click **Approve Draft for Release**:
   - Gate 1 transitions to `Approved for Release`.

### Step 8: Bayesian Budget Saturation & A/B Experimentation
1. Scroll to the **Bayesian Budget Saturation** section.
2. Notice the mandatory disclaimer badge: `ESTIMATE_ONLY_NOT_HISTORICAL_RESULT`.
3. Drag the **Campaign Budget** slider from ₹35,000 to ₹60,000:
   - Expected leads update according to $R(b) = R_{max} \cdot \frac{b}{b+k}$.
   - Notice the saturation indicator reflects diminishing returns past ₹40,000.
4. Drag the **Duration** slider from 30 Days to 14 Days:
   - The A/B Experiment Sizing recalculates required sample visits per arm based on two-tailed MDE statistical power (80%) and alpha (0.05).
   - The 14-day minimum duration rule prevents weekend seasonality bias.

### Step 9: Multi-Engine Coordination & Overview Telemetry
1. In the Neural Mesh, click **Broadcast Telemetry to Overview AI**:
   - Overview receives current task state (`status: draft_ready`, `channels: 10`, `readiness: verified`).
2. Click **Run Multi-Engine Coordination**:
   - All 4 engines exchange live handshake envelopes, logged in the monospace activity terminal.
3. Click the top nav **Dashboard** pill to navigate to Overview:
   - Overview reflects the active marketing task and allows 1-click return to Marketing.
