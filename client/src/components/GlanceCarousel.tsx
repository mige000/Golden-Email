import { useState } from 'react';
import { count, money, pct } from '../lib/format';
import { offerHeadline, type Plan } from '../lib/plan';
import { SEGMENT_LABELS, type SegmentId, type Settings, type Thresholds } from '../lib/types';
import { SegmentMap } from './SegmentMap';
import { Card } from './ui';

interface Props {
  plan: Plan;
  thresholds: Thresholds;
  settings: Settings;
  totalCustomers: number;
  onSelect: (id: SegmentId) => void;
}

interface BarRow {
  id: SegmentId;
  value: number;
  display: string;
  /** Secondary text under the label. */
  sub: string;
  tooltip: string;
}

/** Horizontal bars, one hue, sorted biggest first; every bar is labelled and opens its group. */
function BarList({ rows, onSelect }: { rows: BarRow[]; onSelect: (id: SegmentId) => void }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onSelect(r.id)}
            title={r.tooltip}
            className="group grid w-full grid-cols-[minmax(8rem,11rem)_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:outline-none"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-slate-900">{SEGMENT_LABELS[r.id]}</span>
              <span className="block truncate text-xs text-slate-500">{r.sub}</span>
            </span>
            <span className="h-3 rounded-r-[4px] bg-slate-100">
              <span
                className="block h-3 rounded-r-[4px] bg-emerald-600 transition-[width] group-hover:bg-emerald-500"
                style={{ width: `${max > 0 ? Math.max(0.5, (r.value / max) * 100) : 0}%` }}
              />
            </span>
            <span className="w-24 text-right text-sm font-medium tabular-nums text-slate-900">{r.display}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** "Your customers at a glance": the same groups seen three ways. */
export function GlanceCarousel({ plan, thresholds, settings, totalCustomers, onSelect }: Props) {
  const [slide, setSlide] = useState(0);
  const W = settings.windowDays;
  const live = plan.segments.filter((x) => x.stats.count > 0);

  const sizeRows: BarRow[] = [...live]
    .sort((a, b) => b.stats.count - a.stats.count)
    .map((x) => ({
      id: x.id,
      value: x.stats.count,
      display: count(x.stats.count),
      sub: `${pct(totalCustomers ? x.stats.count / totalCustomers : 0, 0)} of customers · ${offerHeadline(x.rec)}`,
      tooltip: `${SEGMENT_LABELS[x.id]}: ${count(x.stats.count)} customers`,
    }));
  const stakeOf = (x: Plan['segments'][number]) => (x.atRiskIfLapsed !== null ? x.atRiskIfLapsed : x.revenueAtStake);
  const moneyRows: BarRow[] = [...live]
    .sort((a, b) => stakeOf(b) - stakeOf(a))
    .map((x) => ({
      id: x.id,
      value: stakeOf(x),
      display: money(stakeOf(x)),
      sub: x.rec.action === 'no-email' ? 'Not emailing' : `+${money(x.rec.extraProfit)} from this email`,
      tooltip:
        x.atRiskIfLapsed !== null
          ? `${SEGMENT_LABELS[x.id]}: ${money(stakeOf(x))} at risk over ${W} days if they lapsed`
          : `${SEGMENT_LABELS[x.id]}: ${money(stakeOf(x))} more over ${W} days if they bought like your regulars`,
    }));

  const biggest = sizeRows[0];
  const richest = moneyRows[0];
  const slides = [
    {
      tab: 'Who’s where',
      title: 'Your customers at a glance',
      hint: 'Each box is one group: how recently they bought (columns) and how much (rows). Click one to see who’s in it.',
      body: (
        <div className="overflow-x-auto">
          <div className="min-w-140">
            <SegmentMap plan={plan} thresholds={thresholds} settings={settings} totalCustomers={totalCustomers} onSelect={onSelect} />
          </div>
        </div>
      ),
    },
    {
      tab: 'Group sizes',
      title: biggest
        ? `Biggest group: ${SEGMENT_LABELS[biggest.id]}, ${pct(totalCustomers ? biggest.value / totalCustomers : 0, 0)} of customers`
        : 'Group sizes',
      hint: 'Number of customers in each group. Click a bar to open the group.',
      body: <BarList rows={sizeRows} onSelect={onSelect} />,
    },
    {
      tab: 'Where the money is',
      title:
        richest && richest.value > 0
          ? `Most money at stake: ${SEGMENT_LABELS[richest.id]}, ${richest.display} over ${W} days`
          : 'Money at stake',
      hint: `Extra spend over ${W} days if each group bought like your active regulars (for VIPs: what you’d lose if they lapsed). Measured from your data. The profit line under each name is what this week’s email is expected to add.`,
      body: <BarList rows={moneyRows} onSelect={onSelect} />,
    },
  ];
  const s = slides[slide]!;
  const go = (i: number) => setSlide((i + slides.length) % slides.length);

  return (
    <Card className="relative">
      {/* Anchored to the card's corner (not to the title) so the arrows never move between slides. */}
      <div className="absolute top-4 right-5 flex items-center gap-1.5">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-600">
          {slide + 1} of {slides.length}
        </span>
        <button
          type="button"
          aria-label="Previous view"
          onClick={() => go(slide - 1)}
          className="grid size-8 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Next view"
          onClick={() => go(slide + 1)}
          className="grid size-8 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
        >
          ›
        </button>
      </div>
      <div className="mb-3 min-w-0 pr-36">
        <h2 className="text-base font-semibold text-slate-900">{s.title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{s.hint}</p>
      </div>
      <div role="tablist" aria-label="Views" className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {slides.map((x, i) => (
          <button
            key={x.tab}
            type="button"
            role="tab"
            aria-selected={i === slide}
            onClick={() => setSlide(i)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              i === slide ? 'border-emerald-600 font-medium text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {x.tab}
          </button>
        ))}
      </div>
      <div role="tabpanel">{s.body}</div>
    </Card>
  );
}
