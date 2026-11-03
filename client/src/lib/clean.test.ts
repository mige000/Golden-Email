import { describe, expect, it } from 'vitest';
import { clean, dayFromYmd, dayToIso, detectDateOrder, parseAmount, parseDate } from './clean';
import { guessMapping, setField } from './mapping';
import type { RawTable } from './types';

const iso = (raw: string, order: Parameters<typeof parseDate>[1] = 'mdy') => {
  const d = parseDate(raw, order);
  return d === null ? null : dayToIso(d);
};

describe('parseAmount', () => {
  it.each([
    ['12.50', 12.5],
    ['$1,234.56', 1234.56],
    ['€1.234,56', 1234.56],
    ['€7,32', 7.32],
    ['1,234', 1234],
    ['1.234.567', 1234567],
    ['(12.50)', -12.5],
    ['-$5', -5],
    ['5-', -5],
    ['USD 40', 40],
    ['£ 1 200,00', 1200],
    ['0', 0],
  ])('%s → %d', (raw, expected) => {
    expect(parseAmount(raw)).toBeCloseTo(expected);
  });

  it.each(['', 'n/a', 'abc', '12 apples', '1/2/2024'])('rejects %j', (raw) => {
    expect(parseAmount(raw)).toBeNull();
  });
});

describe('parseDate', () => {
  it('reads ISO, compact and text formats regardless of order', () => {
    expect(iso('2024-03-04', 'dmy')).toBe('2024-03-04');
    expect(iso('2024-03-04T10:15:00Z')).toBe('2024-03-04');
    expect(iso('19970101')).toBe('1997-01-01');
    expect(iso('Mar 4, 2025')).toBe('2025-03-04');
    expect(iso('4 March 2025')).toBe('2025-03-04');
    expect(iso('Tue, 4 Mar 2025')).toBe('2025-03-04');
    expect(iso('4-Sept-2025')).toBe('2025-09-04');
  });

  it('uses the order for numeric dates', () => {
    expect(iso('03/04/2024', 'mdy')).toBe('2024-03-04');
    expect(iso('03/04/2024', 'dmy')).toBe('2024-04-03');
    expect(iso('03.04.24', 'dmy')).toBe('2024-04-03');
    expect(iso('3/4/2024 1:22 PM', 'mdy')).toBe('2024-03-04');
  });

  it('rejects impossible dates and non-dates', () => {
    expect(iso('2024-02-30')).toBeNull();
    expect(iso('13/13/2024', 'mdy')).toBeNull();
    expect(iso('12.50')).toBeNull();
    expect(iso('hello')).toBeNull();
    expect(dayFromYmd(1850, 1, 1)).toBeNull();
  });
});

describe('detectDateOrder', () => {
  it('is day-first when a first part is over 12', () => {
    expect(detectDateOrder(['03/04/2024', '25/04/2024'])).toMatchObject({ order: 'dmy', ambiguous: false });
  });
  it('is month-first when a second part is over 12', () => {
    expect(detectDateOrder(['03/04/2024', '04/25/2024'])).toMatchObject({ order: 'mdy', ambiguous: false });
  });
  it('defaults to month-first and flags it when nothing settles it', () => {
    expect(detectDateOrder(['03/04/2024', '01/02/2024'])).toMatchObject({ order: 'mdy', ambiguous: true });
  });
  it('ignores ISO values', () => {
    expect(detectDateOrder(['2024-12-25', '25/12/2024'])).toMatchObject({ order: 'dmy', numericCount: 1 });
    expect(detectDateOrder(['2024-12-25'])).toMatchObject({ order: 'ymd', ambiguous: false });
  });
});

const table = (headers: string[], rows: string[][]): RawTable => ({ headers, rows });

describe('clean', () => {
  it('collapses line items by order number and computes qty × unit price', () => {
    const t = table(
      ['Customer', 'Date', 'Order', 'Qty', 'Unit Price', 'Total'],
      [
        ['a1', '2024-01-05', 'O1', '2', '5.00', ''],
        [' A1 ', '2024-01-05', 'O1', '1', '3.00', '3.00'],
        ['A1', '2024-01-05', 'O2', '1', '4.00', '4.00'],
        ['B2', '2024-01-06', 'O3', '1', '9.99', '$9.99'],
      ],
    );
    const { transactions, report } = clean(t, guessMapping(t));
    expect(transactions.map((x) => [x.customerId, x.orderId, x.amount])).toEqual([
      ['A1', 'O1', 13],
      ['A1', 'O2', 4],
      ['B2', 'O3', 9.99],
    ]);
    expect(report.lineItemsCollapsed).toBe(1);
    expect(report.notes.join(' ')).toMatch(/quantity × unit price/);
  });

  it('merges same customer + same day rows when there is no order number', () => {
    const t = table(
      ['users_id', 'date', 'amt'],
      [
        ['1', '1997-01-12', '12'],
        ['1', '1997-01-12', '77'],
        ['1', '1997-02-01', '0'],
        ['2', '1997-01-12', '5'],
      ],
    );
    const { transactions, report } = clean(t, guessMapping(t));
    expect(transactions.map((x) => [x.customerId, dayToIso(x.day), x.amount])).toEqual([
      ['1', '1997-01-12', 89],
      ['2', '1997-01-12', 5],
      ['1', '1997-02-01', 0],
    ]);
    expect(report.notes.join(' ')).toMatch(/Combined 2 rows .* into 1 order/);
    expect(report.notes.join(' ')).toMatch(/1 purchase had a \$0 amount/);
  });

  it('keeps refunds for known customers, drops orphan refunds and bad rows, and reports why', () => {
    const t = table(
      ['Customer', 'Date', 'Amount'],
      [
        ['A', '2024-01-05', '20'],
        ['A', '2024-01-09', '(5.00)'],
        ['Z', '2024-01-09', '-3'],
        ['', '2024-01-09', '3'],
        ['B', 'someday', '3'],
        ['C', '2024-01-09', ''],
        ['', '', ''],
      ],
    );
    const { transactions, report } = clean(t, guessMapping(t));
    expect(transactions.map((x) => [x.customerId, x.amount])).toEqual([
      ['A', 20],
      ['A', -5],
    ]);
    expect(report.refunds).toBe(1);
    expect(report.orphanRefunds).toBe(1);
    expect(report.rowsKept).toBe(2);
    expect(Object.fromEntries(report.dropped.map((d) => [d.reason, d.count]))).toEqual({
      'no customer': 1,
      'a missing or unreadable date': 1,
      'no amount': 1,
      'a refund for a customer with no purchases': 1,
    });
    expect(report.notes).toContain('Skipped 1 blank row.');
  });

  it('flags ambiguous dates and re-runs when the user remaps a column', () => {
    const t = table(
      ['Customer', 'Date', 'Shipped', 'Amount'],
      [
        ['A', '03/04/2024', '25/04/2024', '10'],
        ['B', '01/02/2024', '13/02/2024', '10'],
      ],
    );
    const m = guessMapping(t);
    expect(m.order_date.column).toBe(1);
    const first = clean(t, m);
    expect(first.report.dateOrderAmbiguous).toBe(true);
    expect(first.report.warnings.join(' ')).toMatch(/could mean/);

    const second = clean(t, setField(m, 'order_date', 2));
    expect(second.report.dateOrder).toBe('dmy');
    expect(second.report.dateOrderAmbiguous).toBe(false);
    expect(dayToIso(second.transactions[0]!.day)).toBe('2024-02-13');
  });

  it('matches customers by email when there is no ID, and warns', () => {
    const t = table(
      ['Email', 'Date', 'Total'],
      [
        ['Ann@Example.com', '2024-01-01', '5'],
        ['ann@example.com ', '2024-02-01', '5'],
      ],
    );
    const { transactions, report } = clean(t, guessMapping(t));
    expect(new Set(transactions.map((x) => x.customerId))).toEqual(new Set(['ann@example.com']));
    expect(report.customerKey).toBe('email');
    expect(report.warnings.join(' ')).toMatch(/matched by email/);
  });
});
