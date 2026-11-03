import type {
  CleaningReport,
  DateOrder,
  Day,
  Mapping,
  RawTable,
  Transaction,
} from './types';

// ---------- Dates ----------

const DAY_MS = 86_400_000;

export function dayFromYmd(y: number, m: number, d: number): Day | null {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d);
  const dt = new Date(t);
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(t / DAY_MS);
}

export function dayToIso(day: Day): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** "Mar", "march", "Sept" → month number; anything else → undefined. */
function monthNum(word: string): number | undefined {
  const w = word.toLowerCase();
  if (w.length < 3) return undefined;
  const i = MONTH_NAMES.findIndex((m) => m.startsWith(w));
  return i === -1 ? undefined : i + 1;
}

type DateParts =
  | { kind: 'fixed'; day: Day }
  /** a/b/y where a and b could be month/day either way round. */
  | { kind: 'numeric'; a: number; b: number; y: number };

const RE_ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/;
const RE_COMPACT = /^((?:19|20)\d{2})(\d{2})(\d{2})$/;
const RE_NUMERIC = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[ T].*)?$/;
const RE_DAY_MONTH_TEXT = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4})(?:[ T].*)?$/;
const RE_MONTH_TEXT_DAY = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})(?:[ T].*)?$/;

function splitDate(raw: string): DateParts | null {
  const s = raw.trim().replace(/^[A-Za-z]{3,9},?\s+(?=\d|[A-Za-z]{3})/, (m) =>
    // Strip a leading weekday ("Tue, 4 Mar 2025") but not a month name.
    monthNum(m.replace(/[,\s]/g, '')) ? m : '',
  );
  let m = RE_ISO.exec(s);
  if (m) {
    const day = dayFromYmd(+m[1]!, +m[2]!, +m[3]!);
    return day === null ? null : { kind: 'fixed', day };
  }
  if ((m = RE_COMPACT.exec(s))) {
    const day = dayFromYmd(+m[1]!, +m[2]!, +m[3]!);
    return day === null ? null : { kind: 'fixed', day };
  }
  if ((m = RE_NUMERIC.exec(s))) return { kind: 'numeric', a: +m[1]!, b: +m[2]!, y: +m[3]! };
  if ((m = RE_DAY_MONTH_TEXT.exec(s))) {
    const mon = monthNum(m[2]!);
    const day = mon ? dayFromYmd(+m[3]!, mon, +m[1]!) : null;
    return day === null ? null : { kind: 'fixed', day };
  }
  if ((m = RE_MONTH_TEXT_DAY.exec(s))) {
    const mon = monthNum(m[1]!);
    const day = mon ? dayFromYmd(+m[3]!, mon, +m[2]!) : null;
    return day === null ? null : { kind: 'fixed', day };
  }
  return null;
}

/** Parse one date value. `order` only matters for numeric a/b/year values. */
export function parseDate(raw: string, order: DateOrder | null = 'mdy'): Day | null {
  const p = splitDate(raw);
  if (!p) return null;
  if (p.kind === 'fixed') return p.day;
  return order === 'dmy' ? dayFromYmd(p.y, p.b, p.a) : dayFromYmd(p.y, p.a, p.b);
}

/** True if the value is a date under some reading (used for content sniffing). */
export function looksLikeDate(raw: string): boolean {
  const p = splitDate(raw);
  if (!p) return false;
  return p.kind === 'fixed' || dayFromYmd(p.y, p.a, p.b) !== null || dayFromYmd(p.y, p.b, p.a) !== null;
}

export interface DateOrderDetection {
  order: DateOrder;
  /** True when nothing in the data proves which way round 03/04 is (or the data contradicts itself). */
  ambiguous: boolean;
  /** Number of a/b/year values, i.e. the ones whose reading depends on `order`. */
  numericCount: number;
}

/** "If any value has a first part > 12, it's day-first; otherwise default to month-first and flag it." */
export function detectDateOrder(values: string[]): DateOrderDetection {
  let numericCount = 0;
  let firstOver12 = 0;
  let secondOver12 = 0;
  for (const v of values) {
    const p = splitDate(v);
    if (p?.kind !== 'numeric') continue;
    numericCount++;
    if (p.a > 12) firstOver12++;
    if (p.b > 12) secondOver12++;
  }
  if (numericCount === 0) return { order: 'ymd', ambiguous: false, numericCount };
  if (firstOver12 > 0 && secondOver12 === 0) return { order: 'dmy', ambiguous: false, numericCount };
  if (secondOver12 > 0 && firstOver12 === 0) return { order: 'mdy', ambiguous: false, numericCount };
  if (firstOver12 > 0 && secondOver12 > 0) {
    return { order: firstOver12 > secondOver12 ? 'dmy' : 'mdy', ambiguous: true, numericCount };
  }
  return { order: 'mdy', ambiguous: true, numericCount };
}

// ---------- Amounts ----------

/**
 * Parse money: strips $ € £ and currency codes, handles (12.50) as negative,
 * 1,234.56 (US) and 1.234,56 (European).
 */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s
    .replace(/^(usd|eur|gbp|cad|aud)\s*/i, '')
    .replace(/\s*(usd|eur|gbp|cad|aud)$/i, '')
    .replace(/[$€£¥₹\s ']/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever separator comes last is the decimal point.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const commas = s.split(',').length - 1;
    s = commas === 1 && /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot !== -1 && s.split('.').length > 2) {
    s = s.replace(/\./g, ''); // 1.234.567
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ---------- Cleaning ----------

export interface CleanResult {
  transactions: Transaction[];
  report: CleaningReport;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

interface Line {
  key: string;
  day: Day;
  amount: number;
  orderId?: string;
  name?: string;
  email?: string;
  category?: string;
}

/**
 * Raw rows → orders. Trims and normalises IDs, drops rows missing required values, collapses line
 * items into orders (by order ID, or same customer + same day when there's no order ID), and
 * keeps refunds as negative transactions for customers who also bought something.
 */
export interface CleanOptions {
  /** The user's answer to "is 03/04 March or April?"; overrides detection. */
  dateOrder?: DateOrder | null;
}

export function clean(table: RawTable, mapping: Mapping, opts: CleanOptions = {}): CleanResult {
  const col = (f: keyof Mapping) => mapping[f].column;
  const idCol = col('customer_id');
  const emailCol = col('email');
  const nameCol = col('customer_name');
  const dateCol = col('order_date');
  const amountCol = col('amount');
  const qtyCol = col('quantity');
  const unitCol = col('unit_price');
  const orderCol = col('order_id');
  const catCol = col('category');

  const customerKey: CleaningReport['customerKey'] =
    idCol !== null ? 'customer_id' : emailCol !== null ? 'email' : 'customer_name';
  const keyCol = idCol ?? emailCol ?? nameCol;

  const cell = (row: string[], c: number | null) => (c === null ? '' : (row[c] ?? '').trim());
  const normKey = (v: string) => {
    const s = v.replace(/\s+/g, ' ').trim();
    return customerKey === 'customer_id' ? s.toUpperCase() : s.toLowerCase();
  };

  const detected =
    dateCol === null ? null : detectDateOrder(table.rows.map((r) => r[dateCol] ?? ''));
  const userOrder = opts.dateOrder && opts.dateOrder !== 'ymd' ? opts.dateOrder : null;
  const detection: DateOrderDetection | null =
    detected && userOrder ? { ...detected, order: userOrder, ambiguous: false } : detected;

  const dropped = new Map<string, number>();
  const drop = (reason: string) => dropped.set(reason, (dropped.get(reason) ?? 0) + 1);
  let blankRows = 0;
  let computedAmounts = 0;
  const lines: Line[] = [];

  for (const row of table.rows) {
    if (row.every((c) => c.trim() === '')) {
      blankRows++;
      continue;
    }
    const rawKey = cell(row, keyCol);
    if (!rawKey) {
      drop('no customer');
      continue;
    }
    const day = dateCol === null ? null : parseDate(cell(row, dateCol), detection?.order ?? 'mdy');
    if (day === null) {
      drop('a missing or unreadable date');
      continue;
    }
    let amount = amountCol === null ? null : parseAmount(cell(row, amountCol));
    if (amount === null && qtyCol !== null && unitCol !== null) {
      const q = parseAmount(cell(row, qtyCol));
      const u = parseAmount(cell(row, unitCol));
      if (q !== null && u !== null) {
        amount = Math.round(q * u * 100) / 100;
        computedAmounts++;
      }
    }
    if (amount === null) {
      drop('no amount');
      continue;
    }
    lines.push({
      key: normKey(rawKey),
      day,
      amount,
      orderId: cell(row, orderCol) || undefined,
      name: cell(row, nameCol) || undefined,
      email: cell(row, emailCol).toLowerCase() || undefined,
      category: cell(row, catCol) || undefined,
    });
  }

  // Collapse purchase lines into orders; refunds stay separate.
  const orders = new Map<string, Transaction>();
  const refundLines: Line[] = [];
  let purchaseLines = 0;
  for (const l of lines) {
    if (l.amount < 0) {
      refundLines.push(l);
      continue;
    }
    purchaseLines++;
    const groupKey = l.orderId ? `${l.key}\u0000#${l.orderId}` : `${l.key}\u0000@${l.day}`;
    const existing = orders.get(groupKey);
    if (existing) {
      existing.amount += l.amount;
      existing.day = Math.min(existing.day, l.day);
      existing.name ??= l.name;
      existing.email ??= l.email;
      existing.category ??= l.category;
    } else {
      orders.set(groupKey, {
        customerId: l.key,
        day: l.day,
        amount: l.amount,
        orderId: l.orderId,
        name: l.name,
        email: l.email,
        category: l.category,
      });
    }
  }

  const buyers = new Set<string>();
  for (const o of orders.values()) {
    o.amount = Math.round(o.amount * 100) / 100;
    buyers.add(o.customerId);
  }
  let orphanRefunds = 0;
  const refunds: Transaction[] = [];
  for (const l of refundLines) {
    if (!buyers.has(l.key)) {
      orphanRefunds++;
      continue;
    }
    refunds.push({ customerId: l.key, day: l.day, amount: l.amount, orderId: l.orderId });
  }

  const transactions = [...orders.values(), ...refunds].sort(
    (a, b) => a.day - b.day || (a.customerId < b.customerId ? -1 : a.customerId > b.customerId ? 1 : 0),
  );

  // ---- Report ----
  const notes: string[] = [];
  const warnings: string[] = [];
  const lineItemsCollapsed = purchaseLines - orders.size;
  if (lineItemsCollapsed > 0) {
    notes.push(
      orderCol !== null
        ? `Combined ${plural(purchaseLines, 'line item')} into ${plural(orders.size, 'order')} using the order number.`
        : `Combined ${plural(lineItemsCollapsed + countMultiRowGroups(lines), 'row')} bought by the same customer on the same day into ${plural(countMultiRowGroups(lines), 'order')}.`,
    );
  }
  if (computedAmounts > 0) notes.push(`Worked out ${plural(computedAmounts, 'amount')} as quantity × unit price.`);
  if (detection && detection.numericCount > 0) {
    const label = detection.order === 'dmy' ? 'day-first (e.g. 31/01)' : 'month-first (e.g. 01/31)';
    notes.push(`Read ${plural(detection.numericCount, 'date')} as ${label}${userOrder ? ' (set by you)' : ''}.`);
    if (detection.ambiguous) {
      warnings.push(
        `Dates like 03/04 could mean 3 April or March 4. Nothing in the file settles it, so we read them as ${label}. Change this if it's wrong.`,
      );
    }
  }
  const zero = [...orders.values()].filter((o) => o.amount === 0).length;
  if (zero > 0) notes.push(`${plural(zero, 'purchase')} had a $0 amount; counted as visits with no spend.`);
  if (refunds.length > 0) notes.push(`Subtracted ${plural(refunds.length, 'refund')} from customer totals.`);
  if (blankRows > 0) notes.push(`Skipped ${plural(blankRows, 'blank row')}.`);
  if (customerKey === 'email') warnings.push('No customer ID column, so customers are matched by email address.');
  if (customerKey === 'customer_name' && nameCol !== null) {
    warnings.push('Matching customers by name may merge two different people with the same name.');
  }

  const droppedList = [...dropped].map(([reason, count]) => ({ reason, count }));
  if (orphanRefunds > 0) droppedList.push({ reason: 'a refund for a customer with no purchases', count: orphanRefunds });

  return {
    transactions,
    report: {
      rowsRead: table.rows.length,
      rowsKept: lines.length - orphanRefunds,
      dropped: droppedList,
      notes,
      warnings,
      dateOrder: detection?.order ?? null,
      dateOrderAmbiguous: detection?.ambiguous ?? false,
      lineItemsCollapsed,
      refunds: refunds.length,
      orphanRefunds,
      customerKey,
    },
  };
}

/** Number of (customer, day) groups with more than one purchase line — for the no-order-ID note. */
function countMultiRowGroups(lines: Line[]): number {
  const counts = new Map<string, number>();
  for (const l of lines) {
    if (l.amount < 0) continue;
    const k = `${l.key}\u0000${l.day}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let groups = 0;
  for (const n of counts.values()) if (n > 1) groups++;
  return groups;
}
