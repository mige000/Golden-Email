import { useState } from 'react';
import { planProfitAtUplift } from '../lib/economics';
import { upliftForTarget } from '../lib/plan';
import { defaultSettings } from '../lib/settings';
import { count, money, pct, plural } from '../lib/format';
import { segmentRule } from '../lib/segments';
import { SEGMENT_LABELS, type SegmentId, type Settings } from '../lib/types';
import type { Derived } from '../useDerived';
import { AssumptionsPanel } from './AssumptionsPanel';
import { ControlsPanel } from './ControlsPanel';
import { SegmentCard } from './SegmentCard';
import { GlanceCarousel } from './GlanceCarousel';
import { Card, CardTitle, NumberField, SourceTag } from './ui';

interface Props {
  derived: Derived;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onOpenSegment: (id: SegmentId) => void;
  onEditData: () => void;
  /** True while a slider change is still being recomputed. */
  stale: boolean;
}

export function PlanScreen({ derived, settings, onSettings, onOpenSegment, onEditData, stale }: Props) {
  const plan = derived.plan!;
  const customers = derived.customers!;
  const ctx = derived.reasonCtx!;
  const live = plan.segments.filter((x) => x.stats.count > 0);
  const empty = plan.segments.filter((x) => x.stats.count === 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className={`min-w-0 space-y-6 transition-opacity ${stale ? 'opacity-60' : ''}`}>
        <div>
          <h1 className="text-3xl font-light tracking-tight text-slate-900">This week’s email plan</h1>
          {derived.today?.source === 'user' && (
            <p className="mt-1 text-sm text-amber-800">Viewing the plan as it would have looked on a past date.</p>
          )}
        </div>
        <PlanSummaryCard derived={derived} settings={settings} onSettings={onSettings} />

        <GlanceCarousel
          plan={plan}
          thresholds={derived.thresholds!}
          settings={settings}
          totalCustomers={customers.length}
          onSelect={onOpenSegment}
        />

        <div className="space-y-4">
          <h2 className="text-base font-semibold text-slate-900">Groups, biggest opportunity first</h2>
          {live.map((x) => (
            <SegmentCard
              key={x.id}
              x={x}
              settings={settings}
              ctx={ctx}
              repeatRates={derived.repeatRates}
              onOpen={onOpenSegment}
            />
          ))}
          <TestGroupCard derived={derived} settings={settings} />
          {empty.length > 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
              <p className="font-medium text-slate-600">Nobody in these groups right now</p>
              <ul className="mt-1 space-y-0.5">
                {empty.map((x) => (
                  <li key={x.id}>
                    <span className="text-slate-700">{SEGMENT_LABELS[x.id]}:</span> {segmentRule(x.id, ctx)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <aside id="plan-controls" className="scroll-mt-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
        <div className="space-y-4 rounded-xl border border-slate-200 bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Adjust the plan</h2>
          <ControlsPanel settings={settings} onSettings={onSettings} derived={derived} onEditData={onEditData} />
          <AssumptionsPanel settings={settings} onSettings={onSettings} derived={derived} />
        </div>
      </aside>

      {/* On phones the controls sit below a long page; give them a shortcut. */}
      <a
        href="#plan-controls"
        className="fixed right-4 bottom-4 z-10 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-medium text-on-accent shadow-lg lg:hidden"
      >
        Adjust the plan ↓
      </a>
    </div>
  );
}

/**
 * Leads with what's solid and states the assumption in the same breath. The uplift is editable
 * right in the sentence: by default it's a what-if (the current offers re-priced at that uplift);
 * the user can then choose to apply it to the assumptions, which re-runs the recommendations.
 */
function PlanSummaryCard({
  derived,
  settings,
  onSettings,
}: {
  derived: Derived;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
}) {
  const plan = derived.plan!;
  const s = plan.summary;
  const [whatIf, setWhatIf] = useState<number | null>(null);
  /** The uplift the user last applied, to explain if the re-run plan couldn't land exactly on it. */
  const [applied, setApplied] = useState<number | null>(null);
  const uplift = whatIf ?? s.assumedUplift;
  const profit = whatIf === null ? s.extraProfit : planProfitAtUplift(plan.rows, settings.margin, whatIf);
  const placeholders = defaultSettings().uplift;
  const assumptionsChanged =
    settings.uplift.u0 !== placeholders.u0 || settings.uplift.uRef !== placeholders.uRef || settings.uplift.dRef !== placeholders.dRef;
  const applyWhatIf = () => {
    if (whatIf === null) return;
    onSettings({ uplift: upliftForTarget(plan, settings.margin, settings.uplift, whatIf, settings.upliftMultipliers) });
    setApplied(whatIf);
    setWhatIf(null);
  };
  const missedTarget = applied !== null && assumptionsChanged && Math.abs(s.assumedUplift - applied) >= 0.0005;

  if (s.groupsEmailed === 0) {
    return (
      <Card>
        <p className="text-lg text-slate-900">
          Under your current assumptions, no group is worth emailing this week. Check “Your assumptions”.
        </p>
      </Card>
    );
  }

  return (
    <Card className="border-emerald-200">
      <p className="text-lg leading-relaxed text-slate-900">
        Email <strong>{count(s.emailedCustomers)}</strong> {s.emailedCustomers === 1 ? 'customer' : 'customers'} in <strong>{s.groupsEmailed}</strong>{' '}
        {s.groupsEmailed === 1 ? 'group' : 'groups'} this week
        {s.groupsSkipped > 0 && ` (skip ${s.groupsSkipped} — not worth it)`}.
      </p>
      <p className="mt-2 text-lg leading-relaxed text-slate-900">
        If{' '}
        <span className="inline-flex items-center gap-1 align-baseline">
          <NumberField
            ariaLabel="Share of recipients who buy because of the email, percent"
            value={Math.round(uplift * 1000) / 10}
            min={0}
            max={100}
            step={0.1}
            suffix="%"
            onCommit={(v) => {
              setWhatIf(v / 100);
              setApplied(null);
            }}
          />
          <SourceTag source={whatIf === null && !assumptionsChanged ? 'assumed' : 'user'} />
        </span>{' '}
        of recipients buy within {settings.windowDays} days who wouldn’t have otherwise, that’s about{' '}
        <strong>{money(profit)}</strong> extra profit. The plan breaks even at <strong>{pct(s.breakEvenUplift, 2)}</strong>{' '}
        <SourceTag source="measured" />.
      </p>
      {whatIf !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-600">
            What-if: this re-prices the current offers at {pct(whatIf)}. The recommendations haven’t changed.
          </span>
          <span className="flex flex-wrap gap-3">
            <button type="button" onClick={applyWhatIf} className="font-medium text-emerald-700 underline">
              Use {pct(whatIf)} for the recommendations
            </button>
            <button type="button" className="text-slate-600 underline" onClick={() => setWhatIf(null)}>
              Cancel
            </button>
          </span>
        </div>
      )}
      {missedTarget && whatIf === null && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          At {pct(applied!)} some offers change (e.g. a group goes from no discount to a discount), so the plan can’t average
          exactly that. {pct(s.assumedUplift)} is the closest it gets.
        </p>
      )}
      <p className="mt-3 text-sm text-slate-500">
        The break-even only uses your own numbers (who buys anyway, your margin, the discounts), so it’s the figure to trust.
        The profit depends on how many extra people buy because of the email; type a different % to see how it changes.
        {whatIf === null && assumptionsChanged && (
          <>
            {' '}
            You’ve changed how many extra buyers we assume.{' '}
            <button
              type="button"
              className="text-emerald-700 underline"
              onClick={() => {
                onSettings({ uplift: placeholders });
                setApplied(null);
              }}
            >
              Back to our placeholders
            </button>
          </>
        )}
      </p>
    </Card>
  );
}

/** The one place the plan talks about the test group: how many, and why. */
function TestGroupCard({ derived, settings }: { derived: Derived; settings: Settings }) {
  const plan = derived.plan!;
  const held = plan.segments.reduce((n, x) => n + x.split.holdout.length, 0);
  const total = plan.segments.reduce((n, x) => n + x.stats.count, 0);
  if (held === 0) {
    return (
      <Card>
        <CardTitle>Test group</CardTitle>
        <p className="text-sm text-slate-600">
          No test group: everyone in an emailed group gets the email. Turn on “Hold back as a test group” to measure what your
          emails really do.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <CardTitle>Test group</CardTitle>
      <p className="text-sm text-slate-700">
        <strong className="text-slate-900">{plural(held, 'customer')}</strong> ({pct(total ? held / total : 0, 0)} of each group,
        picked at random) won’t get this week’s emails.
      </p>
      <p className="mt-2 text-sm text-slate-500">
        Like a control group: after {settings.windowDays} days, compare how many of them bought with how many emailed customers
        bought. The difference is what your emails really did, and it can replace our guess under “Your assumptions”. Each
        group’s page has its test list to download.
      </p>
    </Card>
  );
}
