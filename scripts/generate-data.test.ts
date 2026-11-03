import { describe, expect, it } from 'vitest';
import { BUSINESSES, messyCsv, onlineStoreCsv, simulate } from './generate-data';

describe('generate-data', () => {
  it('is deterministic for a given seed', () => {
    expect(onlineStoreCsv(1, 200)).toBe(onlineStoreCsv(1, 200));
    expect(messyCsv(4)).toBe(messyCsv(4));
    expect(onlineStoreCsv(1, 200)).not.toBe(onlineStoreCsv(2, 200));
  });

  it('builds in a repeat-rate jump from 1 → 2 orders', () => {
    const { customers, orders } = simulate(BUSINESSES.onlineStore, 1);
    const counts = new Array(customers.length).fill(0);
    for (const o of orders) counts[o.customer]++;
    const reached = (k: number) => counts.filter((n) => n >= k).length;
    const after1 = reached(2) / reached(1);
    const after2 = reached(3) / reached(2);
    expect(after2).toBeGreaterThan(after1 + 0.1);
  });

  it('keeps travel repeats sparse (triggers the low-confidence gap prompt)', () => {
    const { customers, orders } = simulate(BUSINESSES.travel, 3);
    const counts = new Array(customers.length).fill(0);
    for (const o of orders) counts[o.customer]++;
    const repeatShare = counts.filter((n) => n >= 2).length / customers.length;
    expect(repeatShare).toBeLessThan(0.15);
  });
});
