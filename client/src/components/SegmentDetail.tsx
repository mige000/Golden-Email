import { lazy, Suspense, useMemo, useState } from 'react';
import { downloadText, exportFilename, segmentCsv } from '../lib/export';
import { count, date, money, pct, plural } from '../lib/format';
import { breakEvenSentence, explainOffer, offerHeadline, type PlanSegment } from '../lib/plan';
import { customerReason } from '../lib/segments';
import { SEGMENT_LABELS, type Customer, type SegmentId, type Settings } from '../lib/types';
import type { Derived } from '../useDerived';
import { EmailDraftPanel } from './EmailDraftPanel';
// Recharts is large; load it only when a group's detail page opens.
const ProfitCurve = lazy(() => import('./ProfitCurve').then((m) => ({ default: m.ProfitCurve })));
import { ACTION_STYLES } from './SegmentCard';
import { Button, Card, CardTitle, NumberField, SourceTag } from './ui';

interface Props {
  id: SegmentId;
  derived: Derived;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onBack: () => void;
}

const PAGE = 20;

export function SegmentDetail({ id, derived, settings, onSettings, onBack }: Props) {
  const x = derived.plan!.segments.find((s) => s.id === id)!;
  const customers = derived.customers!;
  const ctx = derived.reasonCtx!;
  const label = SEGMENT_LABELS[id];
  const be = breakEvenSentence(x.rec);

  const download = (group: 'email' | 'holdout') => {
    const members = (group === 'email' ? x.split.emailed : x.split.holdout).map((i) => customers[i]!);
    const csv = segmentCsv(members, {
      segmentLabel: label,
      group,
      discount: x.rec.action === 'email-discount' ? x.rec.discount : null,
      reason: (c) => customerReason(c, id, ctx),
    });
    downloadText(exportFilename(label, group, derived.today!.value), csv);
  };

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900">
        ← Back to the plan
      </button>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-light tracking-tight text-slate-900">{label}</h1>
          <p className="text-slate-600">
            {plural(x.stats.count, 'customer')} · {count(x.split.emailed.length)} to email
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${ACTION_STYLES[x.rec.action]}`}>{offerHeadline(x.rec)}</span>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <Suspense fallback={<div className="h-80 animate-pulse rounded-lg bg-slate-100" aria-label="Loading chart" />}>
            <ProfitCurve x={x} windowDays={settings.windowDays} />
          </Suspense>
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            <p>{explainOffer(x, settings.windowDays)}</p>
            {be && (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-sky-900">
                <strong>Break-even:</strong> {be} <SourceTag source="measured" />
              </p>
            )}
          </div>
        </Card>
        <BacktestCard x={x} derived={derived} settings={settings} onSettings={onSettings} />
      </div>

      <CustomerList x={x} customers={customers} windowDays={settings.windowDays} reason={(c) => customerReason(c, id, ctx)} onDownload={download} />

      <EmailDraftPanel key={id} x={x} ctx={ctx} settings={settings} onSettings={onSettings} />
    </div>
  );
}

function BacktestCard({ x, derived, settings, onSettings }: { x: PlanSegment; derived: Derived; settings: Settings; onSettings: (p: Partial<Settings>) => void }) {
  const p = x.p0;
  const W = settings.windowDays;
  const pooled = p.pooledWith && p.source !== 'user';
  const setOverride = (v: number | null) => {
    const next = { ...settings.p0Overrides };
    if (v === null) delete next[x.id];
    else next[x.id] = v;
    onSettings({ p0Overrides: next });
  };
  return (
    <Card>
      <CardTitle>How we measured “buy anyway”</CardTitle>
      <div className="flex items-center gap-2">
        <span className="text-3xl font-semibold text-slate-900">{pct(p.p0)}</span>
        <SourceTag source={p.source} />
      </div>
      <p className="mt-1 text-sm text-slate-600">
        of these customers buy within {W} days without any email from you.
      </p>
      {derived.backtest!.cutoffs.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          There isn’t enough history before this date to measure it, so this is a placeholder. Set your own below.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-slate-600">
            We went back to {p.perCutoff.length === 1 ? 'a past date' : `${p.perCutoff.length} past dates`}, found who was in
            this group then (using only what was known at the time), and checked who bought in the next {W} days:
          </p>
          <table className="mt-2 w-full text-sm tabular-nums">
            <tbody className="divide-y divide-slate-100">
              {p.perCutoff.map((c) => (
                <tr key={c.cutoff}>
                  <td className="py-1 text-slate-600">{date(c.cutoff)}</td>
                  <td className="py-1 text-right text-slate-900">
                    {c.n ? `${count(c.buyers)} of ${count(c.n)}` : 'nobody in the group'}
                  </td>
                  <td className="w-14 py-1 text-right text-slate-500">{c.n ? pct(c.buyers / c.n, 0) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {pooled && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Too few customers were in this group at those dates ({count(p.n)}), so we blended in similar groups
          {p.pooledWith!.length <= 2 && ` (${p.pooledWith!.map((s) => SEGMENT_LABELS[s]).join(', ')})`}. Treat this as rough.
        </p>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Those past purchases include whatever marketing you were doing then, so this is “how they usually behave”, not a
        perfect no-email number. Your test group fixes that over time.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <span>Know better? Use</span>
        <NumberField
          ariaLabel="Your own buy-anyway rate, percent"
          value={Math.round(p.p0 * 1000) / 10}
          min={0}
          max={100}
          step={0.5}
          suffix="%"
          onCommit={(v) => setOverride(v / 100)}
        />
        {p.source === 'user' && (
          <button type="button" className="text-emerald-700 underline" onClick={() => setOverride(null)}>
            Use measured ({p.measuredP0 === null ? 'n/a' : pct(p.measuredP0)})
          </button>
        )}
      </div>
    </Card>
  );
}

function CustomerList({
  x,
  customers,
  windowDays,
  reason,
  onDownload,
}: {
  x: PlanSegment;
  customers: Customer[];
  windowDays: number;
  reason: (c: Customer) => string;
  onDownload: (group: 'email' | 'holdout') => void;
}) {
  const [list, setList] = useState<'email' | 'holdout'>('email');
  const [page, setPage] = useState(0);
  const rows = useMemo(
    () => (list === 'email' ? x.split.emailed : x.split.holdout).map((i) => customers[i]!).sort((a, b) => b.totalSpend - a.totalSpend),
    [list, x.split, customers],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const tab = (id: 'email' | 'holdout', text: string) => (
    <button
      type="button"
      aria-pressed={list === id}
      onClick={() => {
        setList(id);
        setPage(0);
      }}
      className={`rounded-md px-3 py-1.5 text-sm ${list === id ? 'bg-emerald-600 text-on-accent' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {text}
    </button>
  );

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {tab('email', `To email (${count(x.split.emailed.length)})`)}
          {x.split.holdout.length > 0 && tab('holdout', `Test group, don’t email (${count(x.split.holdout.length)})`)}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => onDownload('email')} disabled={x.split.emailed.length === 0}>
            Download email list (CSV)
          </Button>
          {x.split.holdout.length > 0 && (
            <Button variant="secondary" onClick={() => onDownload('holdout')}>
              Download test group (CSV)
            </Button>
          )}
        </div>
      </div>
      {list === 'holdout' && (
        <p className="mb-3 text-sm text-slate-600">
          Like a control group: don’t email these people. After {windowDays} days, compare how many of them bought with how many
          emailed customers bought. The difference is your real uplift, which can replace our guess.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-160 text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="pb-2 font-medium">Customer</th>
              <th className="pb-2 text-right font-medium">Orders</th>
              <th className="pb-2 text-right font-medium">Spent</th>
              <th className="pb-2 pl-4 font-medium">Last purchase</th>
              <th className="pb-2 pl-4 font-medium">Why they’re here</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="py-2 pr-2">
                  <div className="max-w-48 truncate text-slate-900">{c.name ?? c.id}</div>
                  <div className="max-w-48 truncate text-xs text-slate-500">{c.email ?? (c.name ? c.id : '')}</div>
                </td>
                <td className="py-2 text-right tabular-nums">{c.orders}</td>
                <td className="py-2 text-right tabular-nums">{money(c.totalSpend)}</td>
                <td className="py-2 pl-4 whitespace-nowrap tabular-nums text-slate-700">{date(c.lastDay)}</td>
                <td className="py-2 pl-4 text-slate-600">{reason(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-slate-600">
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ← Previous
          </Button>
          <span className="tabular-nums">
            Page {page + 1} of {count(pages)}
          </span>
          <Button variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next →
          </Button>
        </div>
      )}
    </Card>
  );
}
