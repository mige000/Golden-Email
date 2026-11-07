import { useState } from 'react';
import { uplift } from '../lib/economics';
import { pct } from '../lib/format';
import { DEFAULT_UPLIFT_MULTIPLIERS, defaultSettings } from '../lib/settings';
import { SEGMENT_IDS, SEGMENT_LABELS, type SegmentId, type Settings } from '../lib/types';
import type { Derived } from '../useDerived';
import { NumberField, SourceTag } from './ui';

interface Props {
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  derived: Derived;
}

const round1 = (x: number) => Math.round(x * 1000) / 10;

/** The things your sales data can't tell us, laid out so you can change them. */
export function AssumptionsPanel({ settings, onSettings, derived }: Props) {
  const [open, setOpen] = useState(false);
  const u = settings.uplift;
  const defaults = defaultSettings().uplift;
  const isDefault = u.u0 === defaults.u0 && u.uRef === defaults.uRef && u.dRef === defaults.dRef;
  const setOverride = (id: SegmentId, v: number | null) => {
    const next = { ...settings.p0Overrides };
    if (v === null) delete next[id];
    else next[id] = v;
    onSettings({ p0Overrides: next });
  };

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">Your assumptions</span>
        <span className="text-xs text-slate-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="space-y-5 border-t border-violet-200 px-3 pt-3 pb-4">
          <p className="text-xs text-slate-600">
            Purchase history can’t tell us how people respond to an email: there are no past emails in it. These numbers
            are <strong>deliberately cautious placeholders, not industry benchmarks</strong>. Your test group will tell you the
            real ones.
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm text-slate-700">
              <span>
                Extra buyers from a plain email <SourceTag source={isDefault ? 'assumed' : 'user'} />
              </span>
              <NumberField
                ariaLabel="Extra buyers from a plain email, percent"
                value={round1(u.u0)}
                min={0}
                max={50}
                step={0.5}
                suffix="%"
                onCommit={(v) => onSettings({ uplift: { ...u, u0: v / 100 } })}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-sm text-slate-700">
              <span className="flex items-center gap-1">
                …with
                <NumberField
                  ariaLabel="Reference discount, percent"
                  value={round1(u.dRef)}
                  min={1}
                  max={90}
                  suffix="% off"
                  onCommit={(v) => onSettings({ uplift: { ...u, dRef: v / 100 } })}
                />
              </span>
              <NumberField
                ariaLabel="Extra buyers at the reference discount, percent"
                value={round1(u.uRef)}
                min={0}
                max={50}
                step={0.5}
                suffix="%"
                onCommit={(v) => onSettings({ uplift: { ...u, uRef: v / 100 } })}
              />
            </div>
            <p className="text-xs text-slate-500">
              Bigger discounts persuade more people, with diminishing returns: e.g. {pct(uplift(0.05, u))} at 5% off,{' '}
              {pct(uplift(0.1, u))} at 10% off. This only counts people who buy <em>because of</em> the email.
            </p>
            {!isDefault && (
              <button type="button" className="text-sm text-emerald-700 underline" onClick={() => onSettings({ uplift: defaults })}>
                Back to our placeholders
              </button>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-slate-900">
              How strongly lapsed big spenders respond to a discount <SourceTag source="assumed" />
            </p>
            <p className="text-xs text-slate-500">
              People who used to spend a lot already know and liked you, so we assume a discount wins back more of them. 2× means
              a discount brings twice as many extra buyers as above. Higher numbers can mean bigger recommended discounts.
            </p>
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-violet-100">
                {(['lostVip', 'slippingVip', 'lostRegular'] as SegmentId[]).map((id) => {
                  const v = settings.upliftMultipliers[id] ?? 1;
                  const changed = v !== (DEFAULT_UPLIFT_MULTIPLIERS[id] ?? 1);
                  return (
                    <tr key={id}>
                      <td className="py-1.5 pr-2 text-slate-700">{SEGMENT_LABELS[id]}</td>
                      <td className="py-1.5 text-right">
                        <NumberField
                          ariaLabel={`How strongly ${SEGMENT_LABELS[id]} respond, times`}
                          value={v}
                          min={0}
                          max={10}
                          step={0.25}
                          suffix="×"
                          onCommit={(n) => onSettings({ upliftMultipliers: { ...settings.upliftMultipliers, [id]: n } })}
                        />
                      </td>
                      <td className="w-12 py-1.5 pl-1 text-right">
                        {changed && (
                          <button
                            type="button"
                            className="text-xs text-emerald-700 underline"
                            onClick={() => onSettings({ upliftMultipliers: { ...settings.upliftMultipliers, [id]: DEFAULT_UPLIFT_MULTIPLIERS[id] ?? 1 } })}
                          >
                            reset
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-900">Chance each group buys anyway</p>
            <p className="text-xs text-slate-500">
              Within {settings.windowDays} days, with no email. Measured from your history; change it if you know better.
            </p>
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-violet-100">
                {SEGMENT_IDS.filter((id) => (derived.stats?.[id].count ?? 0) > 0).map((id) => {
                  const p = derived.backtest!.bySegment[id];
                  const overridden = settings.p0Overrides[id] !== undefined;
                  return (
                    <tr key={id}>
                      <td className="py-1.5 pr-2 text-slate-700">{SEGMENT_LABELS[id]}</td>
                      <td className="py-1.5 pr-2 text-right text-xs text-slate-500 tabular-nums">
                        {p.measuredP0 !== null ? `measured ${pct(p.measuredP0)}` : 'not measurable'}
                      </td>
                      <td className="py-1.5 text-right">
                        <NumberField
                          ariaLabel={`Buy-anyway rate for ${SEGMENT_LABELS[id]}, percent`}
                          value={round1(p.p0)}
                          min={0}
                          max={100}
                          step={0.5}
                          suffix="%"
                          onCommit={(v) => setOverride(id, v / 100)}
                        />
                      </td>
                      <td className="w-12 py-1.5 pl-1 text-right">
                        {overridden && (
                          <button type="button" className="text-xs text-emerald-700 underline" onClick={() => setOverride(id, null)}>
                            reset
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
