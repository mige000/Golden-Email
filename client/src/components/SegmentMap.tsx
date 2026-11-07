import { count, days, pct } from '../lib/format';
import { offerHeadline, type Plan } from '../lib/plan';
import { SEGMENT_LABELS, type SegmentId, type Settings, type Thresholds } from '../lib/types';

interface Props {
  plan: Plan;
  thresholds: Thresholds;
  settings: Settings;
  totalCustomers: number;
  onSelect: (id: SegmentId) => void;
}

/** One-hue ordinal shading by share of customers (accent at rising opacity); text stays light on every step. */
const SHADES = ['#db7a4214', '#db7a422e', '#db7a424d', '#db7a4273'];
function shade(share: number): string {
  if (share < 0.02) return SHADES[0]!;
  if (share < 0.1) return SHADES[1]!;
  if (share < 0.25) return SHADES[2]!;
  return SHADES[3]!;
}

/** Where each group sits on the recency × orders grid (CSS grid lines). */
const PLACEMENT: Record<SegmentId, string> = {
  vip: 'col-start-2 row-start-2',
  regular: 'col-start-2 row-start-3',
  secondTimer: 'col-start-2 row-start-4',
  new: 'col-start-2 row-start-5',
  slippingVip: 'col-start-3 row-start-2',
  slipping: 'col-start-3 row-start-3 row-span-2',
  oneAndDone: 'col-start-3 row-start-5',
  lostVip: 'col-start-4 row-start-2',
  lostRegular: 'col-start-4 row-start-3',
  lost: 'col-start-4 row-start-4 row-span-2',
};

/**
 * The segment rules drawn as regions: columns are how recently someone bought, rows how often.
 * Each region is labelled, so identity never depends on colour.
 */
export function SegmentMap({ plan, thresholds, settings, totalCustomers, onSelect }: Props) {
  const m = thresholds.missingDays.value;
  const l = thresholds.lostDays.value;
  const r = settings.regularsMinOrders;
  const header = 'px-2 pb-2 text-xs font-medium text-slate-500';
  const rowLabel = 'flex items-center pr-3 text-xs font-medium text-slate-500';

  return (
    <div>
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] grid-rows-[auto_repeat(4,minmax(64px,auto))] gap-0.5 text-sm">
        <div />
        <div className={header}>Bought in the last {days(m)}</div>
        <div className={header}>Nothing for {days(m)}–{days(l)}</div>
        <div className={header}>Nothing for over {days(l)}</div>
        <div className={`${rowLabel} row-start-2`}>Top {settings.vipPercent}% spenders</div>
        <div className={`${rowLabel} row-start-3`}>{r}+ orders</div>
        <div className={`${rowLabel} row-start-4`}>{r > 3 ? `2–${r - 1}` : '2'} orders</div>
        <div className={`${rowLabel} row-start-5`}>1 order</div>
        {plan.segments.map((x) => {
          const share = totalCustomers ? x.stats.count / totalCustomers : 0;
          const empty = x.stats.count === 0;
          return (
            <button
              key={x.id}
              type="button"
              disabled={empty}
              onClick={() => onSelect(x.id)}
              title={empty ? 'No customers in this group right now' : `See ${SEGMENT_LABELS[x.id]}`}
              style={{ backgroundColor: empty ? '#ffffff08' : shade(share) }}
              className={`${PLACEMENT[x.id]} flex flex-col items-start justify-center rounded-md px-3 py-2 text-left ring-emerald-600 transition hover:ring-2 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default disabled:hover:ring-0`}
            >
              <span className={`font-medium ${empty ? 'text-slate-400' : 'text-slate-900'}`}>{SEGMENT_LABELS[x.id]}</span>
              <span className={`text-xs tabular-nums ${empty ? 'text-slate-400' : 'text-slate-700'}`}>
                {empty ? 'nobody right now' : `${count(x.stats.count)} · ${pct(share, 0)}`}
              </span>
              {!empty && <span className="mt-0.5 text-xs text-slate-600">{offerHeadline(x.rec)}</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>Fewer</span>
        {SHADES.map((c) => (
          <span key={c} className="h-3 w-6 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <span>More customers</span>
        <span className="ml-auto">Top spenders stay in the top row, even after they stop buying.</span>
      </div>
    </div>
  );
}
