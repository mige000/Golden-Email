import { dayToIso } from './clean';
import type { Day } from './types';

export const money = (n: number) =>
  `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;

export const moneyCents = (n: number) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 0.0123 → "1.2%"; whole percents drop the decimal ("10%"). */
export function pct(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return '—';
  const v = x * 100;
  const rounded = Number(v.toFixed(digits));
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(digits)}%`;
}

export const count = (n: number) => n.toLocaleString('en-US');

/** “1 customer”, “2,358 customers”. */
export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

export const days = (n: number) => `${count(n)} ${n === 1 ? 'day' : 'days'}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Day number → "Jun 30, 1998". */
export function date(day: Day): string {
  const [y, m, d] = dayToIso(day).split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
}

/** Span in friendly units: "18 months", "3 weeks", "2 years". */
export function span(daysCount: number): string {
  if (daysCount < 14) return days(daysCount);
  if (daysCount < 70) return `${Math.round(daysCount / 7)} weeks`;
  if (daysCount < 730) return `${Math.round(daysCount / 30.44)} months`;
  const years = daysCount / 365.25;
  return `${Number.isInteger(Math.round(years * 2) / 2) ? Math.round(years) : (Math.round(years * 2) / 2).toFixed(1)} years`;
}
