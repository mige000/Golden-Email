import { describe, expect, it } from 'vitest';
import { defaultSettings } from './settings';

describe('defaultSettings', () => {
  it('returns a fresh object each call', () => {
    const a = defaultSettings();
    a.p0Overrides.vip = 0.5;
    expect(defaultSettings().p0Overrides).toEqual({});
  });

  it('keeps uplift at the reference discount above the plain-email uplift', () => {
    const { uplift } = defaultSettings();
    expect(uplift.uRef).toBeGreaterThan(uplift.u0);
  });
});
