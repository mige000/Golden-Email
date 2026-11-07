import type { SegmentId, Settings } from './types';

/** Placeholder assumptions: lapsed high-value customers respond more strongly to an offer. */
export const DEFAULT_UPLIFT_MULTIPLIERS: Partial<Record<SegmentId, number>> = {
  lostVip: 2,
  slippingVip: 1.5,
  lostRegular: 1.25,
};

/**
 * Defaults for every slider. Uplift values are deliberately conservative placeholders,
 * not industry benchmarks — the UI says so.
 */
export function defaultSettings(): Settings {
  return {
    todayOverride: null,
    gapOverride: null,
    missingDaysOverride: null,
    lostDaysOverride: null,
    vipPercent: 10,
    regularsMinOrders: 3,
    margin: 0.4,
    windowDays: 30,
    uplift: { u0: 0.01, uRef: 0.04, dRef: 0.2 },
    // Former big spenders already know and liked you, so an offer is more likely to win them back.
    upliftMultipliers: { ...DEFAULT_UPLIFT_MULTIPLIERS },
    p0Overrides: {},
    holdoutPercent: 10,
    seed: 42,
    tone: 'friendly',
    businessType: null,
  };
}
