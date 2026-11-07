import { useMemo } from 'react';
import { applyP0Overrides, backtest } from './lib/backtest';
import { clean } from './lib/clean';
import { buildCustomers, dataRange, repeatRateByOrderCount, resolveToday, typicalGap } from './lib/customers';
import { validateMapping } from './lib/mapping';
import { buildPlan } from './lib/plan';
import { segmentCustomers, segmentStats, thresholds, type ReasonContext } from './lib/segments';
import type { DateOrder, Mapping, RawTable, Settings } from './lib/types';

/**
 * settings → pure functions → derived view. Each layer is memoised on only the inputs it uses, so
 * margin / uplift / holdout changes skip the backtest, and a mapping change re-runs everything.
 */
export function useDerived(
  table: RawTable | null,
  mapping: Mapping | null,
  dateOrder: DateOrder | null,
  settings: Settings,
) {
  const issues = useMemo(() => (mapping ? validateMapping(mapping) : []), [mapping]);
  const blocked = issues.some((i) => i.blocking);

  // Cleaning always runs so the mapping screen can preview it; the plan waits until nothing blocks.
  const cleaned = useMemo(
    () => (table && mapping ? clean(table, mapping, { dateOrder }) : null),
    [table, mapping, dateOrder],
  );
  const transactions = cleaned && !blocked && cleaned.transactions.length > 0 ? cleaned.transactions : null;
  const range = useMemo(() => (transactions ? dataRange(transactions) : null), [transactions]);

  const { todayOverride } = settings;
  const today = useMemo(() => (range ? resolveToday({ todayOverride }, range) : null), [range, todayOverride]);
  const todayValue = today?.value ?? null;

  const build = useMemo(
    () => (transactions && todayValue !== null ? buildCustomers(transactions, todayValue) : null),
    [transactions, todayValue],
  );
  const customers = build?.customers ?? null;

  const { gapOverride, missingDaysOverride, lostDaysOverride, vipPercent, regularsMinOrders, windowDays } = settings;
  const gap = useMemo(() => (customers ? typicalGap(customers, gapOverride) : null), [customers, gapOverride]);
  const th = useMemo(
    () => (gap ? thresholds({ missingDaysOverride, lostDaysOverride }, gap) : null),
    [gap, missingDaysOverride, lostDaysOverride],
  );
  const missing = th?.missingDays.value ?? null;
  const lost = th?.lostDays.value ?? null;

  const segmentation = useMemo(
    () => (customers && th ? segmentCustomers(customers, th, { vipPercent, regularsMinOrders }) : null),
    // Keyed on the threshold values (not the object) so an equal recomputation doesn't re-segment.
    [customers, missing, lost, vipPercent, regularsMinOrders],
  );
  const stats = useMemo(
    () => (customers && segmentation ? segmentStats(customers, segmentation) : null),
    [customers, segmentation],
  );
  const repeatRates = useMemo(
    () => (customers && todayValue !== null && missing !== null ? repeatRateByOrderCount(customers, todayValue, missing) : null),
    [customers, todayValue, missing],
  );

  // The heaviest step: only re-runs when the data, "today", thresholds, segment rules or W change.
  const rawBacktest = useMemo(
    () =>
      transactions && todayValue !== null && th
        ? backtest(transactions, todayValue, th, { vipPercent, regularsMinOrders, windowDays, p0Overrides: {} })
        : null,
    [transactions, todayValue, missing, lost, vipPercent, regularsMinOrders, windowDays],
  );
  const { p0Overrides } = settings;
  const bt = useMemo(() => (rawBacktest ? applyP0Overrides(rawBacktest, p0Overrides) : null), [rawBacktest, p0Overrides]);

  const { margin, uplift, upliftMultipliers, holdoutPercent, seed } = settings;
  const plan = useMemo(
    () =>
      customers && stats && bt
        ? buildPlan(customers, stats, bt, { margin, uplift, upliftMultipliers, holdoutPercent, seed })
        : null,
    [customers, stats, bt, margin, uplift, upliftMultipliers, holdoutPercent, seed],
  );

  const reasonCtx: ReasonContext | null = useMemo(
    () => (gap && th ? { gap, thresholds: th, settings: { vipPercent, regularsMinOrders } } : null),
    [gap, th, vipPercent, regularsMinOrders],
  );

  return {
    issues,
    blocked,
    cleaned,
    range,
    today,
    customers,
    ignoredOrders: build?.ignoredOrders ?? 0,
    gap,
    thresholds: th,
    segmentation,
    stats,
    repeatRates,
    backtest: bt,
    plan,
    reasonCtx,
  };
}

export type Derived = ReturnType<typeof useDerived>;
