import type { RepeatRate } from './customers';
import {
  SEGMENT_IDS,
  SEGMENT_LABELS,
  type Customer,
  type SegmentId,
  type Settings,
  type Thresholds,
  type TypicalGap,
} from './types';

/** Missing = 2 × typical gap, lost = 3 × missing, unless the user moved the sliders. */
export function thresholds(
  settings: Pick<Settings, 'missingDaysOverride' | 'lostDaysOverride'>,
  gap: TypicalGap,
): Thresholds {
  const derived = gap.source === 'user' ? 'user' : 'measured';
  const missing = settings.missingDaysOverride ?? Math.round(2 * gap.days);
  let lost = settings.lostDaysOverride ?? 3 * missing;
  if (lost <= missing) lost = missing + 1;
  return {
    missingDays: { value: missing, source: settings.missingDaysOverride !== null ? 'user' : derived },
    lostDays: { value: lost, source: settings.lostDaysOverride !== null ? 'user' : derived },
  };
}

export type SegmentSettings = Pick<Settings, 'vipPercent' | 'regularsMinOrders'>;

export interface Segmentation {
  /** Segment per customer, aligned with the input array. */
  assignments: SegmentId[];
  /** Minimum total spend to count as a top spender (Infinity when nobody qualifies). */
  vipSpendCutoff: number;
}

/** Spend at the top `percent`% across ALL customers (active or not). */
export function vipSpendCutoff(customers: Customer[], percent: number): number {
  const spends = customers.map((c) => c.totalSpend).filter((s) => s > 0).sort((a, b) => b - a);
  if (spends.length === 0 || percent <= 0) return Infinity;
  const k = Math.max(1, Math.ceil((customers.length * percent) / 100));
  return spends[Math.min(k, spends.length) - 1]!;
}

/** Rules are checked in order; the first match wins (PLAN.md §3.3). */
export function segmentOf(
  c: Customer,
  t: Thresholds,
  s: SegmentSettings,
  vipCutoff: number,
): SegmentId {
  const active = c.recency <= t.missingDays.value;
  if (active && c.totalSpend >= vipCutoff) return 'vip';
  if (active && c.orders >= s.regularsMinOrders) return 'regular';
  if (active && c.orders >= 2) return 'secondTimer'; // 2 … regulars cutoff − 1
  if (active) return 'new';
  const topSpender = c.totalSpend >= vipCutoff;
  if (c.recency > t.lostDays.value) {
    if (topSpender) return 'lostVip';
    return c.orders >= s.regularsMinOrders ? 'lostRegular' : 'lost';
  }
  if (topSpender) return 'slippingVip';
  if (c.orders >= 2) return 'slipping';
  return 'oneAndDone';
}

export function segmentCustomers(customers: Customer[], t: Thresholds, s: SegmentSettings): Segmentation {
  const cutoff = vipSpendCutoff(customers, s.vipPercent);
  return {
    assignments: customers.map((c) => segmentOf(c, t, s, cutoff)),
    vipSpendCutoff: cutoff,
  };
}

// ---------- Per-segment stats ----------

export interface SegmentStats {
  id: SegmentId;
  label: string;
  /** Indexes into the customers array. */
  members: number[];
  count: number;
  totalSpend: number;
  /** Net spend per order across the group. */
  aov: number;
  avgOrders: number;
  medianRecency: number;
}

export function segmentStats(customers: Customer[], seg: Segmentation): Record<SegmentId, SegmentStats> {
  const out = {} as Record<SegmentId, SegmentStats>;
  for (const id of SEGMENT_IDS) {
    out[id] = { id, label: SEGMENT_LABELS[id], members: [], count: 0, totalSpend: 0, aov: 0, avgOrders: 0, medianRecency: 0 };
  }
  seg.assignments.forEach((id, i) => out[id].members.push(i));
  for (const id of SEGMENT_IDS) {
    const s = out[id];
    const cs = s.members.map((i) => customers[i]!);
    const orders = cs.reduce((n, c) => n + c.orders, 0);
    s.count = cs.length;
    s.totalSpend = cs.reduce((n, c) => n + c.totalSpend, 0);
    s.aov = orders ? s.totalSpend / orders : 0;
    s.avgOrders = cs.length ? orders / cs.length : 0;
    const rec = cs.map((c) => c.recency).sort((a, b) => a - b);
    s.medianRecency = rec.length ? rec[Math.floor(rec.length / 2)]! : 0;
  }
  return out;
}

// ---------- Plain-English reasons ----------

export interface ReasonContext {
  gap: TypicalGap;
  thresholds: Thresholds;
  settings: SegmentSettings;
}

const days = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'day' : 'days'}`;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Why this customer is in this group, e.g. "Bought 5 times, but hasn't purchased in 94 days…". */
export function customerReason(c: Customer, id: SegmentId, ctx: ReasonContext): string {
  const usual = `Your customers usually come back every ${days(ctx.gap.days)}.`;
  switch (id) {
    case 'vip':
      return `One of your top ${ctx.settings.vipPercent}% of spenders (${money(c.totalSpend)} in total); last bought ${days(c.recency)} ago.`;
    case 'regular':
      return `Bought ${times(c.orders)}, most recently ${days(c.recency)} ago.`;
    case 'secondTimer':
      return `Came back for purchase #${c.orders} ${days(c.recency)} ago.`;
    case 'new':
      return `First purchase was ${days(c.recency)} ago.`;
    case 'slippingVip':
      return `One of your top ${ctx.settings.vipPercent}% of spenders (${money(c.totalSpend)} in total), but hasn't purchased in ${days(c.recency)}. ${usual}`;
    case 'slipping':
      return `Bought ${times(c.orders)}, but hasn't purchased in ${days(c.recency)}. ${usual}`;
    case 'lostVip':
      return `Spent ${money(c.totalSpend)} with you in total, but the last purchase was ${days(c.recency)} ago.`;
    case 'lostRegular':
      return `Bought ${times(c.orders)}, but the last purchase was ${days(c.recency)} ago, past the ${days(ctx.thresholds.lostDays.value)} mark you count as lost.`;
    case 'lost':
      return `Last purchase was ${days(c.recency)} ago, past the ${days(ctx.thresholds.lostDays.value)} mark you count as lost.`;
    case 'oneAndDone':
      return `Bought once, ${days(c.recency)} ago, and hasn't come back. ${usual}`;
  }
}

/** The rule behind each group, in plain words. */
export function segmentRule(id: SegmentId, ctx: ReasonContext): string {
  const m = days(ctx.thresholds.missingDays.value);
  const l = days(ctx.thresholds.lostDays.value);
  const r = ctx.settings.regularsMinOrders;
  switch (id) {
    case 'vip':
      return `Top ${ctx.settings.vipPercent}% of all customers by total spend, and bought in the last ${m}.`;
    case 'regular':
      return `Bought in the last ${m}, with ${r} or more orders.`;
    case 'secondTimer':
      return r === 3
        ? `Bought in the last ${m}, with exactly 2 orders.`
        : `Bought in the last ${m}, with 2 to ${r - 1} orders.`;
    case 'new':
      return `Bought in the last ${m}, and only once so far.`;
    case 'slippingVip':
      return `Top ${ctx.settings.vipPercent}% of all customers by total spend, but nothing in the last ${m} (and not gone longer than ${l}).`;
    case 'slipping':
      return `Bought 2 or more times, but not in the last ${m} (and not gone longer than ${l}).`;
    case 'lostVip':
      return `Top ${ctx.settings.vipPercent}% of all customers by total spend, but haven't bought in more than ${l}.`;
    case 'lostRegular':
      return `Bought ${r} or more times, but haven't bought in more than ${l}.`;
    case 'lost':
      return `Bought ${r > 3 ? `fewer than ${r} times` : 'once or twice'}, and haven't bought in more than ${l}.`;
    case 'oneAndDone':
      return `Bought once, more than ${m} ago (but less than ${l}).`;
  }
}

/** Minimum customers behind a repeat rate before we quote it. */
const MIN_ELIGIBLE = 30;

/**
 * Checks the Second-timers claim against the user's own data instead of asserting it:
 * "Your customers with 2 orders buy again 41% of the time vs. 18% after 1 order."
 */
export function secondTimerEvidence(rates: RepeatRate[], horizonDays: number): string {
  const r1 = rates.find((r) => r.orders === 1);
  const r2 = rates.find((r) => r.orders === 2);
  if (!r1 || !r2 || r1.rate === null || r2.rate === null || r1.eligible < MIN_ELIGIBLE || r2.eligible < MIN_ELIGIBLE) {
    return 'There isn’t enough history yet to check whether a second purchase makes customers more likely to come back.';
  }
  const within = `within ${days(horizonDays)}`;
  if (r2.rate > r1.rate + 0.05) {
    return `Your customers with 2 orders buy again ${pct(r2.rate)} of the time (${within}), vs. ${pct(r1.rate)} after 1 order. The third purchase is often where a customer becomes a regular.`;
  }
  return `In your data, customers with 2 orders aren’t much more likely to buy again than after 1 order (${pct(r2.rate)} vs. ${pct(r1.rate)}, ${within}), so this group may not need different treatment from new customers.`;
}
