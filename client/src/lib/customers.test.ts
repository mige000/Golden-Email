import { describe, expect, it } from 'vitest';
import { buildCustomers, dataRange, FALLBACK_GAP_DAYS, repeatRateByOrderCount, resolveToday, typicalGap } from './customers';
import type { Transaction } from './types';

const tx = (customerId: string, day: number, amount = 10): Transaction => ({ customerId, day, amount });

/** n customers who each buy every `gap` days, `orders` times, starting at day 0. */
function regulars(n: number, gap: number, orders: number, prefix = 'R'): Transaction[] {
  const out: Transaction[] = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < orders; k++) out.push(tx(`${prefix}${i}`, k * gap));
  return out;
}

describe('resolveToday', () => {
  const range = { start: 100, end: 500 };
  it('defaults to the latest date in the file', () => {
    expect(resolveToday({ todayOverride: null }, range)).toEqual({ value: 500, source: 'measured' });
  });
  it('accepts a user date, clamped to the data range', () => {
    expect(resolveToday({ todayOverride: 300 }, range)).toEqual({ value: 300, source: 'user' });
    expect(resolveToday({ todayOverride: 9999 }, range).value).toBe(500);
    expect(resolveToday({ todayOverride: 0 }, range).value).toBe(100);
  });
});

describe('buildCustomers', () => {
  const data = [tx('A', 0, 20), tx('A', 10, 30), tx('A', 12, -5), tx('A', 50, 40), tx('B', 5, 15), tx('C', 60, 10)];

  it('computes R, F, M with refunds reducing spend but not orders', () => {
    const { customers, ignoredOrders } = buildCustomers(data, 60);
    const a = customers.find((c) => c.id === 'A')!;
    expect(a).toMatchObject({ orders: 3, firstDay: 0, lastDay: 50, recency: 10, totalSpend: 85 });
    expect(a.aov).toBeCloseTo(85 / 3);
    expect(ignoredOrders).toBe(0);
    expect(dataRange(data)).toEqual({ start: 0, end: 60 });
  });

  it('ignores everything after an earlier "today"', () => {
    const { customers, ignoredOrders } = buildCustomers(data, 11);
    expect(customers.map((c) => c.id).sort()).toEqual(['A', 'B']);
    expect(customers.find((c) => c.id === 'A')).toMatchObject({ orders: 2, recency: 1, totalSpend: 50 });
    expect(ignoredOrders).toBe(2);
  });

  it('never reports negative spend', () => {
    const { customers } = buildCustomers([tx('A', 0, 10), tx('A', 1, -50)], 5);
    expect(customers[0]!.totalSpend).toBe(0);
  });
});

describe('typicalGap', () => {
  it('is the median of per-customer median gaps', () => {
    const data = [...regulars(50, 20, 4, 'S'), ...regulars(70, 40, 3, 'L'), ...regulars(10, 5, 30, 'F')];
    const { customers } = buildCustomers(data, 400);
    const gap = typicalGap(customers);
    expect(gap.days).toBe(40); // pooling every gap would give 20: frequent buyers would dominate
    expect(gap.basis).toBe(130);
    expect(gap.source).toBe('measured');
  });

  it('ignores same-day orders when measuring gaps', () => {
    const { customers } = buildCustomers([tx('A', 0), tx('A', 0), tx('A', 30)], 30);
    expect(typicalGap(customers).days).toBe(30);
  });

  it('is low confidence when repeat customers are scarce', () => {
    const few = buildCustomers(regulars(10, 30, 3), 300).customers;
    expect(typicalGap(few).confidence).toBe('low');

    // 40 repeaters but 400 one-time buyers → under 15% repeat
    const data = [...regulars(40, 30, 3), ...Array.from({ length: 400 }, (_, i) => tx(`O${i}`, i % 300))];
    const g = typicalGap(buildCustomers(data, 300).customers);
    expect(g.repeatShare).toBeLessThan(0.15);
    expect(g.confidence).toBe('low');
  });

  it('is at most medium confidence when history is short compared with the gap', () => {
    const { customers } = buildCustomers(regulars(200, 30, 3), 60);
    expect(typicalGap(customers)).toMatchObject({ days: 30, historyDays: 60, confidence: 'medium' });
  });

  it('falls back when nobody repeats, and a user override wins', () => {
    const once = buildCustomers([tx('A', 0), tx('B', 3)], 10).customers;
    expect(typicalGap(once)).toMatchObject({ days: FALLBACK_GAP_DAYS, confidence: 'low', basis: 0 });
    expect(typicalGap(once, 21)).toMatchObject({ days: 21, source: 'user' });
  });
});

describe('repeatRateByOrderCount', () => {
  it('only counts customers observed for the full horizon', () => {
    const data = [
      tx('A', 0), tx('A', 20), // 1 → 2 within 30
      tx('B', 0), // never returned
      tx('C', 0), tx('C', 50), // returned, but after the horizon
      tx('D', 95), // too recent to judge
    ];
    const { customers } = buildCustomers(data, 100);
    const rates = repeatRateByOrderCount(customers, 100, 30);
    expect(rates[0]).toMatchObject({ orders: 1, eligible: 3, repeated: 1 });
    // A's 2nd order (day 20) and C's 2nd order (day 50) are both ≥ 30 days before today; neither repeats.
    expect(rates[1]).toMatchObject({ orders: 2, eligible: 2, repeated: 0, rate: 0 });
  });

  it('pools 4 or more orders into one bucket', () => {
    const { customers } = buildCustomers(regulars(1, 10, 7), 200);
    const rates = repeatRateByOrderCount(customers, 200, 30);
    expect(rates[3]).toMatchObject({ orders: 4, eligible: 4, repeated: 3 });
  });
});
