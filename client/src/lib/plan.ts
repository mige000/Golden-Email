import type { BacktestResult, SegmentP0 } from './backtest';
import {
  boostDiscountResponse,
  expectedRevenueNoEmail,
  planSummary,
  recommend,
  revenueAtStake,
  vipAtRiskIfLapsed,
  type OfferInput,
  type PlanRow,
  type PlanSummary,
  type Recommendation,
} from './economics';
import { pct } from './format';
import { splitHoldout, type HoldoutSplit } from './holdout';
import type { SegmentStats } from './segments';
import { SEGMENT_IDS, type Customer, type SegmentId, type Settings, type UpliftAssumptions } from './types';

export interface PlanSegment {
  id: SegmentId;
  stats: SegmentStats;
  p0: SegmentP0;
  offer: OfferInput;
  split: HoldoutSplit;
  rec: Recommendation;
  /** W-day spend the group makes anyway. */
  expectedRevenue: number;
  /** Extra W-day spend if the group bought like active regulars. */
  revenueAtStake: number;
  /** VIPs only: W-day spend lost if they lapsed to slipping-away behaviour. */
  atRiskIfLapsed: number | null;
}

export interface Plan {
  /** Non-empty groups sorted by money at stake, then empty groups. */
  segments: PlanSegment[];
  summary: PlanSummary;
  rows: PlanRow[];
}

export type PlanSettings = Pick<Settings, 'margin' | 'uplift' | 'upliftMultipliers' | 'holdoutPercent' | 'seed'>;

/** How strongly a group responds to a discount relative to the base assumption (1 = the same). */
export const multiplierFor = (m: Settings['upliftMultipliers'], id: SegmentId) => m[id] ?? 1;

/** The decision for each group: who's emailed, which offer, and what's at stake. */
export function buildPlan(
  customers: Customer[],
  stats: Record<SegmentId, SegmentStats>,
  bt: BacktestResult,
  s: PlanSettings,
): Plan {
  const segments = SEGMENT_IDS.map((id): PlanSegment => {
    const st = stats[id];
    const p0 = bt.bySegment[id];
    const assumptions = boostDiscountResponse(s.uplift, multiplierFor(s.upliftMultipliers, id));
    const offer: OfferInput = { p0: p0.p0, aov: st.aov, margin: s.margin, assumptions };
    const split = splitHoldout(st.members, (i) => customers[i]!.id, s.holdoutPercent, s.seed);
    return {
      id,
      stats: st,
      p0,
      offer,
      split,
      rec: recommend(offer, split.emailed.length),
      expectedRevenue: expectedRevenueNoEmail(st.count, st.aov, p0.p0),
      revenueAtStake: revenueAtStake(st.count, st.aov, p0.p0, bt.pActive.value),
      atRiskIfLapsed: id === 'vip' ? vipAtRiskIfLapsed(st.count, st.aov, p0.p0, bt.bySegment.slipping.p0) : null,
    };
  });
  const stake = (x: PlanSegment) => Math.max(x.revenueAtStake, x.atRiskIfLapsed ?? 0);
  segments.sort((a, b) => Number(b.stats.count > 0) - Number(a.stats.count > 0) || stake(b) - stake(a));
  const rows = segments.map((x) => ({ id: x.id, aov: x.stats.aov, p0: x.p0.p0, rec: x.rec }));
  return { segments, rows, summary: planSummary(rows, s.margin) };
}

// ---------- Plain-English explanations ----------

const wholePct = (x: number) => `${Math.round(x * 100)}%`;
/** Round a "still makes money" discount DOWN, so we never overstate it. */
const floorPct = (x: number) => `${Math.floor(x * 100 + 1e-9)}%`;

/** "Email · 10% off" / "Email · no discount" / "Don't email". */
export function offerHeadline(rec: Recommendation): string {
  if (rec.action === 'no-email') return 'Don’t email';
  return rec.action === 'email-discount' ? `Email · ${wholePct(rec.discount)} off` : 'Email · no discount';
}

/** Lapsed high-value groups: assumed to respond more strongly to an offer. */
const RESPONSIVE = new Set<SegmentId>(['lostVip', 'slippingVip', 'lostRegular']);

/** Why this offer, in one or two sentences. */
export function explainOffer(x: PlanSegment, windowDays: number): string {
  const p = pct(x.p0.p0);
  const within = `within ${windowDays} days`;
  switch (x.rec.action) {
    case 'no-email':
      return 'Under your current assumptions, emailing this group brings in nothing extra.';
    case 'email-no-discount':
      return x.p0.p0 >= 0.1 && !RESPONSIVE.has(x.id)
        ? `No discount: ${p} of them buy ${within} anyway, so a discount would mostly go to people who’d pay full price. A plain email still nudges a few more.`
        : `No discount: the extra buyers a discount would win don’t cover the cost of discounting everyone who uses it. A plain email still nudges a few more.`;
    case 'email-discount':
      if (RESPONSIVE.has(x.id)) {
        return `They used to spend a lot with you, so an offer is more likely to win them back than it is for other lapsed customers. Only ${p} buy ${within} on their own, so a ${wholePct(x.rec.discount)} offer mostly goes to people it brings back.`;
      }
      return `Only ${p} of them buy ${within} on their own, so a ${wholePct(x.rec.discount)} offer costs little on purchases you’d get anyway, and can win back a few more.`;
  }
}

/** The break-even line: the most trustworthy number on the card (no assumptions in it). */
export function breakEvenSentence(rec: Recommendation): string | null {
  if (rec.action === 'no-email') return null;
  if (rec.action === 'email-no-discount') return 'With no discount there’s nothing to pay back: every extra purchase is profit.';
  return `This ${wholePct(rec.discount)} offer pays off if at least ${pct(rec.breakEvenUplift, 1)} of recipients buy who wouldn’t have otherwise.`;
}

/** Chart title that states the takeaway. */
export function curveTitle(rec: Recommendation): string {
  const max = rec.maxProfitableDiscount;
  if (rec.action === 'no-email') return 'Under your current assumptions, this email doesn’t pay at any discount.';
  const best = rec.action === 'email-discount' ? `Best offer: ${wholePct(rec.discount)} off.` : 'Best offer: no discount.';
  if (max === null || max < 0.01) return `${best} Any discount loses money.`;
  return `${best} Above ${floorPct(max)} off, this email loses money.`;
}

// ---------- Applying a headline uplift to the assumptions ----------

/** Plan-level assumed uplift if the base uplift curve were `assumptions` (group multipliers kept). */
function blendedUplift(plan: Plan, margin: number, assumptions: UpliftAssumptions, multipliers: Settings['upliftMultipliers']): number {
  const rows = plan.segments.map((x) => ({
    id: x.id,
    aov: x.stats.aov,
    p0: x.p0.p0,
    rec: recommend(
      { ...x.offer, margin, assumptions: boostDiscountResponse(assumptions, multiplierFor(multipliers, x.id)) },
      x.split.emailed.length,
    ),
  }));
  return planSummary(rows, margin).assumedUplift;
}

/**
 * Scale the uplift assumptions (u₀ and u_ref together, keeping the curve's shape) so the re-run plan
 * averages `target` uplift. Offers change as the scale changes, so the scale is found by bisection
 * on the re-run plan rather than by a single division. Where an offer flips (e.g. "no discount" →
 * "5% off") the plan's average jumps, so the exact target may be unreachable: we return whichever
 * side of the jump is closer.
 */
export function upliftForTarget(
  plan: Plan,
  margin: number,
  base: UpliftAssumptions,
  target: number,
  multipliers: Settings['upliftMultipliers'] = {},
): UpliftAssumptions {
  if (target <= 0) return { ...base, u0: 0, uRef: 0 };
  if (base.u0 <= 0 && base.uRef <= 0) return { ...base, u0: target, uRef: target };
  const scaled = (k: number): UpliftAssumptions => ({ ...base, u0: base.u0 * k, uRef: base.uRef * k });
  let lo = 0;
  let hi = 1;
  while (blendedUplift(plan, margin, scaled(hi), multipliers) < target && hi < 1e4) hi *= 2;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (blendedUplift(plan, margin, scaled(mid), multipliers) < target) lo = mid;
    else hi = mid;
  }
  const below = Math.abs(blendedUplift(plan, margin, scaled(lo), multipliers) - target);
  const above = Math.abs(blendedUplift(plan, margin, scaled(hi), multipliers) - target);
  return scaled(below < above ? lo : hi);
}
