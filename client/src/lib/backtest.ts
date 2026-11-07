import { buildCustomers } from './customers';
import { segmentCustomers, type SegmentSettings } from './segments';
import {
  SEGMENT_IDS,
  type Confidence,
  type Day,
  type SegmentId,
  type Settings,
  type Thresholds,
  type Transaction,
  type ValueSource,
} from './types';

/** Fewer customers than this behind a rate → low confidence, pooled with neighbouring groups. */
export const MIN_BACKTEST_CUSTOMERS = 30;
const MAX_CUTOFFS = 4;
/** Used only when there's no history to measure at all; labelled as an assumption. */
export const FALLBACK_P0 = 0.05;

/** Groups whose customers behave most alike, used to pool a rate for a small group. */
const NEIGHBOURS: Record<SegmentId, SegmentId[]> = {
  vip: ['regular'],
  regular: ['vip', 'secondTimer'],
  secondTimer: ['regular', 'new'],
  new: ['secondTimer', 'oneAndDone'],
  slippingVip: ['slipping', 'vip'],
  slipping: ['oneAndDone', 'lost'],
  lostVip: ['lostRegular', 'slippingVip'],
  lostRegular: ['lost', 'lostVip'],
  lost: ['lostRegular', 'slipping'],
  oneAndDone: ['new', 'slipping'],
};
const ACTIVE: SegmentId[] = ['vip', 'regular', 'secondTimer', 'new'];

export interface CutoffCount {
  cutoff: Day;
  n: number;
  buyers: number;
}

export interface SegmentP0 {
  /** Chance a customer in this group buys within W days with no email. */
  p0: number;
  /** Customer-cutoffs measured (summed over cutoffs). */
  n: number;
  buyers: number;
  perCutoff: CutoffCount[];
  confidence: Confidence;
  source: ValueSource;
  /** Set when the group was too small and its rate was pooled with these groups. */
  pooledWith?: SegmentId[];
  /** The measured value, kept for display when the user has overridden p0. */
  measuredP0: number | null;
}

export interface BacktestResult {
  cutoffs: Day[];
  windowDays: number;
  bySegment: Record<SegmentId, SegmentP0>;
  /** W-day buy rate of active Regulars (or of all active groups if Regulars are too few). */
  pActive: { value: number; source: ValueSource; basis: 'regular' | 'allActive' | 'none' };
}

export type BacktestSettings = SegmentSettings & Pick<Settings, 'windowDays' | 'p0Overrides'>;

/** Past cutoffs today − W, today − 2W, … that still have earlier data to segment on. */
export function backtestCutoffs(today: Day, dataStart: Day, windowDays: number, max = MAX_CUTOFFS): Day[] {
  const out: Day[] = [];
  for (let k = 1; k <= max; k++) {
    const cutoff = today - k * windowDays;
    if (cutoff <= dataStart) break;
    out.push(cutoff);
  }
  return out;
}

/** First index in sorted `days` with a value > x. */
function upperBound(days: Day[], x: Day): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * p₀ per segment, measured from the user's own history (PLAN.md §3.5): at each past cutoff T,
 * segment customers using only data up to T with the current rules, then measure the share who
 * bought in (T, T + W]. Cutoffs are pooled, weighted by group size.
 */
export function backtest(
  transactions: Transaction[],
  today: Day,
  thresholds: Thresholds,
  settings: BacktestSettings,
): BacktestResult {
  const W = settings.windowDays;
  const asOfToday = buildCustomers(transactions, today).customers;
  const daysById = new Map(asOfToday.map((c) => [c.id, c.orderDays]));
  const dataStart = asOfToday.reduce((m, c) => Math.min(m, c.firstDay), Infinity);
  const cutoffs = backtestCutoffs(today, dataStart, W);

  const counts = Object.fromEntries(SEGMENT_IDS.map((id) => [id, [] as CutoffCount[]])) as Record<SegmentId, CutoffCount[]>;
  for (const cutoff of cutoffs) {
    const { customers } = buildCustomers(transactions, cutoff);
    const { assignments } = segmentCustomers(customers, thresholds, settings);
    const tally = Object.fromEntries(SEGMENT_IDS.map((id) => [id, { n: 0, buyers: 0 }])) as Record<SegmentId, { n: number; buyers: number }>;
    customers.forEach((c, i) => {
      const t = tally[assignments[i]!];
      t.n++;
      const days = daysById.get(c.id) ?? [];
      const next = days[upperBound(days, cutoff)];
      if (next !== undefined && next <= cutoff + W) t.buyers++;
    });
    for (const id of SEGMENT_IDS) counts[id].push({ cutoff, ...tally[id] });
  }

  const sum = (ids: SegmentId[]) =>
    ids.reduce(
      (acc, id) => {
        for (const c of counts[id]) {
          acc.n += c.n;
          acc.buyers += c.buyers;
        }
        return acc;
      },
      { n: 0, buyers: 0 },
    );

  const bySegment = {} as Record<SegmentId, SegmentP0>;
  for (const id of SEGMENT_IDS) {
    const own = sum([id]);
    let measured: number | null = own.n ? own.buyers / own.n : null;
    let confidence: Confidence = own.n >= 100 ? 'high' : own.n >= MIN_BACKTEST_CUSTOMERS ? 'medium' : 'low';
    let pooledWith: SegmentId[] | undefined;
    if (own.n < MIN_BACKTEST_CUSTOMERS) {
      const pooled = sum([id, ...NEIGHBOURS[id]]);
      if (pooled.n >= MIN_BACKTEST_CUSTOMERS) {
        measured = pooled.buyers / pooled.n;
        pooledWith = NEIGHBOURS[id];
      } else {
        const all = sum([...SEGMENT_IDS]);
        measured = all.n ? all.buyers / all.n : null;
        pooledWith = SEGMENT_IDS.filter((s) => s !== id);
      }
      confidence = 'low';
    }
    const override = settings.p0Overrides[id];
    const base = {
      n: own.n,
      buyers: own.buyers,
      perCutoff: counts[id],
      pooledWith,
      measuredP0: measured,
    };
    if (override !== undefined) {
      bySegment[id] = { ...base, p0: override, confidence: 'high', source: 'user' };
    } else if (measured === null) {
      bySegment[id] = { ...base, p0: FALLBACK_P0, confidence: 'low', source: 'assumed' };
    } else {
      bySegment[id] = { ...base, p0: measured, confidence, source: 'measured' };
    }
  }

  const regulars = sum(['regular']);
  const active = sum(ACTIVE);
  const pActive: BacktestResult['pActive'] =
    regulars.n >= MIN_BACKTEST_CUSTOMERS
      ? { value: regulars.buyers / regulars.n, source: 'measured', basis: 'regular' }
      : active.n > 0
        ? { value: active.buyers / active.n, source: 'measured', basis: 'allActive' }
        : { value: bySegment.regular.p0, source: bySegment.regular.source, basis: 'none' };

  return { cutoffs, windowDays: W, bySegment, pActive };
}

/**
 * Apply per-segment p₀ overrides to a backtest run without overrides, so editing an override doesn't
 * re-run the (heavier) backtest.
 */
export function applyP0Overrides(
  result: BacktestResult,
  overrides: Partial<Record<SegmentId, number>>,
): BacktestResult {
  const bySegment = { ...result.bySegment };
  for (const id of SEGMENT_IDS) {
    const o = overrides[id];
    if (o !== undefined) bySegment[id] = { ...bySegment[id], p0: o, confidence: 'high', source: 'user' };
  }
  return { ...result, bySegment };
}
