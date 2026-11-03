import { dayToIso } from './clean';
import type { Customer } from './types';

/** Quote a CSV cell; text that a spreadsheet would run as a formula is prefixed with '. */
function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

export interface ExportOptions {
  segmentLabel: string;
  /** 'email' or 'holdout' — which list this is. */
  group: 'email' | 'holdout';
  /** Recommended discount as a fraction; null when the group isn't being emailed. */
  discount: number | null;
  reason: (c: Customer) => string;
}

export const EXPORT_HEADER = [
  'customer_id',
  'name',
  'email',
  'segment',
  'list',
  'orders',
  'total_spend',
  'last_purchase',
  'days_since_last_purchase',
  'offer',
  'reason',
];

export function customerRows(customers: Customer[], o: ExportOptions): (string | number | null)[][] {
  const offer = o.group === 'holdout' ? 'Do not email (holdout)' : o.discount ? `${Math.round(o.discount * 100)}% off` : 'No discount';
  return customers.map((c) => [
    c.id,
    c.name ?? null,
    c.email ?? null,
    o.segmentLabel,
    o.group === 'holdout' ? 'holdout' : 'email',
    c.orders,
    c.totalSpend.toFixed(2),
    dayToIso(c.lastDay),
    c.recency,
    offer,
    o.reason(c),
  ]);
}

export function segmentCsv(customers: Customer[], o: ExportOptions): string {
  return toCsv(EXPORT_HEADER, customerRows(customers, o));
}

/** "Slipping away" → "slipping-away-email-2026-10-31.csv" */
export function exportFilename(segmentLabel: string, group: 'email' | 'holdout' | 'all', today: number): string {
  const slug = segmentLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-${group}-${dayToIso(today)}.csv`;
}

/** Browser-only: save text as a file. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
