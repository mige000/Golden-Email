import type { ReactNode } from 'react';
import { date, days } from '../lib/format';
import { thresholds } from '../lib/segments';
import type { Settings, ValueSource } from '../lib/types';
import type { Derived } from '../useDerived';
import { SourceTag } from './ui';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  source?: ValueSource;
  hint?: ReactNode;
  onChange: (v: number) => void;
}

export function Slider({ label, value, min, max, step = 1, display, source, hint, onChange }: SliderProps) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-slate-700">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {source && <SourceTag source={source} />}
          <span className="text-sm font-semibold whitespace-nowrap tabular-nums text-slate-900">{display}</span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-emerald-600"
      />
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

interface Props {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  derived: Derived;
  onEditData: () => void;
}

/** Sticky panel: every slider changes `settings` and the whole plan recomputes. */
export function ControlsPanel({ settings, onSettings, derived, onEditData }: Props) {
  // Computed from the live settings (not the deferred plan), so sliders never jump back mid-drag.
  const gap = settings.gapOverride !== null ? { ...derived.gap!, days: settings.gapOverride, source: 'user' as const } : derived.gap!;
  const th = thresholds(settings, gap);
  const missing = th.missingDays.value;
  const lost = th.lostDays.value;
  const hasOverrides =
    settings.missingDaysOverride !== null || settings.lostDaysOverride !== null || settings.gapOverride !== null;

  return (
    <div className="space-y-5">
      <div className="text-sm text-slate-600">
        Plan as of <strong className="text-slate-900">{date(derived.today!.value)}</strong>{' '}
        <button type="button" className="text-emerald-700 underline" onClick={onEditData}>
          change
        </button>
      </div>

      <fieldset className="space-y-4">
        <legend className="mb-2 font-mono text-xs tracking-[0.15em] text-emerald-600 uppercase">Who counts as what</legend>
        <Slider
          label="Customers come back every"
          value={gap.days}
          min={1}
          max={Math.max(365, gap.days)}
          display={days(gap.days)}
          source={gap.source}
          onChange={(v) => onSettings({ gapOverride: v, missingDaysOverride: null, lostDaysOverride: null })}
        />
        <Slider
          label="“Slipping away” after"
          value={missing}
          min={1}
          max={Math.max(730, missing)}
          display={days(missing)}
          source={th.missingDays.source}
          onChange={(v) => onSettings({ missingDaysOverride: v, lostDaysOverride: settings.lostDaysOverride !== null && settings.lostDaysOverride <= v ? v + 1 : settings.lostDaysOverride })}
        />
        <Slider
          label="“Lost” after"
          value={lost}
          min={missing + 1}
          max={Math.max(1460, lost)}
          display={days(lost)}
          source={th.lostDays.source}
          onChange={(v) => onSettings({ lostDaysOverride: v })}
        />
        <Slider
          label="VIPs are the top"
          value={settings.vipPercent}
          min={1}
          max={30}
          display={`${settings.vipPercent}% by spend`}
          onChange={(v) => onSettings({ vipPercent: v })}
        />
        <Slider
          label="Regulars have at least"
          value={settings.regularsMinOrders}
          min={3}
          max={10}
          display={`${settings.regularsMinOrders} orders`}
          hint={`Second-timers: 2${settings.regularsMinOrders > 3 ? `–${settings.regularsMinOrders - 1}` : ''} orders.`}
          onChange={(v) => onSettings({ regularsMinOrders: v })}
        />
        {hasOverrides && (
          <button
            type="button"
            className="text-sm text-emerald-700 underline"
            onClick={() => onSettings({ gapOverride: null, missingDaysOverride: null, lostDaysOverride: null })}
          >
            Reset to what your data says
          </button>
        )}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 font-mono text-xs tracking-[0.15em] text-emerald-600 uppercase">Money</legend>
        <Slider
          label="Profit on each sale"
          value={Math.round(settings.margin * 100)}
          min={5}
          max={90}
          display={`${Math.round(settings.margin * 100)}%`}
          source="user"
          onChange={(v) => onSettings({ margin: v / 100 })}
        />
        <Slider
          label="Count purchases within"
          value={settings.windowDays}
          min={7}
          max={90}
          display={days(settings.windowDays)}
          hint="of the email. Every rate and dollar figure uses this."
          onChange={(v) => onSettings({ windowDays: v })}
        />
        <Slider
          label="Hold back as a test group"
          value={settings.holdoutPercent}
          min={0}
          max={30}
          display={`${settings.holdoutPercent}%`}
          hint="A random slice of each group you don’t email, so you can measure what the emails really did."
          onChange={(v) => onSettings({ holdoutPercent: v })}
        />
      </fieldset>
    </div>
  );
}
