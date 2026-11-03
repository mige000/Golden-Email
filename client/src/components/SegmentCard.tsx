import { secondTimerEvidence, segmentRule, customerReason, type ReasonContext } from '../lib/segments';
import type { RepeatRate } from '../lib/customers';
import { count, money, pct, plural } from '../lib/format';
import { breakEvenSentence, explainOffer, offerHeadline, type PlanSegment } from '../lib/plan';
import { SEGMENT_LABELS, type Customer, type SegmentId, type Settings } from '../lib/types';
import { SourceTag } from './ui';

interface Props {
  x: PlanSegment;
  customers: Customer[];
  settings: Settings;
  ctx: ReasonContext;
  repeatRates: RepeatRate[] | null;
  onOpen: (id: SegmentId) => void;
}

export const ACTION_STYLES = {
  'email-discount': 'bg-emerald-600 text-white',
  'email-no-discount': 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/30',
  'no-email': 'bg-slate-100 text-slate-600',
} as const;

export function SegmentCard({ x, customers, settings, ctx, repeatRates, onOpen }: Props) {
  const W = settings.windowDays;
  const lowConfidence = x.p0.source === 'measured' && x.p0.confidence === 'low';
  const example = x.stats.members[0] !== undefined ? customers[x.stats.members[0]] : undefined;
  const be = breakEvenSentence(x.rec);
  const isVip = x.atRiskIfLapsed !== null;
  const stake = isVip ? x.atRiskIfLapsed! : x.revenueAtStake;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{SEGMENT_LABELS[x.id]}</h3>
          <p className="text-sm text-slate-500">
            {plural(x.stats.count, 'customer')}
            {x.split.holdout.length > 0 && ` · ${count(x.split.holdout.length)} held back as a test group`}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${ACTION_STYLES[x.rec.action]}`}>{offerHeadline(x.rec)}</span>
      </header>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-slate-500">{isVip ? `At risk if they lapse (${W} days)` : `Money at stake (${W} days)`}</dt>
          <dd className="mt-0.5 flex items-center gap-1.5">
            <span className="text-xl font-semibold text-slate-900">{money(stake)}</span>
            <SourceTag source="measured" />
          </dd>
          <dd className="text-xs text-slate-500">
            {isVip
              ? 'What they’d stop spending if they behaved like slipping-away customers.'
              : stake > 0
                ? 'Extra they’d spend if they bought like your active regulars.'
                : 'They already buy like your regulars.'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Buy anyway, no email</dt>
          <dd className="mt-0.5 flex items-center gap-1.5">
            <span className="text-xl font-semibold text-slate-900">{pct(x.p0.p0)}</span>
            <SourceTag source={x.p0.source} />
          </dd>
          <dd className="text-xs text-slate-500">
            within {W} days{lowConfidence && ' · few customers to measure, so treat as rough'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Extra profit from this email</dt>
          <dd className="mt-0.5 flex items-center gap-1.5">
            <span className="text-xl font-semibold text-slate-900">{money(x.rec.extraProfit)}</span>
            <SourceTag source="assumed" />
          </dd>
          <dd className="text-xs text-slate-500">
            {x.rec.action === 'no-email'
              ? 'Not emailing.'
              : `if ${pct(x.rec.assumedUplift)} of ${count(x.rec.emailed)} recipients buy because of it`}
          </dd>
        </div>
      </dl>

      {be && (
        <p className="mt-4 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <strong>Break-even:</strong> {be} <SourceTag source="measured" />
        </p>
      )}

      <div className="mt-4 space-y-2 text-sm text-slate-700">
        <p>{explainOffer(x, W)}</p>
        <p className="text-slate-500">
          <span className="font-medium text-slate-600">Who’s in it:</span> {segmentRule(x.id, ctx)}
        </p>
        {x.id === 'secondTimer' && repeatRates && (
          <p className="text-slate-500">{secondTimerEvidence(repeatRates, ctx.thresholds.missingDays.value)}</p>
        )}
        {example && (
          <p className="border-l-2 border-slate-200 pl-3 text-slate-500 italic">
            e.g. {example.name ?? `Customer ${example.id}`}: {customerReason(example, x.id, ctx)}
          </p>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => onOpen(x.id)}
          className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
        >
          See customers, the discount curve and the email →
        </button>
      </div>
    </article>
  );
}
