import { describe, expect, it } from 'vitest';
import { backtest, backtestCutoffs, FALLBACK_P0 } from './backtest';
import type { Thresholds, Transaction } from './types';

const tx = (customerId: string, day: number): Transaction => ({ customerId, day, amount: 10 });
const th: Thresholds = { missingDays: { value: 60, source: 'measured' }, lostDays: { value: 180, source: 'measured' } };
const settings = { vipPercent: 0, regularsMinOrders: 3, windowDays: 30, p0Overrides: {} };

/**
 * today = 200, W = 30 → cutoffs 170, 140, 110, 80.
 *  - 40 regulars buy every 10 days → active regulars at every cutoff, always buy again → p₀ = 100%.
 *  - 40 slipping customers bought on days 0 and 5; 20 of them buy again on day 175, i.e. only in
 *    the (170, 200] window → 20 buyers / 160 customer-cutoffs = 12.5%.
 *  - 5 one-time buyers (day 0) never return → too few, so their rate is pooled.
 */
function fixture(): Transaction[] {
  const out: Transaction[] = [];
  for (let i = 0; i < 40; i++) for (let d = 0; d <= 200; d += 10) out.push(tx(`R${i}`, d));
  for (let i = 0; i < 40; i++) {
    out.push(tx(`S${i}`, 0), tx(`S${i}`, 5));
    if (i < 20) out.push(tx(`S${i}`, 175));
  }
  for (let i = 0; i < 5; i++) out.push(tx(`O${i}`, 0));
  return out;
}

describe('backtestCutoffs', () => {
  it('steps back W days at a time while earlier data exists, up to 4', () => {
    expect(backtestCutoffs(200, 0, 30)).toEqual([170, 140, 110, 80]);
    expect(backtestCutoffs(200, 120, 30)).toEqual([170, 140]);
    expect(backtestCutoffs(200, 190, 30)).toEqual([]);
  });
});

describe('backtest', () => {
  const r = backtest(fixture(), 200, th, settings);

  it('measures p₀ for each group at past cutoffs', () => {
    expect(r.cutoffs).toEqual([170, 140, 110, 80]);
    expect(r.bySegment.regular).toMatchObject({ p0: 1, n: 160, buyers: 160, confidence: 'high', source: 'measured' });
    expect(r.bySegment.slipping).toMatchObject({ p0: 0.125, n: 160, buyers: 20, source: 'measured' });
    expect(r.bySegment.slipping.perCutoff.map((c) => c.buyers)).toEqual([20, 0, 0, 0]);
  });

  it('uses Regulars for p_active', () => {
    expect(r.pActive).toEqual({ value: 1, source: 'measured', basis: 'regular' });
  });

  it('pools a small group with its neighbours and marks it low confidence', () => {
    const o = r.bySegment.oneAndDone;
    expect(o.n).toBe(20);
    expect(o.confidence).toBe('low');
    expect(o.pooledWith).toEqual(['new', 'slipping']);
    expect(o.p0).toBeCloseTo(20 / 180);
  });

  it('lets the user override p₀ and keeps the measured value for display', () => {
    const u = backtest(fixture(), 200, th, { ...settings, p0Overrides: { slipping: 0.3 } });
    expect(u.bySegment.slipping).toMatchObject({ p0: 0.3, source: 'user', measuredP0: 0.125 });
  });

  it('respects an earlier "today": no data after it is used', () => {
    const early = backtest(fixture(), 170, th, settings);
    expect(early.cutoffs).toEqual([140, 110, 80, 50]);
    expect(early.bySegment.slipping.buyers).toBe(0);
  });

  it('falls back to a labelled assumption when there is no history at all', () => {
    const none = backtest([tx('A', 0), tx('B', 5)], 10, th, settings);
    expect(none.cutoffs).toEqual([]);
    expect(none.bySegment.new).toMatchObject({ p0: FALLBACK_P0, source: 'assumed', confidence: 'low' });
  });
});
