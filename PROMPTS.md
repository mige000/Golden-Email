# Prompt Log

Major prompts, what the AI suggested, and where I redirected it.

```
## [date] — [phase]
Prompt: ...
What the AI suggested: ...
What I changed / pushed back on, and why: ...
```

---

## Nov 2 — Plan review (PLAN.md rev 2)
- I questioned where p₀/p₁ came from → p₀ is now measured by backtest; p₁ became an explicit uplift assumption.
- I rejected a headline profit number built on guesses → the summary now states the uplift assumption inline and leads with break-even.
- I required a time window → W now governs every rate and revenue figure.
- I required editable mapping with intelligent guesses → confidence + reasons + overrides.
- I spotted the missing 2-order active group → Second-timers, justified against the user's own repeat-rate data.
- I required an editable purchase gap for scarce data.
- I moved the profit curve into the MVP → this exposed that a fixed p₁ makes the curve meaningless, which led to discount-dependent uplift.

## Nov 3 — Implementation plan
Prompt: Review PLAN.md and generate a step-by-step implementation plan; stop for my review.
What the AI suggested: a 17-step plan (pure `lib/` modules with tests first, then UI), and proposed resolutions for gaps in PLAN.md (VIP cutoff computed across all customers, a right-censoring-safe "chance of buying again" definition, p_active fallback, holdout reducing the emailed count, dates as integer days).
What I decided:
- Refunds are subtracted from customer totals (not dropped).
- VIP cards also show "revenue at risk if they lapse", because the §3.8 definition shows ~$0 for VIPs.
- Replaced the Bookshop dataset with a CD-store `purchases.csv`.
- Questioned whether a synthetic data generator is needed once real data exists. Kept it after weighing what one real file can't guarantee: a messy file for the mapping demo, known patterns to check the backtest against, and other business types.
- Asked for a review checkpoint after each step group.

## Nov 3 — Steps 0–2 (setup, data model, sample data)
What the AI found in purchases.csv: there's no order ID, 1,774 customer + day pairs have several rows, 80 rows have $0 amounts, and every customer was acquired in Jan–Mar 1997.
What I decided: when there's no order ID, rows for the same customer on the same day count as one order. $0 rows count as a visit with no spend. Samples are fetched on demand instead of bundled into the app.
- Because purchases.csv is old and every customer was acquired up front, I asked for a user-settable "today" date. The plan can now be viewed as of any date in the data (orders after it are ignored), so I can see what the segments and recommendations would have been at that point.

## Nov 3 — Steps 7–9 (backtest, discount math, holdout + export)
What the AI flagged: emails cost nothing in the model and a plain email always has some uplift, so every group comes out worth emailing and the plan never says "Don't email". It suggested adding a cost per email.
What I decided: keep the model as it is, with no per-email cost. "Don't email" only appears if I set the uplift to zero.
What the AI flagged: in the synthetic data, customers who stop never come back, so "Lost" had a 0% baseline. That made every lost customer look like a free discount target.
What I decided: the generator now gives a few lapsed customers one comeback purchase, so Lost has a ~1% baseline, close to the 1.2% measured in purchases.csv.

## Nov 3 — Steps 12–13 (plan screen, segment detail)
What the AI built: the uplift in the summary sentence was editable as a what-if only. It re-priced the current offers at my number but never changed the recommendations, so the headline always matched the cards.
What I changed: I asked for an option to let that number change the recommendations. After typing a what-if, there's now a "Use X% for the recommendations" button. It scales the uplift assumptions (keeping the curve's shape) so the re-run plan averages X%. Where an offer flips at that level (e.g. Regulars go from no discount to 5% off), the plan can't hit X% exactly, so it lands on the closest value and says so.

## Nov 3 — Step 14 (AI email drafting): switched from Claude to Gemini
Prompt: Switch the email-drafting API from Anthropic Claude to Google's Gemini free tier (Gemini 3.1 Flash-Lite), because I don't want to pay for usage. Keep the endpoint, the response format, validation, the missing-key error and the template fallback, and update the tests.
What the AI did: replaced only the server-side drafter with Google's `@google/genai` SDK (`gemini-3.1-flash-lite`, structured JSON output, low thinking) and removed the Anthropic SDK. The frontend is unchanged. Gemini errors (bad key, free quota used up, server errors, network) map to the same kind of clear messages as before, and the key is read from GEMINI_API_KEY only on the server.
What testing found: Flash-Lite sometimes returned the body as one run-on line without paragraph breaks. The server now asks Gemini for a list of paragraphs and joins them itself, so formatting no longer depends on the model. The response to the browser is still { subject, preheader, body }.

## Nov 3 — UI review round
Prompt: after reviewing the UI I asked for five changes:
1. Show the test-group size once, in a section at the bottom, not under every group and in the summary.
2. Split the big "Lost" and "Slipping away" boxes so lapsed VIPs are separate from customers who bought only once or twice, with discounts adjusted for lapsed VIPs.
3. A dark theme modelled on the Golden Analytics site (#181833, #ff7b2c, #2b271e).
4. A carousel of visualizations showing group size and potential revenue.
5. Removing the example-customer callout from each group card.

What the AI did: added three groups (VIPs slipping away, Lost VIPs, Lost regulars), each with its own box on the map, and a "responds to a discount" multiplier per group (Lost VIPs 2×, VIPs slipping away 1.5×, Lost regulars 1.25×), labelled as an assumption and editable. It remapped the colour tokens in one place for the dark theme, and added "Group sizes" and "Where the money is" bar-chart slides next to the map.

What testing found: as a plain multiplier on the whole response, it didn't move the CD store's Lost VIPs offer at all. When almost nobody in a group buys anyway, scaling the whole response scales profit at every discount equally, so the best discount stays put. The AI switched the multiplier to boost only the discount-driven part of the response, which matches "more likely to come back if offered a discount". That raised the online store's Lost VIPs from 5% to 10% off, and the CD store's VIPs slipping away from no discount to 5% off.
