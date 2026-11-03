import type { Customer, Day, Settings, Sourced, Transaction, TypicalGap } from './types';

/** Gap used when the data has no repeat customers at all and the user hasn't set one. */
export const FALLBACK_GAP_DAYS = 30;
const MIN_REPEAT_CUSTOMERS = 30;
const MIN_REPEAT_SHARE = 0.15;
/** History shorter than this many gaps (e.g. an early "today") → the gap is at most medium confidence. */
const SHORT_HISTORY_MULTIPLE = 8;

export function dataRange(transactions: Transaction[]): { start: Day; end: Day } | null {
  if (transactions.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const t of transactions) {
    if (t.day < start) start = t.day;
    if (t.day > end) end = t.day;
  }
  return { start, end };
}

/**
 * "Today" = the latest date in the file, unless the user picked another date inside the data's
 * range to see the plan as it would have looked then.
 */
export function resolveToday(
  settings: Pick<Settings, 'todayOverride'>,
  range: { start: Day; end: Day },
): Sourced<Day> {
  if (settings.todayOverride === null) return { value: range.end, source: 'measured' };
  const value = Math.min(range.end, Math.max(range.start, settings.todayOverride));
  return { value, source: 'user' };
}

export interface CustomerBuild {
  customers: Customer[];
  /** Orders dated after "today", which are ignored. */
  ignoredOrders: number;
}

/** Transactions → one row per customer, as of `today`. Refunds reduce spend but aren't orders. */
export function buildCustomers(transactions: Transaction[], today: Day): CustomerBuild {
  const byId = new Map<string, { days: Day[]; spend: number; name?: string; email?: string }>();
  let ignoredOrders = 0;
  for (const t of transactions) {
    if (t.day > today) {
      if (t.amount >= 0) ignoredOrders++;
      continue;
    }
    let c = byId.get(t.customerId);
    if (!c) byId.set(t.customerId, (c = { days: [], spend: 0 }));
    c.spend += t.amount;
    if (t.amount >= 0) c.days.push(t.day);
    c.name ??= t.name;
    c.email ??= t.email;
  }

  const customers: Customer[] = [];
  for (const [id, c] of byId) {
    if (c.days.length === 0) continue; // only refunds before "today"
    c.days.sort((a, b) => a - b);
    const totalSpend = Math.max(0, Math.round(c.spend * 100) / 100);
    const lastDay = c.days[c.days.length - 1]!;
    customers.push({
      id,
      name: c.name,
      email: c.email,
      orderDays: c.days,
      firstDay: c.days[0]!,
      lastDay,
      recency: today - lastDay,
      orders: c.days.length,
      totalSpend,
      aov: totalSpend / c.days.length,
    });
  }
  return { customers, ignoredOrders };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Days between consecutive purchase days (same-day orders don't count as a gap). */
function gapsOf(c: Customer): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < c.orderDays.length; i++) {
    const g = c.orderDays[i]! - c.orderDays[i - 1]!;
    if (g > 0) gaps.push(g);
  }
  return gaps;
}

/**
 * Typical purchase gap = median, across repeat customers, of each customer's own median gap
 * (so a handful of very frequent buyers don't dominate). Low confidence with few repeat customers,
 * and at most medium when the history is short: only gaps shorter than the history can be seen,
 * so the measured gap is biased low.
 */
export function typicalGap(customers: Customer[], override: number | null = null): TypicalGap {
  const perCustomer: number[] = [];
  for (const c of customers) {
    const gaps = gapsOf(c);
    if (gaps.length > 0) perCustomer.push(median(gaps));
  }
  const basis = perCustomer.length;
  const repeatShare = customers.length ? basis / customers.length : 0;
  const measured = basis > 0 ? Math.max(1, Math.round(median(perCustomer))) : FALLBACK_GAP_DAYS;
  let historyDays = 0;
  if (customers.length > 0) {
    let first = Infinity;
    let last = -Infinity;
    for (const c of customers) {
      first = Math.min(first, c.firstDay);
      last = Math.max(last, c.recency + c.lastDay);
    }
    historyDays = last - first;
  }
  const confidence =
    basis < MIN_REPEAT_CUSTOMERS || repeatShare < MIN_REPEAT_SHARE
      ? 'low'
      : basis < 100 || historyDays < SHORT_HISTORY_MULTIPLE * measured
        ? 'medium'
        : 'high';

  if (override !== null && override > 0) {
    return { days: Math.round(override), basis, repeatShare, historyDays, confidence, source: 'user' };
  }
  return { days: measured, basis, repeatShare, historyDays, confidence, source: 'measured' };
}

export interface RepeatRate {
  /** Number of past orders (4 means "4 or more"). */
  orders: number;
  /** Customers who reached this many orders early enough to be observed for the full horizon. */
  eligible: number;
  repeated: number;
  rate: number | null;
}

/**
 * "Chance of buying again given k past orders": among customers whose k-th order was at least
 * `horizonDays` before today, the share who placed another order within `horizonDays` of it.
 * Requiring the full horizon avoids penalising recent customers who simply haven't had time yet.
 */
export function repeatRateByOrderCount(customers: Customer[], today: Day, horizonDays: number): RepeatRate[] {
  const buckets = [1, 2, 3, 4].map((orders) => ({ orders, eligible: 0, repeated: 0 }));
  for (const c of customers) {
    for (let k = 1; k <= c.orderDays.length; k++) {
      const kth = c.orderDays[k - 1]!;
      if (kth > today - horizonDays) break;
      const b = buckets[Math.min(k, 4) - 1]!;
      b.eligible++;
      const next = c.orderDays[k];
      if (next !== undefined && next - kth <= horizonDays) b.repeated++;
    }
  }
  return buckets.map((b) => ({ ...b, rate: b.eligible ? b.repeated / b.eligible : null }));
}
