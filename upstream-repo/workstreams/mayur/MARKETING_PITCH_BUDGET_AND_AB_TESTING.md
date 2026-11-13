# Matrix360 Bayesian Budget Saturation & A/B Experimentation

## 1. Overview
The **Budget Estimator** (`m360-budget-estimator.js`) provides defensible, mathematically grounded planning for paid marketing campaigns. It enforces a strict **Zero-Fabricated-ROI Policy**, labeling all projections with the mandatory disclaimer:
`ESTIMATE_ONLY_NOT_HISTORICAL_RESULT`.

## 2. Diminishing-Returns Budget Saturation Curve

### Mathematical Model
Paid advertising yield experiences saturation and diminishing returns as budget scales. The expected lead volume $R(b)$ for a given budget $b$ is calculated using the saturation formula:

$$R(b) = R_{max} \cdot \frac{b}{b + k}$$

Where:
- $b$: Campaign budget in INR (e.g. ₹10,000 to ₹100,000)
- $R_{max}$: Asymptotic maximum lead yield under local audience size constraints (default: 180 leads)
- $k$: Half-saturation constant (default: ₹25,000, representing the spend point where marginal yield begins decaying significantly)

### Low / Expected / High Scenarios
- **Conservative Low (45% of median yield):** Accounts for ad fatigue, auction bidding spikes, or creative friction.
- **Expected Median (100% of saturation curve):** Sourced from calibrated benchmark CPMs (₹120–₹180) and CTRs (1.8%–2.6%).
- **Optimistic High (185% of median yield):** Reflects high viral resonance and tight affinity matching.

## 3. Two-Tailed MDE A/B Sample Size Formula

### Purpose
Before executing creative or copy A/B tests, the planner determines whether the campaign has sufficient traffic to achieve statistical significance.

### Formula
For equal 50/50 allocation between Variant A and Variant B with baseline conversion $p_1$ and minimum detectable effect (MDE) $p_2 - p_1$:

$$n_{per\_arm} \approx \frac{\left[z_{1-\alpha/2} \sqrt{2 \bar{p}(1-\bar{p})} + z_{1-\beta} \sqrt{p_1(1-p_1) + p_2(1-p_2)}\right]^2}{(p_2 - p_1)^2}$$

Where:
- $\alpha = 0.05 \implies z_{1-\alpha/2} = 1.960$ (95% confidence level)
- $1 - \beta = 0.80 \implies z_{1-\beta} = 0.842$ (80% statistical power)
- $\bar{p} = \frac{p_1 + p_2}{2}$

### 14-Day Seasonality Rule
Even if sample size requirements are met in fewer days, the system mandates a **minimum test duration of 14 full days** to prevent day-of-week seasonality bias (e.g. weekend residential search spikes).
