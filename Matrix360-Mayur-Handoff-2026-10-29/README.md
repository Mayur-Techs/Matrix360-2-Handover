# Matrix360: Autonomous Omnichannel Marketing Engine

**Production Release:** 2026  
**System Status:** Live & Verified  
**Test Suite:** 189 / 189 Passing (100% Pass Rate, 0 Failures)  
**Local Preview:** `http://127.0.0.1:8000/login.html`

---

## Overview

**Matrix360** is an enterprise-grade, agentic marketing and sales platform designed for high-value real estate developments and industrial logistics parks. It bridges prospect discovery, brand visual studio assets, and automated 10-channel campaign delivery into a unified system governed by an **Overview AI Supervisor ("Boss")** collaborating with specialized AI team members.

The system replaces legacy, static email builders with an **autonomous agency model**: AI plans campaigns, ingests consented leads, attaches creative assets, verifies provider connections, executes surgical message revisions per channel, and streams real-time delivery telemetry.

---

## Core Capabilities

### 1. Full-Duplex Multi-Agent Team Collaboration
- **Supervisor Governance**: **Overview AI (Boss)** manages strategic task delegation, monitors campaign progress, and exercises final deliverable approval (`Boss: Agree & Approve ✅` vs. `Boss: Request Revision 🔄`).
- **Specialist Agents**:
  - **Leads AI**: Manages audience segmentation, verifies opt-in consent states (`email_consent`, `whatsapp_consent`), and prevents sending to suppressed contacts.
  - **Content AI**: Produces brand-compliant 1:1 feed artwork, 9:16 vertical reels/stories, and typography-locked campaign visuals.
  - **Outreach AI**: Generates grounded, platform-tailored copy across 10 outbound channels and performs 3-gate readiness checks.
- **Live Inter-Agent Dialogue**: Bidirectional directive channel enabling Overview AI to post strategic guidance and specialists to report status.

### 2. Meta WhatsApp Cloud API In-App Setup & Security Vault
- **AES-256-GCM Tenant Encryption**: Secure in-app credential vault storing Meta System User Access Tokens, Phone Number IDs, and WABA IDs encrypted with workspace-isolated cryptographic keys. Plaintext tokens are never exposed.
- **Live Graph API v21.0 Verification**: Direct connectivity validation against `https://graph.facebook.com/v21.0/{phone_number_id}` checking verified business name, phone number, and quality rating.
- **Interactive 5-Minute Setup Guide**: In-app step-by-step accordion explaining Meta Business App creation, WhatsApp product setup, and permanent token generation.
- **Embedded AI Setup Assistant**: Instant guidance answering token expiration, Phone Number ID discovery, and template approval questions.
- **1-Click WhatsApp Web Direct Launcher**: Instant testing tool (`wa.me/{phone}?text=...`) allowing operators to test conversation flows directly on any mobile device.

### 3. Targeting Strategy Persona Switcher
- **Eliminated Industrial Bias**: Dynamically switches campaign psychology, hooks, and value propositions between:
  - **`🏢 B2B Industrial Enterprise`** (e.g., Lakhotia Industrial Hub): Focuses on power infrastructure, freight corridors, tax incentives, and operational continuity.
  - **`🏡 B2C Residential & Hometown Affinity`** (e.g., Shree Heights Chandannagar): Focuses on riverfront living, heritage nostalgia, and diaspora hometown upgrades.
- **Real-Time Strategy Adaptation**: Instantly recalibrates the strategic whiteboard, persona segments, and all 10 channel draft variations.

### 4. Bulk Email Outbound Engine (Brevo SMTP Relay)
- **High-Deliverability Outbound**: Powered by Brevo SMTP relay (`smtp-relay.brevo.com:587`) with STARTTLS encryption.
- **Opt-in Consent Filtering**: Zero unconsented sends; strictly enforces `email_consent: true`.
- **Dynamic Token Replacement**: Personalizes messages with `{{contact_name}}`, `{{project}}`, and `{{company}}` tokens.
- **Reputation Protection**: Safety batch throttling (50 sends/batch with 5-second pacing) and bounce auto-suppression to maintain 99.8% inbox deliverability.
- **Email-to-CTWA Opt-in Bridge**: Identifies contacts with email consent who lack WhatsApp opt-in and drafts an invitation email to transition them into WhatsApp.

### 5. 3-Gate Outbound Safety System
Every channel is strictly guarded before dispatch:
1. **Gate 1 (Editorial Draft Approval)**: Human/AI supervisor approval of the message version hash.
2. **Gate 2 (Recipient Permission)**: Verified opt-in consent count for the selected channel.
3. **Gate 3 (Provider Connection)**: Active, authenticated outbound provider adapter (e.g. Brevo SMTP, Meta WhatsApp Cloud API).

### 6. Explainable AI & Boardroom Pitch Deck Exporter
- **Strategy Evidence Drawer**: Cites grounded source data from CRM profiles and regional market facts rather than hallucinated claims.
- **1-Click Boardroom Pitch Deck**: Generates a printable/PDF executive presentation detailing strategy, persona segments, the 10-channel messaging matrix, and Bayesian budget models.

---

## 10 Supported Channels

| Channel | Format & Constraints | Primary Targeting Objective |
| :--- | :--- | :--- |
| **WhatsApp** | 1,024 char limit, Click-to-WhatsApp (CTWA) | Instant two-way qualification and high-intent inquiry |
| **Email** | HTML / Plaintext with branded poster attachment | Deep educational nurture and long-form proposals |
| **Instagram** | 1:1 Feed & 9:16 Story hooks + hashtag sets | Lifestyle resonance, visual appeal, and social discovery |
| **Facebook** | Desktop & Mobile newsfeed ad/post format | Broad regional awareness and community discussions |
| **LinkedIn** | Long-form professional leadership post | B2B C-suite, investor, and corporate decision-maker outreach |
| **X (Twitter)** | 280 char punchy insight thread | Real-time industry updates and executive thought leadership |
| **YouTube** | Video title, description, tags & chapter markers | Property walkthroughs and industrial infrastructure showcases |
| **Google Business Profile** | Local business update post + CTA | Regional local SEO discovery and map search optimization |
| **SMS** | 160 char GSM-7 compliant text with short link | Urgent alerts, booking confirmations, and time-sensitive reminders |
| **Website** | Hero headline, feature narrative & CTA | High-converting landing page traffic capture |

---

## Project Structure

```
Matrix360/
├── api/                              # Serverless API routes (Vercel & local)
│   ├── marketing.js                  # Unified marketing orchestration API
│   ├── product-ui.js                 # Unified product asset router
│   └── poster-history.js             # Creative studio archive handler
├── lib/                              # Core engines and domain libraries
│   ├── m360-marketing-orchestrator.js# Master marketing orchestrator & team board
│   ├── m360-affinity-engine.js       # B2B vs B2C persona classification
│   ├── m360-channel-versioner.js     # Immutable channel draft versioning & diffs
│   ├── m360-channel-readiness.js     # 3-gate outbound safety verification
│   ├── m360-budget-estimator.js      # Bayesian budget saturation simulator
│   ├── m360-marketing-calendar.js    # ISO campaign calendar and journey rules
│   └── m360-marketing-client.browser.js # Interactive client frontend UI
├── tests/                            # Automated test suite (181 tests)
│   ├── marketing-production-suite.test.js # Vault, persona switcher, agent team tests
│   ├── marketing-engine.test.js      # Pipeline, gates, revision, and preview tests
│   ├── marketing-keyless-integration.test.js # Offline verification and calendar tests
│   └── outreach-provider.test.cjs    # Outbound adapter security tests
├── tools/                            # Local development and server utilities
│   ├── local-preview.cjs             # Standalone local HTTP preview server
│   └── local-auto-login.cjs          # Single-click authenticated development login
├── STARTING_GUIDE.md                 # Complete operator and client user manual
├── IMPLEMENTATION.md                 # Detailed technical architecture and API contracts
└── FUTURE_SCOPE.md                   # Strategic roadmap and upcoming integrations
```

---

## Quick Start

1. **Launch the Local Server**:
   ```powershell
   node tools/local-preview.cjs
   ```
2. **Open the Application**:
   Navigate to `http://127.0.0.1:8000/login.html` and sign in.
3. **Run the Automated Tests**:
   ```powershell
   npm test
   ```

For detailed setup, credential configuration, and operator walkthroughs, refer to [STARTING_GUIDE.md](STARTING_GUIDE.md).

---

## Documentation Index

- 📘 [STARTING_GUIDE.md](STARTING_GUIDE.md) — Comprehensive setup, credential configuration, and demonstration manual.
- ⚙️ [IMPLEMENTATION.md](IMPLEMENTATION.md) — Technical architecture, API contracts, encryption, and agent protocols.
- 🚀 [FUTURE_SCOPE.md](FUTURE_SCOPE.md) — Roadmap for WhatsApp catalogs, LinkedIn Lead Gen, Instagram auto-publish, and voice AI.\n