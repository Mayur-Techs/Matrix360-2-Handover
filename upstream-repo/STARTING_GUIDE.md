# Matrix360: Operator & Developer Starting Guide

Welcome to Matrix360. This guide walks you through system requirements, local server launch, credential configuration, and complete campaign workflows.

---

## 1. System Requirements & Environment

- **Node.js**: Version 20.x or 24.x LTS.
- **Operating System**: Windows 10/11, macOS, or Linux.
- **Environment Configuration**: Stored in `workstreams/avinash/frontend/.env.local`.

### Sample `.env.local` Configuration:
```ini
# Brevo SMTP Relay
BREVO_SMTP_KEY=xkeysib-your-brevo-smtp-key
BREVO_SENDER_EMAIL=outreach@yourbusiness.com
BREVO_SENDER_NAME=Matrix360 Campaigns

# Meta WhatsApp Cloud API (Optional defaults)
WHATSAPP_API_TOKEN=EAABw...
WHATSAPP_PHONE_NUMBER_ID=102938475612345
WHATSAPP_BUSINESS_ACCOUNT_ID=987654321012345

# Development & Test Guards
M360_KEYLESS_TEST_MODE=false
MARKETING_ALLOWED_EMAILS=your-test-email@example.com
```

---

## 2. Launching the Local Application

From this directory, start the local preview server:

```powershell
node tools/local-preview.cjs
```

The console will indicate that the preview server is active:
```text
Matrix360 real local preview: http://127.0.0.1:8000/login.html
```

Open **`http://127.0.0.1:8000/login.html`** in your browser. You can sign in using your credentials or utilize the automated showcase session.

---

## 3. Step-by-Step Campaign Walkthrough

### Step 1: Access Outreach / Marketing
In the top navigation header, click **Outreach** (or visit `/client-dashboard.html?page=marketing#marketing`).

### Step 2: Formulate a Campaign Goal
In the **Tell the AI what you want to achieve** panel:
- Type your custom campaign goal, or click one of the preset quick chips:
  - `🚀 Bulk Email Blast`
  - `💬 WhatsApp Lead Flow`
  - `📸 Instagram/FB Visual`
  - `💼 LinkedIn Executive`
- Click **Create my campaign**. The AI orchestrator will assemble strategy, audience criteria, and drafts for all 10 channels.

### Step 3: Switch Targeting Persona (B2B vs. B2C)
Above the Campaign Strategy whiteboard:
- Click **🏢 B2B Industrial / Enterprise (e.g. Lakhotia)** to focus on supply chain infrastructure, freight corridors, and industrial plots.
- Click **🏡 B2C Residential & Hometown Affinity (e.g. Shree Heights)** to focus on riverfront apartments, heritage nostalgia, and diaspora hometown upgrades.
- Notice how the value proposition, emotional hook, and audience segments adapt immediately.

### Step 4: Configure WhatsApp Meta Cloud API
Under **Step 3 (Sending connection)**:
1. Click **🔑 Configure Key** on the Meta WhatsApp Cloud API card.
2. In the secure vault drawer, enter your **System User Access Token** and **Phone Number ID**.
3. If you need assistance:
   - Expand the **📘 How to get your WhatsApp Cloud API Key in 5 minutes** guide for step-by-step instructions.
   - Click the AI Assistant prompt chips (`Permanent Token?`, `Find Phone ID?`, `Add Real Number?`) for instant answers.
4. Click **Save & Verify WhatsApp Connection**. The token is encrypted with AES-256-GCM, and Gate 3 will update to **Provider Verified**.

### Step 5: Verify Brevo SMTP Email Relay
1. Locate the **Brevo SMTP Email** card under Step 3.
2. Click **Verify Brevo**. The system tests connection over Port 587 STARTTLS.
3. Upon success, the status displays `✓ Brevo SMTP Connected & Verified`.

### Step 6: Review & Improve Channel Copy
1. Select any channel tab (e.g., **WhatsApp**, **Email**, **Instagram**, **LinkedIn**).
2. Review the preview mockup (WhatsApp message bubble, Email layout, Instagram post card).
3. Use the **Ask AI to improve this message** input with quick suggestion chips (`Shorter`, `Friendlier`, `Stronger action`) and click **Rewrite with AI**.
4. Review the visual diff viewer to inspect line-by-line additions and removals.
5. Click **Approve this version** to satisfy Gate 1.

### Step 7: Test Delivery
- **WhatsApp Web Direct Launcher**: In the WhatsApp tab, enter any mobile number under *⚡ 1-Click WhatsApp Web Direct Launcher* and click **Launch WhatsApp Web &rarr;** to test the conversation flow on your smartphone.
- **Controlled Email Test**: Enter your email address under *Where should the test email go?* and click **Send one test email**.

### Step 8: Multi-Agent Team Supervision
1. Expand **Advanced coordination tools**.
2. Review the **Overview AI (Boss)** status bar.
3. Click **Boss: Agree & Approve** to record executive sign-off, or **Boss: Request Revision** to flag deliverables for refinement.
4. Use the directive input form to send instructions directly into the live inter-agent dialogue stream.

### Step 9: Export Boardroom Pitch Deck
Click **📄 Export Boardroom Pitch Deck** in the Campaign Strategy card. A clean, styled printable executive brief will open in a new tab, ready to save as a PDF or present in client meetings.

---

## 4. Running the Automated Test Suite

Matrix360 includes 181 comprehensive regression and security tests:

```powershell
npm test
```

Expected output:
```text
✔ sign-in retains POST credentials (6.2ms)
✔ WhatsApp Meta Key Vault: Tenant-isolated AES-256-GCM encryption and provider verification (15.3ms)
✔ Persona Mode Switcher: Dynamically shifts between B2B Industrial and B2C Affinity (96.7ms)
✔ Multi-Agent Team Collaboration: Supervisor review controls and inter-agent directives (110.8ms)
✔ Direct Lead Injection: Imports contacts and updates Gate 2 audience eligibility (85.3ms)
...
ℹ tests 181
ℹ suites 0
ℹ pass 181
ℹ fail 0
ℹ duration_ms 1607.6ms
```\n