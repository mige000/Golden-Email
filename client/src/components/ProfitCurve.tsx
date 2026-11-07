import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { extraProfitPerRecipient, profitCurve } from '../lib/economics';
import { money, pct } from '../lib/format';
import { curveTitle, type PlanSegment } from '../lib/plan';

// Dark theme: the single series is the toned-down accent (4.9:1 on the card surface), the band is
// the same hue at low opacity, and grid/axis sit one step off the surface.
const C = {
  line: '#db7a42',
  band: '#db7a42',
  bandOpacity: 0.2,
  grid: '#3d382d',
  axis: '#4d473b',
  muted: '#a09b8f',
  ink: '#e2ddd2',
  ink2: '#b5b0a4',
  surface: '#2b271e',
};

interface Point {
  discount: number;
  profit: number;
  band: [number, number];
}

function TooltipBody({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-surface px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-slate-900">{p.discount === 0 ? 'No discount' : `${pct(p.discount, 0)} off`}</div>
      <div className="mt-0.5 tabular-nums text-slate-700">
        {money(p.profit)} extra profit
      </div>
      <div className="tabular-nums text-slate-500">
        {money(p.band[0])} to {money(p.band[1])} if the email wins half to 1½× as many extra buyers as we assumed
      </div>
    </div>
  );
}

/** Expected extra profit vs. discount for one group, with a sensitivity band (PLAN.md §3.7). */
export function ProfitCurve({ x, windowDays }: { x: PlanSegment; windowDays: number }) {
  const emailed = x.rec.emailed;
  const data: Point[] = useMemo(
    () =>
      profitCurve(x.offer, emailed).map((p) => ({
        discount: p.discount,
        profit: p.profit,
        band: [Math.min(p.low, p.high), Math.max(p.low, p.high)],
      })),
    [x.offer, emailed],
  );
  const best = x.rec.action === 'no-email' ? null : x.rec.discount;
  const max = x.rec.maxProfitableDiscount;
  const atBest = best === null ? 0 : emailed * extraProfitPerRecipient(best, x.offer);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let d = 0; d <= x.offer.margin + 1e-9; d += 0.05) out.push(Math.round(d * 100) / 100);
    return out;
  }, [x.offer.margin]);

  return (
    <figure>
      <figcaption className="mb-1 text-base font-semibold text-slate-900">{curveTitle(x.rec)}</figcaption>
      <p className="mb-3 text-sm text-slate-500">
        Expected extra profit over {windowDays} days from emailing {emailed.toLocaleString('en-US')} customers, at each
        discount.
      </p>
      <div className="h-72 w-full" role="img" aria-label={curveTitle(x.rec)}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 24, bottom: 8, left: 8 }}>
            <CartesianGrid stroke={C.grid} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="discount"
              type="number"
              domain={[0, x.offer.margin]}
              ticks={ticks}
              tickFormatter={(d: number) => pct(d, 0)}
              stroke={C.axis}
              tick={{ fill: C.muted, fontSize: 12 }}
              tickLine={false}
              label={{ value: 'Discount', position: 'insideBottomRight', offset: -4, fill: C.muted, fontSize: 12 }}
            />
            <YAxis
              tickFormatter={(v: number) => money(v)}
              stroke={C.axis}
              tick={{ fill: C.muted, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={72}
            />
            <Tooltip content={<TooltipBody />} cursor={{ stroke: C.axis, strokeWidth: 1 }} />
            <Area dataKey="band" stroke="none" fill={C.band} fillOpacity={C.bandOpacity} isAnimationActive={false} activeDot={false} />
            <ReferenceLine y={0} stroke={C.ink2} strokeWidth={1} />
            <Line
              dataKey="profit"
              stroke={C.line}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, stroke: C.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
            {max !== null && max > 0.005 && (
              <ReferenceDot
                x={max}
                y={0}
                r={5}
                fill={C.surface}
                stroke={C.ink}
                strokeWidth={2}
                // Below the zero line, so it never collides with the "Best" label above the curve.
                label={{ value: `Loses money above ${Math.floor(max * 100 + 1e-9)}%`, position: 'bottom', fill: C.ink2, fontSize: 12 }}
              />
            )}
            {best !== null && (
              <ReferenceDot
                x={best}
                y={atBest}
                r={6}
                fill={C.line}
                stroke={C.surface}
                strokeWidth={2}
                label={{ value: best === 0 ? 'Best: no discount' : `Best: ${pct(best, 0)} off`, position: 'top', fill: C.ink, fontSize: 12, fontWeight: 600 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-5 rounded" style={{ backgroundColor: C.line }} /> With your assumptions
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-sm" style={{ backgroundColor: C.band, opacity: C.bandOpacity }} /> If the email wins half to 1½× as many extra buyers as we assumed
        </span>
      </div>
    </figure>
  );
}
