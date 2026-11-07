# Golden Email — Project Plan

*Working name. Golden Analytics Full Stack Intern Challenge — due Nov 9, 2026.*
*Revision 2 — see §11 for what changed and why.*

## 1. What we're building (one sentence)

A web app where a small-business owner uploads their purchase history CSV and gets a weekly email plan: **who to email, what to say, and whether to offer a discount — and how big it can be while still making money.**

### The three questions every screen should serve
1. **Who should we email this week?**
2. **What should the email say?**
3. **Should we offer a discount, and how big can it be while still making money?**

If a chart or control doesn't help answer one of these, it doesn't ship.

### Why this (product reasoning to carry into the README/video — in your own words)
- The obvious build for "business user + data" is a chart dashboard or a chat-with-your-data box. Both show data; neither tells the user what to *do*.
- This turns a fundamental data operation (**transforming** raw transactions → customer-level features → segments) into a **decision**, which is what non-technical users actually want.
- It's general: any business with "customer, date, amount" rows can use it (online store, salon, gym, restaurant, travel agency).
- Discounts are where small businesses quietly lose money — giving 20% off to people who would have paid full price. Showing that explicitly is a sharp, non-obvious insight.
- **Honesty about uncertainty is a feature.** The app separates what it *measured* from your data and what it *assumed*, and frames money decisions around break-even points rather than confident-looking guesses.

### Target user
A non-technical owner/manager (e.g. salon owner, online shop owner). Smart, motivated, knows their business, doesn't know SQL or what "RFM" means. The app must never use jargon without a plain-English label.

---

## 2. Scope

### Must have (MVP)
- [ ] CSV upload + bundled sample datasets (so the demo works instantly)
- [ ] **Smart column mapping** with explained guesses, confidence levels, and user overrides (§3.1)
- [ ] Data cleaning on import with a visible summary that updates when mappings change
- [ ] Customer-level metrics: **Recency**, **Frequency**, **Monetary**
- [ ] **Typical purchase gap**: computed, shown with confidence, **editable** (§3.2)
- [ ] Rule-based, explainable segments, including **Second-timers** (§3.3)
- [ ] **Time window W** ("within N days of the email") that all rates and revenue figures use (§3.4)
- [ ] **Baseline buy rate (p₀) measured from the data** via backtest, with fallback (§3.5)
- [ ] Discount economics with an explicit uplift assumption and **break-even framing** (§3.6)
- [ ] **Profit-vs-discount curve per segment** (§3.7)
- [ ] Segment cards: count, revenue at stake, action, discount, reasoning, measured-vs-assumed labels
- [ ] Sliders that re-compute everything live
- [ ] Holdout ("don't email") group with a % slider
- [ ] AI-drafted email per segment, with a non-AI template fallback
- [ ] Export: per-segment customer lists (CSV), holdout separate

### Nice to have (only if time allows)
- [ ] "Chance of buying again by number of past orders" chart (the stat is computed in MVP; the chart is extra)
- [ ] Business-type presets (salon/gym/travel/etc. set default gap, W, thresholds)
- [ ] "Measure results" mode: upload next month's data, compare emailed vs. holdout, replace assumed uplift with measured uplift
- [ ] Save/load settings and mapping templates in localStorage

### Explicitly out of scope
- Actually sending emails (export instead)
- User accounts / database
- ML clustering or churn prediction (less explainable; contradicts the "trust it" goal)

---

## 3. Core logic

### 3.1 Data in: smart column mapping

**Fields:** required `customer_id`, `order_date`, `amount`. Optional `customer_name`, `email`, `product/category`, `quantity`, `unit_price`, `order_id`.

**How guesses are made (two signals combined into a confidence score):**
1. **Header match**: normalize headers (lowercase, strip spaces/punctuation) and match against synonym lists. Examples:
   - customer_id: `customer`, `cust id`, `client`, `member`, `user id`, `account`, `guest`, `buyer`
   - order_date: `date`, `order date`, `txn dt`, `purchased at`, `created`, `timestamp`, `visit`, `booking date`
   - amount: `total`, `amount`, `revenue`, `sales`, `price`, `paid`, `grand total`, `subtotal`
2. **Content sniffing** on a sample of rows:
   - Date column: % of values that parse as dates
   - Amount column: % numeric after stripping `$ € £ , ` and handling `(12.50)` as negative and `1.234,56` European format
   - Customer ID: repeats across rows (ID-like), not unique per row (that's an order ID)
   - Email: regex match rate

**Messy-data decisions the app makes, and shows:**
- **No amount column but quantity + unit price exist** → amount = quantity × unit_price.
- **No customer ID** → fall back to email, then name (warn: "Matching customers by name may merge two different people").
- **Ambiguous dates (03/04/2024)**: if any value has a first part > 12, it's day-first; otherwise default to month-first and flag it.
- **Line items vs. orders**: if an order ID exists and repeats, collapse line items into orders before counting frequency.
- Trim whitespace, normalize ID case, drop rows missing required fields, handle refunds/negatives (see §10).

**UI:** Each field shows its guessed column, a confidence badge (High/Medium/Low), and the reason ("Picked *Txn Dt*: 98% of values are dates"). Dropdowns allow overrides. A preview of 5 cleaned rows and the cleaning summary ("Dropped 12 rows with no amount; read 41 dates as day-first") **re-run live** when a mapping changes. Low-confidence or missing required fields block "Continue" until resolved.

### 3.2 Customer metrics & typical purchase gap
Per customer: first/last purchase date, days since last purchase (R), number of orders (F), total spend and average order value (M / AOV).

**"Today" = the latest date in the file** (overridable), so historical datasets work.

**Typical purchase gap** = median days between consecutive orders, across repeat customers.
- Shown with its basis: "Based on 412 repeat customers."
- **Low confidence** if fewer than ~30 repeat customers, or if fewer than ~15% of customers have repeated. In that case, the app asks the user directly: "Most of your customers have only bought once, so we can't measure this well. How often does a typical customer come back?" It also offers business-type presets.
- Always editable. Edited values are labeled "set by you".
- Drives the defaults for the missing threshold and the lost threshold.

### 3.3 Segments (explainable rules, evaluated in order — first match wins)

"Active" = days since last purchase ≤ **missing threshold** (default 2× typical gap).
"Lost" = days since last purchase > **lost threshold** (default 3× missing threshold). Both are sliders.

| Segment | Rule (defaults adjustable) | Recommended action | Discount? |
|---|---|---|---|
| **VIPs** | Top 10% by total spend AND active | Thank-you / early access / perk | Usually **no** |
| **Regulars** | Active, ≥ 3 orders | Product news, "you might like" | Usually **no** |
| **Second-timers** *(new)* | Active, exactly 2 orders | "Here's what to try next": a nudge toward purchase #3 | Small, only if the curve says so |
| **New customers** | Active, 1 order | Welcome + nudge to 2nd purchase | Small, only if the curve says so |
| **Slipping away** | Not active, not lost, ≥ 2 orders | "We miss you" win-back | Most likely candidate |
| **Lost** | Past lost threshold | Last-chance email or skip | Only if the curve says so; often **skip** |
| **One-and-done** | Not active, not lost, 1 order | Low priority / skip | Usually no |

"Usually" defaults are *outputs* of the economics in §3.6, not hard-coded. A VIP group gets no discount because its measured baseline buy rate is high, which pushes the break-even discount to zero.

**Why Second-timers are their own group:**
- Customers with exactly 2 orders sit between "tried us once" and "habit". In retention analysis, the chance of buying again tends to rise with each additional order, so the step from 2 → 3 orders is often where a customer turns into a regular.
- Lumping them into Regulars would hide them inside customers who are already habitual (wrong message: they don't need loyalty perks yet). Lumping them into New would send a "welcome" email to someone who's already come back.
- **The app checks this claim on the user's own data** rather than asserting it: it computes "chance of buying again given 1, 2, 3, 4+ past orders" and shows it in the Second-timers reasoning ("Your customers with 2 orders buy again 41% of the time vs. 18% after 1 order"). If the data doesn't show the jump, the reasoning says so honestly.
- The Regulars cutoff (≥ 3 orders) is adjustable. Second-timers always means "one order below the Regulars cutoff".

Every segment card shows reasoning in plain words: *"Bought 5 times, but hasn't purchased in 94 days. Your customers usually come back every 30 days."*

### 3.4 Time window W
- One setting: **"Count a purchase if it happens within W days of the email"**. Default 30 days, slider 7–90. Business presets can change it (e.g. a travel agency may need 60–90).
- Everything uses W: p₀, uplift, revenue at stake, expected profit, the curve, and holdout comparisons. Labels always state it: "…in the next 30 days."

### 3.5 Where p₀ comes from: measured, not guessed
**p₀ = chance a customer in this segment buys within W days with no email.** This is computed from the user's own history with a backtest:

1. Pick a past cutoff date T = today − W.
2. Re-run the segmentation using only data up to T.
3. For each segment, measure the % of customers who bought in (T, T + W].
4. If history allows, repeat for up to 4 earlier cutoffs (T − W, T − 2W, …) and average them. This smooths out seasonality.

**Guards:**
- A segment with fewer than ~30 customers at the backtest cutoffs is marked **"low confidence"**. It falls back to a pooled rate from neighboring segments, or to a user-entered value.
- Caveat shown in the UI: the past rate already includes whatever marketing the business did then. It's "how they usually behave", not a perfect no-email baseline. The holdout group fixes this over time.
- p₀ is overridable per segment, and labeled **Measured** / **Set by you**.

### 3.6 Where p₁ comes from: an explicit assumption, with break-even as the headline
Purchase history alone **cannot** tell us how customers respond to an email or a discount. There are no past emails in the data. So the app does **not** pretend to know. Instead it:

**(a) Reframes p₁ as uplift**, which is easier to reason about:
> **Uplift u(d)** = extra % of recipients who buy within W days *because of* the email with discount d, who wouldn't have otherwise.
> p₁(d) = p₀ + u(d)

**(b) Lets uplift depend on discount size.** Making the curve an MVP feature surfaced this requirement. With a single fixed p₁, profit just falls in a straight line as discount rises, so the "best" discount would always be the smallest one, which is meaningless. Bigger discounts must persuade more people, with diminishing returns:
> u(d) = u₀ + (u_ref − u₀) · √(d / d_ref)

- **u₀** = uplift from a plain email, no discount. Default: 1 point.
- **u_ref** = uplift at a reference discount d_ref = 20%. Default: 4 points.
- Both are user-editable under "Your assumptions". The UI states plainly that **these defaults are deliberately conservative placeholders, not industry benchmarks.**

**(c) Computes profit honestly.** A discount is paid by *everyone* who uses it, including the p₀ people who'd have bought anyway:
> Extra profit per recipient (vs. not emailing) = AOV × [ (p₀ + u(d)) × (m − d) − p₀ × m ]
> Segment extra profit = (emailed customers) × that

- **Recommended discount** = the d (0 to m, in 5% steps) that maximizes extra profit. If d = 0 wins, the recommendation is "Email, no discount". If extra profit is ≤ 0 even at d = 0, the recommendation is "Don't email".
- **Max discount that still makes money** = the largest d where extra profit > 0. Found numerically.

**(d) Headlines break-even, not a single profit number.** For the recommended discount:
> **Break-even uplift** = p₀ × d / (m − d) + (a cost term if per-email costs are added later)
> "This 10% offer pays off if at least **1.8%** of recipients buy who wouldn't have otherwise."

Break-even depends only on measured p₀, the margin, and the discount. There is no guess in it. So it's the most trustworthy number on the screen.

### 3.7 Profit-vs-discount curve (MVP, per segment)
- X-axis: discount 0% → margin. Y-axis: expected extra profit over W days for the segment.
- Shows: the curve under current assumptions; a **shaded band** for uplift at 0.5× and 1.5× the assumption (so the user sees how sensitive the answer is); a zero line; markers for the **recommended** discount and the **max money-making** discount.
- Title states the takeaway: "Best offer: 10% off. Above 22% off, this email loses money."
- Re-renders live with margin, W, p₀, and uplift sliders.

### 3.8 Revenue at stake (uses W)
Per segment, over the same W-day window:
- **Expected revenue without emailing** = N × AOV × p₀ *(measured)*
- **Revenue at stake** = N × AOV × (p_active − p₀), where p_active is the measured W-day buy rate of Regulars. Plain English: "If this group bought like your active regulars, they'd spend $X more in the next 30 days." Measured, not assumed. Near zero for active groups, which is correct: that money isn't at risk.

### 3.9 Holdout group
- Slider: 0–30% of each segment randomly marked **"don't email"**. Seeded random, so it's stable across re-renders.
- Exported as a separate list.
- Plain-English purpose: "Like a control group. After W days, compare how many emailed vs. not-emailed customers bought. That tells you your *real* uplift, which replaces our guess."
- Stretch: "Measure results" upload to compute real uplift and feed it back into §3.6.

---

## 4. Screens / UX flow

1. **Start**: "Upload your sales CSV" + "Try a sample: Online store · Hair salon · Travel agency · Messy file". One line on what columns are needed.
2. **Check your data**: guessed mapping with confidence badges + reasons, override dropdowns, live preview + cleaning summary. Typical purchase gap shown here with an edit control and a low-confidence prompt if needed.
3. **Your business**: margin ("What % of each sale is profit?"), time window W, optional business type.
4. **This week's email plan** (main screen):
   - **Top summary**, written to lead with what's solid and state the assumption in the same breath:
     > Email **312** customers in 4 groups this week (skip 2 groups — not worth it).
     > **If 3% of recipients buy within 30 days who wouldn't have otherwise**, that's about **$2,140** extra profit. The plan breaks even at **1.2%**.
     The uplift in that sentence is a clickable/editable value, so the user can see the number change.
   - **Segment cards** (sorted by revenue at stake): count, revenue at stake (W days), action, discount (or "No discount — they'd likely buy anyway"), break-even line, reasoning. Small **Measured / Assumed / Set by you** tags on every number.
   - **Segment map**: recency vs. frequency, colored by segment, so the rules are visible.
   - **Controls panel** (sticky): missing & lost thresholds, typical gap, VIP cutoff %, Regulars cutoff, margin, W, holdout %. Uplift assumptions and per-segment p₀ overrides go under "Your assumptions".
5. **Segment detail** (click a card): customer list, **profit-vs-discount curve**, p₀ backtest details, "Draft email", export CSV.
6. **Email draft panel**: subject + body, tone (friendly / professional / playful), regenerate, copy. Merge fields like `{{first_name}}`.

### Visual rules
- Chart titles state the takeaway, not just the metric.
- Money in $, time in days/weeks. No unlabeled jargon ("RFM" only in a tooltip).
- **Every number derived from an assumption is visibly marked as such.**

---

## 5. Architecture & tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + TypeScript + Vite | Fast setup, typed data model |
| CSV parsing | Papa Parse | Robust, streams large files in browser |
| Charts | Recharts | Simple, React-native, supports area bands |
| Styling | Tailwind CSS | Speed |
| Server | Tiny Express with one endpoint `POST /api/draft-email` | Keeps the AI API key off the client |
| AI | Claude API | Email drafting only |
| Tests | Vitest | Unit tests on the pure logic |

**All analytics run client-side.** Customer data never leaves the browser; only segment-level summaries go to the AI.

### Code structure
```
/client/src
  /lib                 ← pure, tested, no React
    mapping.ts           header synonyms, content sniffing, confidence + reasons
    clean.ts             parse dates/amounts, collapse line items, cleaning report
    customers.ts         transactions → customer metrics, typical gap + confidence
    segments.ts          rule engine + plain-English reasons, repeat-rate by order count
    backtest.ts          p₀ per segment at past cutoffs, p_active
    economics.ts         uplift model, extra profit, recommended/max discount, break-even, curve points
    holdout.ts           seeded random assignment
    export.ts            per-segment CSV
  /components
    UploadStep, MappingStep, BusinessStep, PlanSummary, SegmentCard,
    SegmentMap, ProfitCurve, ControlsPanel, AssumptionsPanel, EmailDraft
  /data                  sample CSVs (incl. a messy one)
/server/index.ts         /api/draft-email + template fallback
/scripts/generate-data.ts
README.md  PROMPTS.md  PLAN.md
```

Design principle: **one `settings` object → pure functions → derived view.** Sliders only change `settings`, and everything else is recomputed (memoized). The backtest is the heaviest step, so it is memoized on (data, thresholds, W) and doesn't re-run on margin/uplift changes.

### AI email drafting
- Input: business type, segment name + reasoning, recommended action, discount (or none), W, tone. **No customer names or emails sent**; merge fields are used instead.
- Output: JSON `{ subject, preheader, body }`, validated before display.
- Fallback: hand-written templates per segment, so the demo never breaks.

---

## 6. Data
- Provided **Bookshop** dataset (if it has customer + date + amount) as the "real data" demo.
- **Synthetic CSVs** for salon, online store, travel agency, generated with realistic patterns: regulars, a churning group, big spenders, and a 1 → 2 → 3 order repeat pattern that a backtest can detect.
- One **deliberately messy file**: odd headers (`Cust #`, `Txn Dt`, `Grand Total`), `$` signs, European decimals, mixed date formats, blank rows, line items with qty × unit price. It exercises §3.1.
- The generator script is committed so the data is reproducible.

---

## 7. Implementation phases

| # | Phase | Output |
|---|---|---|
| 0 | Setup: Vite + TS + Tailwind, repo, `PROMPTS.md` started | Running blank app |
| 1 | Data generator incl. messy file | Sample CSVs |
| 2 | `mapping.ts` + `clean.ts` + Mapping UI + tests | Messy file maps correctly; overrides re-run live |
| 3 | `customers.ts` (incl. editable gap) + `segments.ts` + tests | Correct segments incl. Second-timers, with reasons |
| 4 | `backtest.ts` + tests | Measured p₀ / p_active with confidence |
| 5 | `economics.ts` + tests | Recommended/max discount, break-even, curve points |
| 6 | Main plan screen: summary, cards, controls, assumptions panel | Sliders update live |
| 7 | Segment detail: profit curve, segment map, export, holdout | Decision visuals + actionable output |
| 8 | AI email endpoint + fallback | Drafts per segment |
| 9 | Polish: empty/error states, copy, run instructions | Demo-ready |
| 10 | README (written by me), video, final prompt log | Submission |

### Testing checklist
- **Mapping**: synonym headers, content-sniffing wins over a misleading header, qty × price, day-first detection, no-ID fallback, line-item collapsing.
- **Metrics**: typical gap with scarce repeats → low-confidence flag; manual override wins.
- **Segments**: each rule boundary; 2-order active → Second-timers; Regulars cutoff change shifts Second-timers.
- **Backtest**: hand-built fixture with known p₀; small-segment fallback.
- **Economics**: p₀ = 0 → break-even 0; d = m → loss; u₀ = u_ref → recommended d = 0; extra profit ≤ 0 everywhere → "Don't email".
- **Manual**: each sample, the messy file, a missing required column, a 1-row file, a 50k-row file for performance.

---

## 8. Deliverables checklist
- [ ] Application code + run instructions (`npm install`, `npm run dev`, optional `ANTHROPIC_API_KEY` in `.env`)
- [ ] Sample/synthetic data files + generator script
- [ ] **README written by me (not AI)**: why I built this, how I used AI, what I'd do with more time
- [ ] `PROMPTS.md`: log of major prompts and where I redirected the AI
- [ ] ~5 min video

### Prompt log template (`PROMPTS.md`)
```
## [date] — [phase]
Prompt: ...
What the AI suggested: ...
What I changed / pushed back on, and why: ...
```
**Already-logged redirections from plan review (rev 2):**
- I questioned where p₀/p₁ came from → p₀ is now measured by backtest; p₁ became an explicit uplift assumption.
- I rejected a headline profit number built on guesses → the summary now states the uplift assumption inline and leads with break-even.
- I required a time window → W now governs every rate and revenue figure.
- I required editable mapping with intelligent guesses → confidence + reasons + overrides.
- I spotted the missing 2-order active group → Second-timers, justified against the user's own repeat-rate data.
- I required an editable purchase gap for scarce data.
- I moved the profit curve into the MVP → this exposed that a fixed p₁ makes the curve meaningless, which led to discount-dependent uplift.

### Video outline (~5 min)
1. (0:30) The problem: small businesses email everyone the same 20%-off coupon.
2. (0:45) Why this idea vs. the obvious dashboard/chatbot.
3. (2:00) Demo: messy upload → fix a mapping → margin + W → plan → move a slider → segment curve → draft email → export.
4. (0:45) How I guided the AI (2–3 examples from the log, e.g. measured vs. assumed).
5. (0:30) Architecture in one diagram.
6. (0:30) What I'd do next.

---

## 9. "If I had more time" (seed list)
- Measure-results loop: real uplift from holdout replaces the assumed uplift curve.
- Category-aware emails ("customers who bought X haven't come back").
- Seasonality-aware thresholds and backtests.
- Mailchimp/Klaviyo/Shopify integration instead of CSV export.
- Natural-language questions ("why is Maria in Slipping away?").
- Email fatigue limits and multi-week scheduling.
- Per-email costs and cannibalization of full-price sales in the profit model.

---

## 10. Open questions / decisions to make
- Refunds/negative amounts: drop vs. subtract from customer totals?
- Default uplift assumptions (u₀ = 1 pt, u_ref = 4 pts at 20% off): keep conservative, or let business presets change them?
- Revenue-at-stake definition (§3.8): is "gap vs. active regulars" the right framing for VIPs, or should VIPs show "revenue you'd lose if they lapsed"?
- Minimum sample sizes (30 customers, 15% repeat rate): tune once real data is loaded.
- Single-page only vs. include server: server is only needed for AI; the app must fully work without it.

---

## 11. Changelog
**Rev 2 (Nov 2)**
- p₀ is now measured via backtest (§3.5). p₁ is now an explicit, discount-dependent uplift assumption (§3.6).
- Added time window W across all rates and revenue (§3.4, §3.8).
- Summary leads with an inline assumption + break-even (§4).
- Expanded column mapping: confidence, reasons, overrides, messy-data rules (§3.1).
- Added Second-timers segment (§3.3).
- Typical gap is editable, with a low-confidence prompt (§3.2).
- Profit-vs-discount curve moved into MVP, with a sensitivity band (§3.7).
