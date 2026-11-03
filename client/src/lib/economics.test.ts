import { describe, expect, it } from 'vitest';
import {
  breakEvenUplift,
  discountSteps,
  expectedRevenueNoEmail,
  extraProfitPerRecipient,
  maxProfitable,
  planProfitAtUplift,
  planSummary,
  profitCurve,
  recommend,
  revenueAtStake,
  uplift,
  vipAtRiskIfLapsed,
  type OfferInput,
  type PlanRow,
} from './economics';

const assumptions = { u0: 0.01, uRef: 0.04, dRef: 0.2 };
const offer = (p0: number, over: Partial<OfferInput> = {}): OfferInput => ({ p0, aov: 50, margin: 0.4, assumptions, ...over });

describe('uplift', () => {
  it('starts at u₀, hits u_ref at d_ref, with diminishing returns', () => {
    expect(uplift(0, assumptions)).toBe(0.01);
    expect(uplift(0.2, assumptions)).toBeCloseTo(0.04);
    expect(uplift(0.05, assumptions) - uplift(0, assumptions)).toBeGreaterThan(uplift(0.1, assumptions) - uplift(0.05, assumptions));
  });
  it('never goes negative', () => {
    expect(uplift(0.4, { u0: 0.01, uRef: -0.05, dRef: 0.2 })).toBe(0);
  });
});

describe('extraProfitPerRecipient', () => {
  it('matches AOV × [(p₀ + u)(m − d) − p₀ m]', () => {
    const u = uplift(0.1, assumptions);
    expect(extraProfitPerRecipient(0.1, offer(0.2))).toBeCloseTo(50 * ((0.2 + u) * 0.3 - 0.2 * 0.4));
  });
  it('loses money when the discount equals the margin', () => {
    expect(extraProfitPerRecipient(0.4, offer(0.1))).toBeLessThan(0);
  });
});

describe('breakEvenUplift', () => {
  it('is 0 when nobody would have bought anyway', () => {
    expect(breakEvenUplift(0.2, 0, 0.4)).toBe(0);
  });
  it('is infinite at d = m', () => {
    expect(breakEvenUplift(0.4, 0.1, 0.4)).toBe(Infinity);
  });
  it('is exactly where extra profit crosses zero', () => {
    const d = 0.1;
    const be = breakEvenUplift(d, 0.2, 0.4);
    const flat = (u: number) => offer(0.2, { assumptions: { u0: u, uRef: u, dRef: 0.2 } });
    expect(extraProfitPerRecipient(d, flat(be))).toBeCloseTo(0, 10);
    expect(extraProfitPerRecipient(d, flat(be + 0.001))).toBeGreaterThan(0);
    expect(extraProfitPerRecipient(d, flat(be - 0.001))).toBeLessThan(0);
  });
});

describe('recommend', () => {
  it('picks no discount when bigger discounts don’t persuade more people (u₀ = u_ref)', () => {
    const r = recommend(offer(0.1, { assumptions: { u0: 0.03, uRef: 0.03, dRef: 0.2 } }), 100);
    expect(r).toMatchObject({ action: 'email-no-discount', discount: 0, breakEvenUplift: 0 });
  });

  it('gives a high-baseline group (VIPs) no discount', () => {
    expect(recommend(offer(0.6), 100).action).toBe('email-no-discount');
  });

  it('gives a low-baseline group a discount, and states its break-even', () => {
    const r = recommend(offer(0.05), 100);
    expect(r.action).toBe('email-discount');
    expect(r.discount).toBeGreaterThan(0);
    expect(r.breakEvenUplift).toBeCloseTo((0.05 * r.discount) / (0.4 - r.discount));
    expect(r.extraProfit).toBeCloseTo(100 * extraProfitPerRecipient(r.discount, offer(0.05)));
    expect(r.maxProfitableDiscount).toBeGreaterThan(r.discount);
  });

  it('says "Don’t email" when extra profit is ≤ 0 everywhere', () => {
    const r = recommend(offer(0.1, { assumptions: { u0: 0, uRef: 0, dRef: 0.2 } }), 100);
    expect(r).toMatchObject({ action: 'no-email', discount: 0, extraProfit: 0, maxProfitableDiscount: null });
  });

  it('only considers 5% steps up to the margin', () => {
    expect(discountSteps(0.4)).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4]);
    expect(discountSteps(0.12)).toEqual([0, 0.05, 0.1]);
  });
});

describe('maxProfitable', () => {
  it('finds the last discount with positive profit', () => {
    const x = offer(0.2);
    const d = maxProfitable(x)!;
    expect(extraProfitPerRecipient(d, x)).toBeGreaterThan(0);
    expect(extraProfitPerRecipient(d + 0.005, x)).toBeLessThanOrEqual(0);
  });
});

describe('profitCurve', () => {
  it('runs 0 → margin with a band that brackets the line', () => {
    const pts = profitCurve(offer(0.1), 200);
    expect(pts[0]!.discount).toBe(0);
    expect(pts.at(-1)!.discount).toBe(0.4);
    expect(pts).toHaveLength(41);
    for (const p of pts) {
      expect(p.low).toBeLessThanOrEqual(p.profit + 1e-9);
      expect(p.high).toBeGreaterThanOrEqual(p.profit - 1e-9);
    }
  });
});

describe('revenue figures', () => {
  it('computes expected revenue, revenue at stake and VIP at-risk', () => {
    expect(expectedRevenueNoEmail(100, 50, 0.1)).toBeCloseTo(500);
    expect(revenueAtStake(100, 50, 0.1, 0.3)).toBeCloseTo(1000);
    expect(revenueAtStake(100, 50, 0.4, 0.3)).toBe(0); // active groups: nothing at stake
    expect(vipAtRiskIfLapsed(10, 200, 0.5, 0.1)).toBeCloseTo(800);
  });
});

describe('planSummary', () => {
  const row = (id: PlanRow['id'], p0: number, emailed: number): PlanRow => ({
    id,
    aov: 50,
    p0,
    rec: recommend(offer(p0), emailed),
  });

  it('adds up the plan, and its blended uplift/break-even agree with the per-group numbers', () => {
    const rows = [row('vip', 0.6, 50), row('slipping', 0.05, 300), row('lost', 0.01, 0)];
    const s = planSummary(rows, 0.4);
    expect(s.groupsEmailed).toBe(2);
    expect(s.emailedCustomers).toBe(350);
    expect(s.extraProfit).toBeCloseTo(rows[0]!.rec.extraProfit + rows[1]!.rec.extraProfit);
    expect(planProfitAtUplift(rows, 0.4, s.assumedUplift)).toBeCloseTo(s.extraProfit);
    expect(planProfitAtUplift(rows, 0.4, s.breakEvenUplift)).toBeCloseTo(0);
  });

  it('counts skipped groups', () => {
    const skip: PlanRow = { id: 'lost', aov: 50, p0: 0.1, rec: recommend(offer(0.1, { assumptions: { u0: 0, uRef: 0, dRef: 0.2 } }), 80) };
    expect(planSummary([skip], 0.4)).toMatchObject({ groupsSkipped: 1, groupsEmailed: 0, extraProfit: 0 });
  });
});
