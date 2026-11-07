import type { SegmentId, UpliftAssumptions } from './types';

/** Discounts considered for the recommendation: 0%, 5%, 10%, … up to the margin. */
export const DISCOUNT_STEP = 0.05;

/**
 * Uplift u(d): extra share of recipients who buy within W days because of an email with discount d,
 * who wouldn't have otherwise. Grows with the discount, with diminishing returns (PLAN.md §3.6).
 */
export function uplift(d: number, a: UpliftAssumptions): number {
  if (d <= 0 || a.dRef <= 0) return Math.max(0, a.u0);
  return Math.max(0, a.u0 + (a.uRef - a.u0) * Math.sqrt(d / a.dRef));
}

/** The base uplift curve scaled for one group (both u₀ and u_ref, so the curve keeps its shape). */
export function scaleUplift(a: UpliftAssumptions, multiplier = 1): UpliftAssumptions {
  return multiplier === 1 ? a : { ...a, u0: a.u0 * multiplier, uRef: a.uRef * multiplier };
}

/**
 * A group that responds more strongly to a *discount*: the part of uplift that comes from the
 * discount (u_ref − u₀) is multiplied by k; the plain-email uplift u₀ is unchanged.
 */
export function boostDiscountResponse(a: UpliftAssumptions, k = 1): UpliftAssumptions {
  return k === 1 ? a : { ...a, uRef: a.u0 + k * (a.uRef - a.u0) };
}

export interface OfferInput {
  /** Baseline buy rate within W days without an email. */
  p0: number;
  /** Average order value. */
  aov: number;
  /** Profit margin (fraction of each sale). */
  margin: number;
  assumptions: UpliftAssumptions;
  /** Multiplies the uplift curve; 0.5 / 1.5 draw the sensitivity band. */
  upliftScale?: number;
}

/**
 * Extra profit per recipient vs. not emailing = AOV × [(p₀ + u(d)) × (m − d) − p₀ × m].
 * The discount is paid by everyone who uses it, including the p₀ people who'd have bought anyway.
 */
export function extraProfitPerRecipient(d: number, x: OfferInput): number {
  const u = Math.min(uplift(d, x.assumptions) * (x.upliftScale ?? 1), Math.max(0, 1 - x.p0));
  return x.aov * ((x.p0 + u) * (x.margin - d) - x.p0 * x.margin);
}

/** Uplift needed for discount d to pay for itself: p₀ × d / (m − d). Uses no assumptions. */
export function breakEvenUplift(d: number, p0: number, margin: number): number {
  if (d >= margin) return Infinity;
  return (p0 * d) / (margin - d);
}

export function discountSteps(margin: number): number[] {
  const out: number[] = [];
  for (let i = 0; i * DISCOUNT_STEP <= margin + 1e-9; i++) out.push(Math.round(i * DISCOUNT_STEP * 100) / 100);
  return out;
}

export type OfferAction = 'no-email' | 'email-no-discount' | 'email-discount';

export interface Recommendation {
  action: OfferAction;
  /** Recommended discount (0 when no discount or no email). */
  discount: number;
  /** Largest discount that still makes money; null if none does. */
  maxProfitableDiscount: number | null;
  /** Break-even uplift at the recommended discount (or at 0% when not emailing). */
  breakEvenUplift: number;
  /** Assumed uplift at the recommended discount. */
  assumedUplift: number;
  perRecipient: number;
  /** Extra profit over W days for the emailed customers. */
  extraProfit: number;
  emailed: number;
}

export function recommend(x: OfferInput, emailed: number): Recommendation {
  let best = 0;
  let bestProfit = extraProfitPerRecipient(0, x);
  for (const d of discountSteps(x.margin)) {
    const p = extraProfitPerRecipient(d, x);
    if (p > bestProfit + 1e-12) {
      best = d;
      bestProfit = p;
    }
  }
  const maxProfitableDiscount = maxProfitable(x);
  if (bestProfit <= 0 || emailed === 0) {
    const perRecipient = extraProfitPerRecipient(0, x);
    return {
      action: 'no-email',
      discount: 0,
      maxProfitableDiscount,
      breakEvenUplift: breakEvenUplift(0, x.p0, x.margin),
      assumedUplift: uplift(0, x.assumptions),
      perRecipient,
      extraProfit: 0,
      emailed,
    };
  }
  return {
    action: best === 0 ? 'email-no-discount' : 'email-discount',
    discount: best,
    maxProfitableDiscount,
    breakEvenUplift: breakEvenUplift(best, x.p0, x.margin),
    assumedUplift: uplift(best, x.assumptions),
    perRecipient: bestProfit,
    extraProfit: bestProfit * emailed,
    emailed,
  };
}

/** Largest discount (to 0.25%) with positive extra profit, found by scanning; null if none. */
export function maxProfitable(x: OfferInput, resolution = 0.0025): number | null {
  let found: number | null = null;
  for (let i = 0; i * resolution <= x.margin + 1e-9; i++) {
    const d = i * resolution;
    if (extraProfitPerRecipient(d, x) > 0) found = d;
  }
  return found === null ? null : Math.round(found * 10000) / 10000;
}

export interface CurvePoint {
  discount: number;
  profit: number;
  /** Profit if uplift is half the assumption. */
  low: number;
  /** Profit if uplift is 1.5× the assumption. */
  high: number;
}

/** Segment extra profit vs. discount, 0 → margin, with a 0.5×–1.5× uplift band (PLAN.md §3.7). */
export function profitCurve(x: OfferInput, emailed: number, step = 0.01): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (let i = 0; i * step <= x.margin + 1e-9; i++) {
    const d = Math.round(i * step * 10000) / 10000;
    out.push({
      discount: d,
      profit: emailed * extraProfitPerRecipient(d, x),
      low: emailed * extraProfitPerRecipient(d, { ...x, upliftScale: 0.5 * (x.upliftScale ?? 1) }),
      high: emailed * extraProfitPerRecipient(d, { ...x, upliftScale: 1.5 * (x.upliftScale ?? 1) }),
    });
  }
  return out;
}

// ---------- Revenue figures (PLAN.md §3.8, all over the same W days) ----------

/** N × AOV × p₀: what the group spends anyway. */
export const expectedRevenueNoEmail = (n: number, aov: number, p0: number) => n * aov * p0;

/** N × AOV × (p_active − p₀): extra spend if the group bought like active regulars. */
export const revenueAtStake = (n: number, aov: number, p0: number, pActive: number) =>
  n * aov * Math.max(0, pActive - p0);

/** VIPs: N × AOV × (p₀_VIP − p₀_Slipping): what you'd lose if they lapsed to slipping-away behaviour. */
export const vipAtRiskIfLapsed = (n: number, aov: number, p0Vip: number, p0Slipping: number) =>
  n * aov * Math.max(0, p0Vip - p0Slipping);

// ---------- Whole plan ----------

export interface PlanRow {
  id: SegmentId;
  aov: number;
  p0: number;
  rec: Recommendation;
}

export interface PlanSummary {
  emailedCustomers: number;
  groupsEmailed: number;
  groupsSkipped: number;
  extraProfit: number;
  /**
   * The single uplift that, if every emailed group hit it, gives the plan's assumed profit
   * (revenue-weighted average of the assumed uplifts).
   */
  assumedUplift: number;
  /** The single uplift at which the whole plan breaks even. */
  breakEvenUplift: number;
}

/**
 * Plan profit if every emailed group's uplift were `u`:
 * Σ emailed × AOV × [u × (m − d) − p₀ × d]. Lets the summary's uplift be edited inline.
 */
export function planProfitAtUplift(rows: PlanRow[], margin: number, u: number): number {
  let total = 0;
  for (const r of rows) {
    if (r.rec.action === 'no-email') continue;
    const d = r.rec.discount;
    const uu = Math.min(u, 1 - r.p0);
    total += r.rec.emailed * r.aov * (uu * (margin - d) - r.p0 * d);
  }
  return total;
}

export function planSummary(rows: PlanRow[], margin: number): PlanSummary {
  let emailedCustomers = 0;
  let groupsEmailed = 0;
  let groupsSkipped = 0;
  let extraProfit = 0;
  let weight = 0;
  let upliftWeighted = 0;
  let costWeighted = 0;
  for (const r of rows) {
    if (r.rec.emailed === 0 && r.rec.action === 'no-email') continue; // empty group
    if (r.rec.action === 'no-email') {
      groupsSkipped++;
      continue;
    }
    groupsEmailed++;
    emailedCustomers += r.rec.emailed;
    extraProfit += r.rec.extraProfit;
    const w = r.rec.emailed * r.aov * (margin - r.rec.discount);
    weight += w;
    upliftWeighted += w * r.rec.assumedUplift;
    costWeighted += r.rec.emailed * r.aov * r.p0 * r.rec.discount;
  }
  return {
    emailedCustomers,
    groupsEmailed,
    groupsSkipped,
    extraProfit,
    assumedUplift: weight ? upliftWeighted / weight : 0,
    breakEvenUplift: weight ? costWeighted / weight : 0,
  };
}
