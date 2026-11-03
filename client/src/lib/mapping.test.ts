import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clean } from './clean';
import { parseCsv } from './csv';
import { guessMapping, headerScore, normalizeHeader, setField, validateMapping } from './mapping';
import type { Field, Mapping, RawTable } from './types';

const table = (headers: string[], rows: string[][]): RawTable => ({ headers, rows });
const mappedHeaders = (t: RawTable, m: Mapping) =>
  Object.fromEntries(
    Object.entries(m)
      .filter(([, g]) => g.column !== null)
      .map(([f, g]) => [f, t.headers[g.column!]]),
  );

/** n rows where customers repeat, so the ID column looks ID-like. */
function rows(n: number, make: (i: number) => string[]): string[][] {
  return Array.from({ length: n }, (_, i) => make(i));
}

describe('normalizeHeader / headerScore', () => {
  it('normalises punctuation, case and #', () => {
    expect(normalizeHeader(' Cust # ')).toBe('cust no');
    expect(normalizeHeader('Txn_Dt')).toBe('txn dt');
  });
  it('matches synonyms', () => {
    const cases: [Field, string][] = [
      ['customer_id', 'Cust #'],
      ['customer_id', 'users_id'],
      ['customer_id', 'Member #'],
      ['order_date', 'Txn Dt'],
      ['order_date', 'Purchased At'],
      ['amount', 'Grand Total'],
      ['amount', 'amt'],
      ['email', 'E-mail'],
      ['order_id', 'Booking Ref'],
    ];
    for (const [field, h] of cases) expect(headerScore(field, h), `${field} ← ${h}`).toBe(1);
    expect(headerScore('order_date', 'Purchase Date (UTC)')).toBe(0.75);
    expect(headerScore('amount', 'Customer')).toBe(0);
  });
});

describe('guessMapping', () => {
  it('lets content win over a misleading header', () => {
    // "Date" holds free-text notes; "Created" holds the real dates.
    const t = table(
      ['Customer', 'Date', 'Created', 'Total'],
      rows(40, (i) => [`C${i % 12}`, i % 2 ? 'called back' : 'n/a', `2024-01-${String((i % 28) + 1).padStart(2, '0')}`, `${10 + i}.50`]),
    );
    const m = guessMapping(t);
    expect(t.headers[m.order_date.column!]).toBe('Created');
    expect(m.order_date.reason).toMatch(/100% of values are dates/);
  });

  it('tells a repeating customer ID from a unique-per-row order number', () => {
    const t = table(
      ['Ref', 'Account', 'Day', 'Amount'],
      rows(60, (i) => [`R${1000 + i}`, `A${i % 15}`, '2024-05-01', '20']),
    );
    const m = guessMapping(t);
    expect(t.headers[m.customer_id.column!]).toBe('Account');
    expect(t.headers[m.order_id.column!]).toBe('Ref');
  });

  it('falls back to quantity × unit price when there is no amount column', () => {
    const t = table(
      ['Customer', 'Date', 'Qty', 'Unit Price'],
      rows(30, (i) => [`C${i % 5}`, '2024-05-01', `${(i % 3) + 1}`, '4.99']),
    );
    const m = guessMapping(t);
    expect(m.amount.column).toBeNull();
    expect(m.amount.reason).toMatch(/quantity × unit price/);
    expect(validateMapping(m).filter((i) => i.blocking)).toEqual([]);
    expect(clean(t, m).transactions[0]!.amount).toBeGreaterThan(0);
  });

  it('falls back to email, then name, when there is no customer ID', () => {
    const byEmail = guessMapping(
      table(['Email', 'Date', 'Total'], rows(30, (i) => [`p${i % 6}@x.com`, '2024-05-01', '5'])),
    );
    expect(byEmail.customer_id.column).toBeNull();
    expect(byEmail.customer_id.reason).toMatch(/by email/);

    const byName = guessMapping(
      table(['Name', 'Date', 'Total'], rows(30, (i) => [`Ann Lee${'x'.repeat(i % 6)}`, '2024-05-01', '5'])),
    );
    expect(byName.customer_id.reason).toMatch(/by name/);
    expect(validateMapping(byName).find((i) => i.field === 'customer_id')).toMatchObject({ blocking: false });
  });

  it('blocks Continue on missing required fields and duplicate columns', () => {
    const t = table(['Customer', 'Notes'], rows(20, (i) => [`C${i % 4}`, 'hello']));
    const issues = validateMapping(guessMapping(t));
    expect(issues.filter((i) => i.blocking).map((i) => i.field)).toEqual(['order_date', 'amount']);

    const t2 = table(['Customer', 'Date', 'Total'], rows(20, (i) => [`C${i % 4}`, '2024-01-01', '5']));
    let m = guessMapping(t2);
    m = { ...m, amount: { ...m.order_date } };
    expect(validateMapping(m).some((i) => i.blocking && /both/.test(i.message))).toBe(true);
  });

  it('setField records the override and clears the column from any other field', () => {
    const t = table(['Customer', 'Date', 'Total'], rows(20, (i) => [`C${i % 4}`, '2024-01-01', '5']));
    const m = setField(guessMapping(t), 'customer_name', 0);
    expect(m.customer_name).toMatchObject({ column: 0, origin: 'user', reason: 'Chosen by you.' });
    expect(m.customer_id.column).toBeNull();
  });
});

describe('bundled samples', () => {
  const load = (name: string) =>
    parseCsv(readFileSync(join(import.meta.dirname, '../../public/samples', `${name}.csv`), 'utf8'));

  it('maps purchases.csv (CD store)', () => {
    const t = load('purchases');
    const m = guessMapping(t);
    expect(mappedHeaders(t, m)).toEqual({ customer_id: 'users_id', order_date: 'date', amount: 'amt', quantity: 'cds' });
    expect(validateMapping(m)).toEqual([]);
    const { report } = clean(t, m);
    expect(report.dropped).toEqual([]);
    expect(report.notes[0]).toMatch(/same customer on the same day/);
  });

  it('maps the online store, salon and travel samples', () => {
    const online = load('online-store');
    expect(mappedHeaders(online, guessMapping(online))).toMatchObject({
      customer_id: 'Customer ID', order_date: 'Order Date', amount: 'Order Total', order_id: 'Order ID', email: 'Email',
    });
    const salon = load('hair-salon');
    expect(mappedHeaders(salon, guessMapping(salon))).toMatchObject({
      customer_id: 'Member #', customer_name: 'Client', order_date: 'Visit Date', amount: 'Paid',
    });
    const travel = load('travel-agency');
    const tm = guessMapping(travel);
    expect(tm.customer_id.column).toBeNull();
    expect(clean(travel, tm).report).toMatchObject({ customerKey: 'email', dateOrder: 'dmy' });
  });

  it('maps and cleans the messy file', () => {
    const t = load('messy');
    const m = guessMapping(t);
    expect(mappedHeaders(t, m)).toEqual({
      customer_id: 'Cust #', order_date: 'Txn Dt', amount: 'Grand Total', email: 'E-mail',
      category: 'Item', quantity: 'Qty', unit_price: 'Unit Price', order_id: 'Order No',
    });
    expect(validateMapping(m).filter((i) => i.blocking)).toEqual([]);
    const { report, transactions } = clean(t, m);
    expect(report.dateOrder).toBe('dmy');
    expect(report.lineItemsCollapsed).toBeGreaterThan(0);
    expect(report.refunds).toBeGreaterThan(0);
    expect(report.notes.join(' ')).toMatch(/blank row/);
    expect(transactions.every((x) => x.customerId === x.customerId.trim().toUpperCase())).toBe(true);
  });
});
