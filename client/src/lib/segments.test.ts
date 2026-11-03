import { describe, expect, it } from 'vitest';
import type { RepeatRate } from './customers';
import {
  customerReason,
  secondTimerEvidence,
  segmentCustomers,
  segmentOf,
  segmentRule,
  segmentStats,
  thresholds,
  vipSpendCutoff,
} from './segments';
import type { Customer, Thresholds, TypicalGap } from './types';

const gap: TypicalGap = { days: 30, basis: 500, repeatShare: 0.4, historyDays: 700, confidence: 'high', source: 'measured' };
const t: Thresholds = thresholds({ missingDaysOverride: null, lostDaysOverride: null }, gap);
const s = { vipPercent: 10, regularsMinOrders: 3 };

function customer(id: string, orders: number, recency: number, totalSpend = 50 * orders): Customer {
  const today = 1000;
  const lastDay = today - recency;
  const orderDays = Array.from({ length: orders }, (_, i) => lastDay - (orders - 1 - i) * 30);
  return { id, orderDays, firstDay: orderDays[0]!, lastDay, recency, orders, totalSpend, aov: totalSpend / orders };
}

describe('thresholds', () => {
  it('derives missing = 2 × gap and lost = 3 × missing', () => {
    expect(t.missingDays).toEqual({ value: 60, source: 'measured' });
    expect(t.lostDays).toEqual({ value: 180, source: 'measured' });
  });
  it('respects overrides, a user-set gap, and keeps lost above missing', () => {
    const u = thresholds({ missingDaysOverride: 45, lostDaysOverride: 40 }, { ...gap, source: 'user' });
    expect(u.missingDays).toEqual({ value: 45, source: 'user' });
    expect(u.lostDays.value).toBe(46);
    expect(thresholds({ missingDaysOverride: null, lostDaysOverride: null }, { ...gap, source: 'user' }).missingDays.source).toBe('user');
  });
});

describe('segmentOf rule boundaries (missing = 60, lost = 180)', () => {
  const seg = (c: Customer, cutoff = Infinity) => segmentOf(c, t, s, cutoff);

  it('active groups', () => {
    expect(seg(customer('a', 5, 60))).toBe('regular'); // recency == missing is still active
    expect(seg(customer('a', 3, 10))).toBe('regular');
    expect(seg(customer('a', 2, 10))).toBe('secondTimer');
    expect(seg(customer('a', 1, 10))).toBe('new');
  });

  it('VIPs must be top spenders AND active', () => {
    expect(seg(customer('v', 1, 10, 900), 500)).toBe('vip');
    expect(seg(customer('v', 4, 61, 900), 500)).toBe('slipping');
    expect(seg(customer('v', 4, 181, 900), 500)).toBe('lost');
  });

  it('inactive groups', () => {
    expect(seg(customer('a', 2, 61))).toBe('slipping');
    expect(seg(customer('a', 1, 61))).toBe('oneAndDone');
    expect(seg(customer('a', 1, 180))).toBe('oneAndDone'); // recency == lost is not yet lost
    expect(seg(customer('a', 1, 181))).toBe('lost');
    expect(seg(customer('a', 9, 181))).toBe('lost');
  });

  it('moving the Regulars cutoff shifts Second-timers', () => {
    const c3 = customer('a', 3, 10);
    expect(segmentOf(c3, t, { ...s, regularsMinOrders: 3 }, Infinity)).toBe('regular');
    expect(segmentOf(c3, t, { ...s, regularsMinOrders: 4 }, Infinity)).toBe('secondTimer');
    expect(segmentOf(customer('a', 2, 10), t, { ...s, regularsMinOrders: 4 }, Infinity)).toBe('secondTimer');
  });
});

describe('vipSpendCutoff', () => {
  it('takes the top X% of all customers by spend', () => {
    const cs = Array.from({ length: 20 }, (_, i) => customer(`c${i}`, 1, 500, (i + 1) * 10));
    expect(vipSpendCutoff(cs, 10)).toBe(190); // top 2 of 20
    expect(vipSpendCutoff(cs, 0)).toBe(Infinity);
    expect(vipSpendCutoff([customer('z', 1, 1, 0)], 10)).toBe(Infinity);
  });
});

describe('segmentCustomers + segmentStats', () => {
  it('assigns everyone and summarises each group', () => {
    const cs = [customer('a', 5, 10, 1000), customer('b', 3, 10), customer('c', 2, 10), customer('d', 1, 10), customer('e', 4, 100), customer('f', 1, 100), customer('g', 1, 400)];
    const seg = segmentCustomers(cs, t, s);
    expect(seg.assignments).toEqual(['vip', 'regular', 'secondTimer', 'new', 'slipping', 'oneAndDone', 'lost']);
    const stats = segmentStats(cs, seg);
    expect(stats.vip).toMatchObject({ count: 1, totalSpend: 1000, aov: 200, avgOrders: 5 });
    expect(stats.slipping.medianRecency).toBe(100);
    expect(Object.values(stats).reduce((n, x) => n + x.count, 0)).toBe(cs.length);
  });
});

describe('reasons', () => {
  const ctx = { gap, thresholds: t, settings: s };
  it('explains a customer in plain words', () => {
    expect(customerReason(customer('a', 5, 94), 'slipping', ctx)).toBe(
      "Bought 5 times, but hasn't purchased in 94 days. Your customers usually come back every 30 days.",
    );
    expect(customerReason(customer('a', 2, 5), 'secondTimer', ctx)).toBe('Came back for purchase #2 5 days ago.');
  });
  it('describes the rules, including a moved Regulars cutoff', () => {
    expect(segmentRule('secondTimer', ctx)).toMatch(/exactly 2 orders/);
    expect(segmentRule('secondTimer', { ...ctx, settings: { ...s, regularsMinOrders: 5 } })).toMatch(/2 to 4 orders/);
    expect(segmentRule('lost', ctx)).toBe("Haven't bought in more than 180 days.");
  });

  const rates = (r1: number, r2: number, n = 100): RepeatRate[] => [
    { orders: 1, eligible: n, repeated: Math.round(r1 * n), rate: r1 },
    { orders: 2, eligible: n, repeated: Math.round(r2 * n), rate: r2 },
  ];
  it('checks the Second-timers claim against the data', () => {
    expect(secondTimerEvidence(rates(0.18, 0.41), 60)).toMatch(/buy again 41% .* vs\. 18% after 1 order/);
    expect(secondTimerEvidence(rates(0.3, 0.32), 60)).toMatch(/aren’t much more likely/);
    expect(secondTimerEvidence(rates(0.18, 0.41, 10), 60)).toMatch(/isn’t enough history/);
  });
});
