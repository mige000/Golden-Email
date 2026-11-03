import type { Settings } from './types';

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
    p0Overrides: {},
    holdoutPercent: 10,
    seed: 42,
    tone: 'friendly',
    businessType: null,
  };
}
