import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Confidence, ValueSource } from '../lib/types';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const styles = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500',
    secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>{children}</section>;
}

export function CardTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold text-slate-900">{children}</h2>
      {hint && <p className="mt-0.5 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

const CONFIDENCE_STYLES: Record<Confidence, string> = {
  high: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  medium: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  low: 'bg-rose-50 text-rose-700 ring-rose-600/20',
};
const CONFIDENCE_LABELS: Record<Confidence, string> = { high: 'High', medium: 'Medium', low: 'Low' };

export function ConfidenceBadge({ confidence, suffix = 'confidence' }: { confidence: Confidence; suffix?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${CONFIDENCE_STYLES[confidence]}`}>
      {CONFIDENCE_LABELS[confidence]}
      {suffix ? ` ${suffix}` : ''}
    </span>
  );
}

const SOURCE_STYLES: Record<ValueSource, string> = {
  measured: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  assumed: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  user: 'bg-slate-100 text-slate-700 ring-slate-500/20',
};
const SOURCE_LABELS: Record<ValueSource, string> = { measured: 'Measured', assumed: 'Assumed', user: 'Set by you' };
const SOURCE_TIPS: Record<ValueSource, string> = {
  measured: 'Calculated from your own data.',
  assumed: 'An assumption, not something your data can tell us. Edit it under “Your assumptions”.',
  user: 'A value you entered.',
};

/** Small tag next to every number: where it came from. */
export function SourceTag({ source }: { source: ValueSource }) {
  return (
    <span
      title={SOURCE_TIPS[source]}
      className={`inline-flex items-center rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-inset ${SOURCE_STYLES[source]}`}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'error'; children: ReactNode }) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-rose-200 bg-rose-50 text-rose-900',
  }[tone];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

/**
 * Number input that only commits on blur / Enter, so typing "4" on the way to "45" doesn't
 * re-run the whole plan.
 */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
  className = '',
  ariaLabel,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    let v = Number(draft);
    if (!Number.isFinite(v) || draft.trim() === '') return setDraft(String(value));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onCommit(v);
    setDraft(String(v));
  };
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <input
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
      />
      {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
    </span>
  );
}
