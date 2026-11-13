# Matrix360 Dynamic B2B vs. B2C Affinity Specification

## 1. Overview
The **Affinity Engine** (`m360-affinity-engine.js`) eliminates hardcoded industrial filter defaults for residential property clients. It inspects the selected workspace and dynamically toggles between **`b2b_industrial`** and **`b2c_affinity`** modes.

## 2. Project Classification Matrix

| Project / Client | Normalized Workspace | Profile Mode | Audience Entity Target | Core Affinity Signals | Value Proposition Focus |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Shree Heights** | `shree_heights`, `shree` | `b2c_affinity` | Individuals & Households | Chandannagar local residents, Hooghly belt upgraders, Kolkata/metro diaspora | Serene riverfront living, heritage roots, gated luxury, 2/3BHK high-ceiling residences from ₹70L |
| **Vrindavan Greens** | `vrindavan_greens`, `vrindavan` | `b2c_affinity` | Individuals & Families | Kalyani/Madanpur commuters, plotted development upgraders, weekend homeowners | Green plotted development, wide road infrastructure, peaceful residential lifestyle |
| **Lakhotia Industrial Park** | `lakhotia` | `b2b_industrial` | Corporate Decision Makers, MSMEs | Factory owners, 3PL logistics heads, warehouse stockists on NH6 Howrah corridor | Direct NH6 frontage, HT power substation, multi-axle trailer docking, statutory clearances |

## 3. Evidence-Backed Affinity Tiers (B2C Shree Heights)

1. **Chandannagar Local Residents:**
   - *Signal:* Current heritage homeowner or local tenant seeking modern lifestyle amenities (power back-up, elevators, security, rooftop community space).
   - *Message Focus:* Modern living without leaving your ancestral heritage neighbourhood.

2. **Hooghly Belt Upgraders:**
   - *Signal:* Commuters along the Grand Trunk (GT) Road and Howrah–Bandel rail artery seeking premium housing.
   - *Message Focus:* Superior construction quality, riverine peace, and 5-minute station connectivity.

3. **Kolkata & Metro Diaspora:**
   - *Signal:* Native individuals working in Kolkata, Bengaluru, or Mumbai with documented Chandannagar roots seeking a hometown investment or retirement residence.
   - *Message Focus:* Reconnect with your cultural roots and provide security for aging parents.

## 4. Separation of Parameters in UI
To prevent hallucinated demographic attributes:
- **Search & Discovery Criteria:** Documented geographical filters and observable public contact points.
- **Qualification Criteria:** Explicit verification of email/phone format, opt-in consent, and project affinity.
- **AI Contextual Assessment:** Plain-language reasoning explaining why this contact matches the campaign objective.
