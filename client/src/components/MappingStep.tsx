import { useMemo } from 'react';
import { dayToIso, parseDate } from '../lib/clean';
import { typicalGap } from '../lib/customers';
import { count, date, days, moneyCents, pct, plural, span } from '../lib/format';
import { ALL_FIELDS, FIELD_LABELS, setField } from '../lib/mapping';
import { BUSINESS_PRESETS } from '../lib/presets';
import { REQUIRED_FIELDS, type BusinessType, type DateOrder, type Field, type Mapping, type RawTable, type Settings } from '../lib/types';
import type { Derived } from '../useDerived';
import type { LoadedDataset } from './UploadStep';
import { Button, Card, CardTitle, ConfidenceBadge, NumberField, Notice } from './ui';

interface Props {
  dataset: LoadedDataset;
  mapping: Mapping;
  onMapping: (m: Mapping) => void;
  dateOrder: DateOrder | null;
  onDateOrder: (o: DateOrder | null) => void;
  derived: Derived;
  settings: Settings;
  onSettings: (patch: Partial<Settings>) => void;
  onBack: () => void;
  onContinue: () => void;
}

const FIELD_HELP: Partial<Record<Field, string>> = {
  customer_id: 'Who bought. Falls back to email, then name.',
  order_date: 'When they bought.',
  amount: 'How much they paid for the order (or line).',
  quantity: 'Only used when an amount is missing.',
  unit_price: 'Only used when an amount is missing.',
  order_id: 'Lets us combine line items into one order.',
};

export function MappingStep(props: Props) {
  const { dataset, mapping, derived, onContinue, onBack } = props;
  const canContinue = !derived.blocked && derived.customers !== null && derived.customers.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Check your data</h1>
        <p className="mt-1 text-slate-600">
          {dataset.name}: {plural(dataset.table.rows.length, 'row')}, {plural(dataset.table.headers.length, 'column')}. We’ve guessed
          what each column means. Fix anything that looks wrong.
        </p>
      </div>

      <ColumnsCard table={dataset.table} mapping={mapping} onMapping={props.onMapping} derived={derived} />

      <div className="grid gap-6 lg:grid-cols-2">
        <CleaningCard derived={derived} dateOrder={props.dateOrder} onDateOrder={props.onDateOrder} />
        <PreviewCard derived={derived} />
      </div>

      {derived.customers && derived.range && derived.today && (
        <div className="grid gap-6 lg:grid-cols-2">
          <TimelineCard derived={derived} settings={props.settings} onSettings={props.onSettings} />
          <GapCard derived={derived} settings={props.settings} onSettings={props.onSettings} />
        </div>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <Button variant="ghost" onClick={onBack}>
          ← Choose another file
        </Button>
        <div className="flex items-center gap-3">
          {!canContinue && <span className="text-sm text-slate-500">Fix the items marked in red to continue.</span>}
          <Button disabled={!canContinue} onClick={onContinue}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- Columns ----------

function sampleValue(table: RawTable, col: number): string {
  for (let i = 0; i < Math.min(table.rows.length, 50); i++) {
    const v = table.rows[i]![col]?.trim();
    if (v) return v.length > 24 ? `${v.slice(0, 24)}…` : v;
  }
  return '';
}

function ColumnsCard({ table, mapping, onMapping, derived }: { table: RawTable; mapping: Mapping; onMapping: (m: Mapping) => void; derived: Derived }) {
  const samples = useMemo(() => table.headers.map((_, i) => sampleValue(table, i)), [table]);
  const required = new Set<Field>(REQUIRED_FIELDS);
  const row = (field: Field) => {
    const g = mapping[field];
    // Non-blocking issues (e.g. "matched by email") already appear in the reason text.
    const fieldIssues = derived.issues.filter((i) => i.field === field && i.blocking);
    return (
      <tr key={field} className="align-top">
        <td className="py-3 pr-4">
          <div className="text-sm font-medium text-slate-900">
            {FIELD_LABELS[field]}
            {required.has(field) && <span className="ml-1 text-rose-600" aria-label="required">*</span>}
          </div>
          {FIELD_HELP[field] && <div className="text-xs text-slate-500">{FIELD_HELP[field]}</div>}
        </td>
        <td className="py-3 pr-4">
          <select
            aria-label={`Column for ${FIELD_LABELS[field]}`}
            value={g.column ?? ''}
            onChange={(e) => onMapping(setField(mapping, field, e.target.value === '' ? null : Number(e.target.value)))}
            className="w-full max-w-64 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
          >
            <option value="">— none —</option>
            {table.headers.map((h, i) => (
              <option key={i} value={i}>
                {h}
                {samples[i] ? `  (e.g. ${samples[i]})` : ''}
              </option>
            ))}
          </select>
        </td>
        <td className="py-3">
          <div className="flex flex-wrap items-center gap-2">
            {g.origin === 'user' ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">Set by you</span>
            ) : (
              g.confidence && <ConfidenceBadge confidence={g.confidence} />
            )}
            <span className="text-sm text-slate-600">{g.reason}</span>
          </div>
          {fieldIssues.map((i) => (
            <p key={i.message} className={`mt-1 text-sm ${i.blocking ? 'text-rose-700' : 'text-amber-700'}`}>
              {i.message}
            </p>
          ))}
        </td>
      </tr>
    );
  };
  const otherIssues = derived.issues.filter((i) => i.field === null);
  return (
    <Card>
      <CardTitle hint="Required fields are marked *. Optional ones make the plan and the emails better.">Columns we found</CardTitle>
      <div className="overflow-x-auto">
        <table className="w-full min-w-160">
          <tbody className="divide-y divide-slate-100">
            {REQUIRED_FIELDS.map(row)}
            <tr>
              <td colSpan={3} className="pt-5 pb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Optional
              </td>
            </tr>
            {ALL_FIELDS.filter((f) => !required.has(f)).map(row)}
          </tbody>
        </table>
      </div>
      {otherIssues.map((i) => (
        <Notice key={i.message} tone={i.blocking ? 'error' : 'warning'}>
          {i.message}
        </Notice>
      ))}
    </Card>
  );
}

// ---------- Cleaning summary ----------

function CleaningCard({ derived, dateOrder, onDateOrder }: { derived: Derived; dateOrder: DateOrder | null; onDateOrder: (o: DateOrder | null) => void }) {
  const r = derived.cleaned?.report;
  if (!r) return null;
  const showOrder = r.dateOrder === 'dmy' || r.dateOrder === 'mdy';
  return (
    <Card>
      <CardTitle hint="Updates as soon as you change a column above.">What we did to clean it up</CardTitle>
      <p className="text-sm text-slate-700">
        Read <strong>{count(r.rowsRead)}</strong> {r.rowsRead === 1 ? 'row' : 'rows'} and kept <strong>{count(r.rowsKept)}</strong>.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
        {r.dropped.map((d) => (
          <li key={d.reason}>
            Dropped {count(d.count)} {d.count === 1 ? 'row' : 'rows'} with {d.reason}.
          </li>
        ))}
        {r.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
        {r.dropped.length === 0 && r.notes.length === 0 && <li>Nothing to fix. The file was already clean.</li>}
      </ul>
      {r.warnings.map((w) => (
        <div key={w} className="mt-3">
          <Notice tone="warning">{w}</Notice>
        </div>
      ))}
      {showOrder && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-900">A date like 03/04/2024 means…</legend>
          <div className="mt-1 flex flex-wrap gap-4 text-sm">
            {(['mdy', 'dmy'] as const).map((o) => (
              <label key={o} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="date-order"
                  checked={r.dateOrder === o}
                  onChange={() => onDateOrder(o)}
                  className="accent-emerald-600"
                />
                {o === 'mdy' ? 'March 4 (month first)' : '3 April (day first)'}
              </label>
            ))}
            {dateOrder && (
              <button type="button" className="text-sm text-emerald-700 underline" onClick={() => onDateOrder(null)}>
                Let us detect it
              </button>
            )}
          </div>
        </fieldset>
      )}
    </Card>
  );
}

function PreviewCard({ derived }: { derived: Derived }) {
  const tx = derived.cleaned?.transactions ?? [];
  const rows = tx.slice(0, 5);
  return (
    <Card>
      <CardTitle hint="The first few orders, as we’ll use them.">Preview</CardTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No usable rows yet. Check the columns above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-2 font-medium">Customer</th>
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 text-right font-medium">Amount</th>
                <th className="pb-2 pl-4 font-medium">Order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {rows.map((t, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2">
                    <div className="max-w-44 truncate text-slate-900">{t.name ?? t.customerId}</div>
                    {t.name && <div className="max-w-44 truncate text-xs text-slate-500">{t.customerId}</div>}
                  </td>
                  <td className="py-1.5 pr-2 text-slate-700">{date(t.day)}</td>
                  <td className={`py-1.5 text-right ${t.amount < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{moneyCents(t.amount)}</td>
                  <td className="py-1.5 pl-4 text-slate-500">{t.orderId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------- Timeline ("today") ----------

function TimelineCard({ derived, settings, onSettings }: { derived: Derived; settings: Settings; onSettings: (p: Partial<Settings>) => void }) {
  const range = derived.range!;
  const today = derived.today!;
  const latestAgo = Math.round((Date.now() / 86_400_000 - range.end) / 30.44);
  return (
    <Card>
      <CardTitle>Plan as of</CardTitle>
      <p className="text-sm text-slate-700">
        Your data runs from <strong>{date(range.start)}</strong> to <strong>{date(range.end)}</strong> ({span(range.end - range.start)}).
        We treat the last date as “today”.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="date"
          aria-label="Plan as of date"
          value={dayToIso(today.value)}
          min={dayToIso(range.start)}
          max={dayToIso(range.end)}
          onChange={(e) => {
            const d = parseDate(e.target.value, 'ymd');
            if (d !== null) onSettings({ todayOverride: d === range.end ? null : d });
          }}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
        />
        {settings.todayOverride !== null && (
          <button type="button" className="text-sm text-emerald-700 underline" onClick={() => onSettings({ todayOverride: null })}>
            Back to the latest date
          </button>
        )}
      </div>
      {today.source === 'user' ? (
        <p className="mt-3 text-sm text-slate-600">
          Showing the plan as it would have looked on {date(today.value)}. {count(derived.ignoredOrders)} later{' '}
          {derived.ignoredOrders === 1 ? 'order is' : 'orders are'} ignored.
        </p>
      ) : (
        latestAgo >= 6 && (
          <p className="mt-3 text-sm text-slate-600">
            This data is old. Pick an earlier date to see what the plan would have recommended at that point.
          </p>
        )
      )}
    </Card>
  );
}

// ---------- Typical purchase gap ----------

function GapCard({ derived, settings, onSettings }: { derived: Derived; settings: Settings; onSettings: (p: Partial<Settings>) => void }) {
  const gap = derived.gap!;
  const measured = useMemo(() => typicalGap(derived.customers!), [derived.customers]);
  const userSet = gap.source === 'user';
  const lowMeasured = measured.confidence === 'low';
  const shortHistory = measured.confidence === 'medium' && measured.historyDays < 8 * measured.days;
  const choosePreset = (t: BusinessType) => onSettings({ gapOverride: BUSINESS_PRESETS[t].gapDays, businessType: t });
  return (
    <Card>
      <CardTitle>How often customers come back</CardTitle>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <p className="text-sm text-slate-700">
          A typical customer comes back every <strong className="text-lg text-slate-900">{days(gap.days)}</strong>
        </p>
        {userSet ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">Set by you</span>
        ) : (
          <ConfidenceBadge confidence={gap.confidence} />
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {measured.basis > 0
          ? `Measured from ${plural(measured.basis, 'customer')} who bought more than once (${pct(measured.repeatShare, 0)} of customers): ${days(measured.days)}.`
          : 'Nobody in this file has bought twice yet, so we can’t measure it.'}{' '}
        This sets when someone counts as “missing” (2× this) and “lost”.
      </p>

      {!userSet && lowMeasured && (
        <div className="mt-3">
          <Notice tone="warning">
            {measured.repeatShare < 0.15
              ? 'Most of your customers have only bought once, so we can’t measure this well.'
              : `Only ${plural(measured.basis, 'customer')} ${measured.basis === 1 ? 'has' : 'have'} bought more than once, so we can’t measure this well.`}{' '}
            How often does a typical customer come back?
          </Notice>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(BUSINESS_PRESETS) as BusinessType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => choosePreset(t)}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:border-emerald-500 hover:bg-emerald-50"
              >
                {BUSINESS_PRESETS[t].label} · ~{days(BUSINESS_PRESETS[t].gapDays)}
              </button>
            ))}
          </div>
        </div>
      )}
      {!userSet && shortHistory && (
        <div className="mt-3">
          <Notice tone="info">
            Only {span(measured.historyDays)} of history before this date, so longer gaps can’t show up yet. The real gap is
            probably longer than {days(measured.days)}.
          </Notice>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-700">
        <span>Set it yourself:</span>
        <NumberField
          ariaLabel="Typical days between purchases"
          value={gap.days}
          min={1}
          max={3650}
          suffix="days"
          onCommit={(v) => onSettings({ gapOverride: v })}
        />
        {settings.gapOverride !== null && (
          <button type="button" className="text-emerald-700 underline" onClick={() => onSettings({ gapOverride: null })}>
            Use measured ({days(measured.days)})
          </button>
        )}
      </div>
    </Card>
  );
}
