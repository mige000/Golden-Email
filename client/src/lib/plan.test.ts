import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyP0Overrides, backtest } from './backtest';
import { clean } from './clean';
import { parseCsv } from './csv';
import { buildCustomers, dataRange, typicalGap } from './customers';
import { guessMapping } from './mapping';
import type { Recommendation } from './economics';
import { breakEvenSentence, buildPlan, curveTitle, explainOffer, offerHeadline, upliftForTarget, type PlanSegment } from './plan';
import { segmentCustomers, segmentStats, thresholds } from './segments';
import { defaultSettings } from './settings';

describe('buildPlan (end to end on the online-store sample)', () => {
  const table = parseCsv(readFileSync(join(import.meta.dirname, '../../public/samples/online-store.csv'), 'utf8'));
  const { transactions } = clean(table, guessMapping(table));
  const s = defaultSettings();
  const today = dataRange(transactions)!.end;
  const { customers } = buildCustomers(transactions, today);
  const th = thresholds(s, typicalGap(customers));
  const stats = segmentStats(customers, segmentCustomers(customers, th, s));
  const bt = backtest(transactions, today, th, { ...s, p0Overrides: {} });
  const plan = buildPlan(customers, stats, bt, s);

  it('covers every customer exactly once, split into emailed + holdout', () => {
    const total = plan.segments.reduce((n, x) => n + x.split.emailed.length + x.split.holdout.length, 0);
    expect(total).toBe(customers.length);
    for (const x of plan.segments) expect(x.split.holdout.length).toBe(Math.round(x.stats.count * 0.1));
  });

  it('sorts non-empty groups by money at stake', () => {
    const stakes = plan.segments.filter((x) => x.stats.count > 0).map((x) => Math.max(x.revenueAtStake, x.atRiskIfLapsed ?? 0));
    expect(stakes).toEqual([...stakes].sort((a, b) => b - a));
  });

  it('gives VIPs an at-risk figure and no discount', () => {
    const vip = plan.segments.find((x) => x.id === 'vip')!;
    expect(vip.atRiskIfLapsed).toBeGreaterThan(0);
    expect(vip.rec.discount).toBe(0);
  });

  it('summary profit equals the sum of group profits', () => {
    const sum = plan.segments.reduce((n, x) => n + x.rec.extraProfit, 0);
    expect(plan.summary.extraProfit).toBeCloseTo(sum);
  });

  it('scales the uplift assumptions so the re-run plan averages the target uplift', () => {
    for (const target of [0.01, 0.06]) {
      const u = upliftForTarget(plan, s.margin, s.uplift, target, s.upliftMultipliers);
      expect(u.uRef / u.u0).toBeCloseTo(s.uplift.uRef / s.uplift.u0); // same curve shape
      const rerun = buildPlan(customers, stats, bt, { ...s, uplift: u });
      expect(rerun.summary.assumedUplift).toBeCloseTo(target, 4);
    }
    // A much higher uplift makes bigger discounts worth it for at least one group.
    const high = buildPlan(customers, stats, bt, { ...s, uplift: upliftForTarget(plan, s.margin, s.uplift, 0.06, s.upliftMultipliers) });
    const discounts = (p: typeof plan) => p.segments.reduce((n, x) => n + x.rec.discount, 0);
    expect(discounts(high)).toBeGreaterThan(discounts(plan));
    expect(upliftForTarget(plan, s.margin, s.uplift, 0)).toMatchObject({ u0: 0, uRef: 0 });
  });

  it('lands on the closer side when an offer flip makes the target unreachable', () => {
    // Sweep targets; wherever the re-run plan misses, nothing between the two sides of the jump is reachable.
    for (let t = 0.005; t <= 0.08; t += 0.0025) {
      const got = buildPlan(customers, stats, bt, { ...s, uplift: upliftForTarget(plan, s.margin, s.uplift, t, s.upliftMultipliers) }).summary.assumedUplift;
      expect(Math.abs(got - t)).toBeLessThan(0.006);
    }
  });

  it('gives lapsed VIPs a stronger offer response, and a bigger discount than with no multiplier', () => {
    const lostVip = plan.segments.find((x) => x.id === 'lostVip')!;
    expect(lostVip.stats.count).toBeGreaterThan(0);
    // Only the discount-driven part of the uplift is doubled; a plain email's effect is unchanged.
    expect(lostVip.offer.assumptions.u0).toBeCloseTo(s.uplift.u0);
    expect(lostVip.offer.assumptions.uRef).toBeCloseTo(s.uplift.u0 + 2 * (s.uplift.uRef - s.uplift.u0));
    const flat = buildPlan(customers, stats, bt, { ...s, upliftMultipliers: {} }).segments.find((x) => x.id === 'lostVip')!;
    expect(lostVip.rec.discount).toBeGreaterThan(flat.rec.discount);
  });

  it('applies p₀ overrides without re-running the backtest', () => {
    const o = applyP0Overrides(bt, { lost: 0.2 });
    expect(o.bySegment.lost).toMatchObject({ p0: 0.2, source: 'user' });
    expect(o.bySegment.lost.measuredP0).toBe(bt.bySegment.lost.measuredP0);
    const lost = buildPlan(customers, stats, o, s).segments.find((x) => x.id === 'lost')!;
    expect(lost.rec.discount).toBeLessThan(plan.segments.find((x) => x.id === 'lost')!.rec.discount);
  });
});

describe('explanations', () => {
  const rec = (over: Partial<Recommendation>): Recommendation => ({
    action: 'email-discount', discount: 0.1, maxProfitableDiscount: 0.2275, breakEvenUplift: 0.0175,
    assumedUplift: 0.03, perRecipient: 1, extraProfit: 100, emailed: 100, ...over,
  });

  it('headlines the offer', () => {
    expect(offerHeadline(rec({}))).toBe('Email · 10% off');
    expect(offerHeadline(rec({ action: 'email-no-discount', discount: 0 }))).toBe('Email · no discount');
    expect(offerHeadline(rec({ action: 'no-email' }))).toBe('Don’t email');
  });

  it('states break-even in plain words', () => {
    expect(breakEvenSentence(rec({}))).toBe('This 10% offer pays off if at least 1.8% of recipients buy who wouldn’t have otherwise.');
    expect(breakEvenSentence(rec({ action: 'no-email' }))).toBeNull();
  });

  it('titles the curve with the takeaway, rounding the money-making limit down', () => {
    expect(curveTitle(rec({}))).toBe('Best offer: 10% off. Above 22% off, this email loses money.');
    expect(curveTitle(rec({ action: 'email-no-discount', discount: 0, maxProfitableDiscount: 0.004 }))).toBe('Best offer: no discount. Any discount loses money.');
  });

  it('explains why a high-baseline group gets no discount', () => {
    const x = { p0: { p0: 0.34 }, rec: rec({ action: 'email-no-discount', discount: 0 }) } as PlanSegment;
    expect(explainOffer(x, 30)).toMatch(/^No discount: 34% of them buy within 30 days anyway/);
  });
});
