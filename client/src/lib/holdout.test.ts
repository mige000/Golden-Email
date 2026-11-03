import { describe, expect, it } from 'vitest';
import { customerRows, exportFilename, segmentCsv, toCsv } from './export';
import { splitHoldout } from './holdout';
import type { Customer } from './types';

const ids = Array.from({ length: 1000 }, (_, i) => `C${i}`);
const members = ids.map((_, i) => i);
const idOf = (i: number) => ids[i]!;

describe('splitHoldout', () => {
  it('holds out exactly the requested share', () => {
    const s = splitHoldout(members, idOf, 10, 42);
    expect(s.holdout).toHaveLength(100);
    expect(s.emailed).toHaveLength(900);
    expect(splitHoldout(members.slice(0, 7), idOf, 10, 42).holdout).toHaveLength(1);
    expect(splitHoldout(members, idOf, 0, 42).holdout).toEqual([]);
  });

  it('is stable across calls and independent of row order', () => {
    const a = splitHoldout(members, idOf, 20, 42).holdout.map(idOf).sort();
    const b = splitHoldout([...members].reverse(), idOf, 20, 42).holdout.map(idOf).sort();
    expect(a).toEqual(b);
  });

  it('changes with the seed, and a bigger holdout keeps the smaller one', () => {
    const a = new Set(splitHoldout(members, idOf, 10, 1).holdout);
    const b = new Set(splitHoldout(members, idOf, 10, 2).holdout);
    expect([...a].filter((i) => b.has(i)).length).toBeLessThan(50);
    const bigger = new Set(splitHoldout(members, idOf, 20, 1).holdout);
    expect([...a].every((i) => bigger.has(i))).toBe(true);
  });
});

describe('export', () => {
  const c: Customer = {
    id: 'C1', name: 'Ann, "Annie" Lee', email: 'ann@example.com', orderDays: [0, 30], firstDay: 0, lastDay: 30,
    recency: 12, orders: 2, totalSpend: 99.5, aov: 49.75,
  };

  it('writes one row per customer with the offer and reason', () => {
    const [row] = customerRows([c], { segmentLabel: 'Slipping away', group: 'email', discount: 0.1, reason: () => 'because' });
    expect(row).toEqual(['C1', 'Ann, "Annie" Lee', 'ann@example.com', 'Slipping away', 'email', 2, '99.50', '1970-01-31', 12, '10% off', 'because']);
    const [held] = customerRows([c], { segmentLabel: 'VIPs', group: 'holdout', discount: null, reason: () => '' });
    expect(held![9]).toBe('Do not email (holdout)');
  });

  it('quotes commas/quotes and defuses spreadsheet formulas', () => {
    expect(toCsv(['a', 'b'], [['x, "y"', '=HYPERLINK("evil")']])).toBe('a,b\n"x, ""y""","\'=HYPERLINK(""evil"")"\n');
    expect(toCsv(['n'], [[-5]])).toBe('n\n-5\n');
    expect(segmentCsv([c], { segmentLabel: 'VIPs', group: 'email', discount: null, reason: () => 'r' }).split('\n')[0]).toMatch(/^customer_id,name,email/);
  });

  it('names files after the segment, list and date', () => {
    expect(exportFilename('Slipping away', 'holdout', 30)).toBe('slipping-away-holdout-1970-01-31.csv');
  });
});
