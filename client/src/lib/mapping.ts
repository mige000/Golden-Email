import { looksLikeDate, parseAmount } from './clean';
import {
  OPTIONAL_FIELDS,
  REQUIRED_FIELDS,
  type Confidence,
  type Field,
  type FieldGuess,
  type Mapping,
  type MappingIssue,
  type RawTable,
} from './types';

export const ALL_FIELDS: readonly Field[] = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

export const FIELD_LABELS: Record<Field, string> = {
  customer_id: 'Customer ID',
  order_date: 'Purchase date',
  amount: 'Amount paid',
  customer_name: 'Customer name',
  email: 'Email',
  category: 'Product / category',
  quantity: 'Quantity',
  unit_price: 'Unit price',
  order_id: 'Order number',
};

/** What a header "looks like" in the reason text: "the name looks like {x}". */
const FIELD_NOUNS: Record<Field, string> = {
  customer_id: 'a customer ID',
  order_date: 'a purchase date',
  amount: 'an amount',
  customer_name: 'a customer name',
  email: 'an email address',
  category: 'a product or category',
  quantity: 'a quantity',
  unit_price: 'a unit price',
  order_id: 'an order number',
};

// ---------- Header matching ----------

/** "Cust #" → "cust no", "Txn_Dt" → "txn dt", " E-mail " → "e mail". */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/#/g, ' no ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const compact = (h: string) => normalizeHeader(h).replace(/ /g, '');

const SYNONYMS: Record<Field, { strong: string[]; weak: string[] }> = {
  customer_id: {
    strong: ['customerid', 'custid', 'custno', 'customerno', 'customernumber', 'clientid', 'clientno', 'memberid', 'memberno', 'membernumber', 'userid', 'usersid', 'accountid', 'accountno', 'guestid', 'buyerid', 'cust', 'customer', 'member', 'account', 'user', 'buyer'],
    weak: ['client', 'guest', 'id', 'users', 'patron'],
  },
  customer_name: {
    strong: ['customername', 'name', 'fullname', 'clientname', 'guestname', 'membername', 'buyername', 'traveller', 'traveler', 'travellername', 'contactname'],
    weak: ['client', 'customer', 'guest', 'contact', 'firstname'],
  },
  email: {
    strong: ['email', 'emailaddress', 'mail', 'customeremail', 'clientemail', 'emailid'],
    weak: ['contact'],
  },
  order_date: {
    strong: ['date', 'orderdate', 'txndt', 'txndate', 'transactiondate', 'purchasedate', 'purchasedat', 'created', 'createdat', 'timestamp', 'visit', 'visitdate', 'bookingdate', 'saledate', 'invoicedate', 'datetime', 'orderedat', 'day'],
    weak: ['time', 'when', 'period'],
  },
  amount: {
    strong: ['total', 'amount', 'amt', 'revenue', 'sales', 'paid', 'grandtotal', 'subtotal', 'ordertotal', 'totalprice', 'totalamount', 'value', 'spend', 'net', 'netsales', 'ordervalue', 'payment', 'sale'],
    weak: ['price', 'cost', 'sum'],
  },
  quantity: {
    strong: ['qty', 'quantity', 'units', 'unitcount', 'count', 'items', 'numitems', 'pieces'],
    weak: [],
  },
  unit_price: {
    strong: ['unitprice', 'priceeach', 'itemprice', 'priceperunit', 'unitcost', 'rate'],
    weak: ['price'],
  },
  category: {
    strong: ['category', 'productcategory', 'product', 'item', 'itemname', 'productname', 'service', 'destination', 'sku', 'type', 'department', 'genre'],
    weak: ['description'],
  },
  order_id: {
    strong: ['orderid', 'orderno', 'ordernumber', 'order', 'invoice', 'invoiceid', 'invoiceno', 'receipt', 'receiptno', 'transactionid', 'txnid', 'bookingref', 'bookingid', 'bookingno', 'ref', 'reference', 'ticket'],
    weak: ['id', 'transaction'],
  },
};

/** 1 = exact strong synonym, 0.75 = contains one, 0.6 = exact weak synonym, 0 = no match. */
export function headerScore(field: Field, header: string): number {
  const h = compact(header);
  if (!h) return 0;
  const { strong, weak } = SYNONYMS[field];
  if (strong.includes(h)) return 1;
  if (strong.some((s) => s.length >= 4 && h.includes(s))) return 0.75;
  if (weak.includes(h)) return 0.6;
  return 0;
}

// ---------- Content sniffing ----------

export interface ColumnProfile {
  /** Share of all rows with a non-empty value. */
  fillRate: number;
  dateRate: number;
  numericRate: number;
  /** Of the numeric values, the share with a fractional part / decimal separator. */
  decimalRate: number;
  /** Small whole numbers (0–1000) with a small median — quantities. */
  smallIntRate: number;
  emailRate: number;
  nameRate: number;
  distinct: number;
  /** distinct / non-empty values: ~1 means unique per row, small means values repeat. */
  distinctRatio: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[\p{L}][\p{L}'’.-]*(?: [\p{L}][\p{L}'’.-]*)+$/u;
const SAMPLE_SIZE = 2000;

export function profileColumn(table: RawTable, col: number): ColumnProfile {
  const n = table.rows.length;
  const step = Math.max(1, Math.floor(n / SAMPLE_SIZE));
  const values: string[] = [];
  let seen = 0;
  for (let i = 0; i < n; i += step) {
    seen++;
    const v = (table.rows[i]![col] ?? '').trim();
    if (v) values.push(v);
  }
  const m = values.length || 1;
  let dates = 0, numeric = 0, decimals = 0, ints = 0, emails = 0, names = 0;
  const intValues: number[] = [];
  for (const v of values) {
    if (looksLikeDate(v)) dates++;
    const num = parseAmount(v);
    if (num !== null && /\d/.test(v)) {
      numeric++;
      if (/[.,]\d{1,2}\)?$/.test(v.replace(/[^\d.,)]/g, '')) || !Number.isInteger(num)) decimals++;
      else if (/^\d+$/.test(v) && num <= 1000) {
        ints++;
        intValues.push(num);
      }
    }
    if (EMAIL_RE.test(v)) emails++;
    if (NAME_RE.test(v)) names++;
  }
  intValues.sort((a, b) => a - b);
  const medianInt = intValues[Math.floor(intValues.length / 2)] ?? Infinity;

  // Distinct ratio over all rows (not just the sample), so repeats are measured fairly.
  const all = new Set<string>();
  let nonEmpty = 0;
  for (const r of table.rows) {
    const v = (r[col] ?? '').trim();
    if (!v) continue;
    nonEmpty++;
    all.add(v.toUpperCase());
  }

  return {
    fillRate: seen ? values.length / seen : 0,
    dateRate: dates / m,
    numericRate: numeric / m,
    decimalRate: numeric ? decimals / numeric : 0,
    smallIntRate: medianInt <= 20 ? ints / m : 0,
    emailRate: emails / m,
    nameRate: names / m,
    distinct: all.size,
    distinctRatio: nonEmpty ? all.size / nonEmpty : 1,
  };
}

/** Fields whose content check must pass, or a matching header counts for little. */
const TYPED_FIELDS = new Set<Field>(['order_date', 'amount', 'unit_price', 'quantity', 'email']);
/** Fields that can't be recognised from content alone. */
const NEEDS_HEADER = new Set<Field>(['unit_price', 'order_id']);

/** How well a column's values fit a field (0–1). */
export function contentScore(field: Field, p: ColumnProfile): number {
  const textual = p.numericRate < 0.5 && p.dateRate < 0.5;
  switch (field) {
    case 'order_date':
      return p.dateRate;
    case 'amount':
    case 'unit_price':
      return p.dateRate > 0.5 ? 0 : p.numericRate * (0.6 + 0.4 * p.decimalRate);
    case 'quantity':
      return p.smallIntRate;
    case 'email':
      return p.emailRate;
    case 'customer_name':
      return textual ? p.nameRate * (p.distinctRatio < 0.98 ? 1 : 0.8) : 0;
    case 'customer_id': {
      if (p.dateRate > 0.5 || p.decimalRate > 0.5) return 0.1;
      if (p.distinct < 10) return 0.1;
      if (p.distinctRatio >= 0.95) return 0.2; // unique per row → more like an order number
      if (p.emailRate > 0.5 || p.nameRate > 0.5) return 0.5; // usable, but email/name fields want it
      return 0.8;
    }
    case 'order_id':
      return p.dateRate < 0.5 && p.decimalRate < 0.5 && p.distinctRatio >= 0.3 ? 0.7 : 0.2;
    case 'category':
      return textual && p.distinct <= 200 && p.distinctRatio <= 0.2 ? 0.8 : 0.2;
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function contentPhrase(field: Field, p: ColumnProfile): string {
  switch (field) {
    case 'order_date':
      return `${pct(p.dateRate)} of values are dates`;
    case 'amount':
    case 'unit_price':
      return `${pct(p.numericRate)} of values are amounts`;
    case 'quantity':
      return `${pct(p.smallIntRate)} of values are small whole numbers`;
    case 'email':
      return `${pct(p.emailRate)} of values are email addresses`;
    case 'customer_name':
      return `${pct(p.nameRate)} of values look like people's names`;
    case 'customer_id':
      return `values repeat across rows (${p.distinct.toLocaleString('en-US')} different customers)`;
    case 'order_id':
      return `${p.distinct.toLocaleString('en-US')} different values`;
    case 'category':
      return `${p.distinct.toLocaleString('en-US')} different values that repeat across rows`;
  }
}

// ---------- Guessing ----------

export interface Candidate {
  field: Field;
  column: number;
  score: number;
  header: number;
  content: number;
}

export function scoreCandidate(field: Field, header: string, p: ColumnProfile): Candidate | null {
  const h = headerScore(field, header);
  const c = contentScore(field, p);
  if (h === 0 && NEEDS_HEADER.has(field)) return null;
  let score: number;
  if (h === 0) score = 0.6 * c;
  else if (TYPED_FIELDS.has(field) && c < 0.5) score = 0.2 * h; // content contradicts the header
  else score = 0.55 * h + 0.45 * c;
  if (p.fillRate < 0.05) score *= 0.3;
  return { field, column: -1, score, header: h, content: c };
}

const confidenceFor = (score: number): Confidence =>
  score >= 0.8 ? 'high' : score >= 0.55 ? 'medium' : 'low';

const MIN_SCORE = 0.3;

const unmapped = (reason: string): FieldGuess => ({ column: null, confidence: null, reason, origin: 'guessed' });

/** Guess a column for every field: best (field, column) pairs first, never reusing a column. */
export function guessMapping(table: RawTable): Mapping {
  const profiles = table.headers.map((_, i) => profileColumn(table, i));
  const candidates: Candidate[] = [];
  table.headers.forEach((header, col) => {
    for (const field of ALL_FIELDS) {
      const c = scoreCandidate(field, header, profiles[col]!);
      if (c && c.score >= MIN_SCORE) candidates.push({ ...c, column: col });
    }
  });
  // A matching name plus plausible content beats content alone, so header matches are assigned
  // first (e.g. "users_id" full of small integers is a customer ID, not a quantity).
  candidates.sort((a, b) => Number(b.header > 0) - Number(a.header > 0) || b.score - a.score);

  const mapping = Object.fromEntries(ALL_FIELDS.map((f) => [f, unmapped('No matching column found.')])) as Mapping;
  const usedCols = new Set<number>();
  const doneFields = new Set<Field>();
  for (const c of candidates) {
    if (usedCols.has(c.column) || doneFields.has(c.field)) continue;
    usedCols.add(c.column);
    doneFields.add(c.field);
    const header = table.headers[c.column]!;
    const content = contentPhrase(c.field, profiles[c.column]!);
    const reason =
      c.header > 0
        ? `Picked “${header}”: the name looks like ${FIELD_NOUNS[c.field]}, and ${content}.`
        : `Picked “${header}”: no column is named like ${FIELD_NOUNS[c.field]}, but ${content}.`;
    mapping[c.field] = { column: c.column, confidence: confidenceFor(c.score), reason, origin: 'guessed' };
  }

  if (mapping.amount.column === null && mapping.quantity.column !== null && mapping.unit_price.column !== null) {
    mapping.amount = unmapped('No amount column, so we’ll use quantity × unit price.');
  }
  if (mapping.customer_id.column === null) {
    if (mapping.email.column !== null) {
      mapping.customer_id = unmapped('No customer ID column, so we’ll match customers by email.');
    } else if (mapping.customer_name.column !== null) {
      mapping.customer_id = unmapped(
        'No customer ID or email column, so we’ll match customers by name. This may merge two different people.',
      );
    }
  }
  return mapping;
}

/** The user picks a column for a field (or none). Any other field using that column is cleared. */
export function setField(mapping: Mapping, field: Field, column: number | null): Mapping {
  const next = { ...mapping };
  if (column !== null) {
    for (const f of ALL_FIELDS) {
      if (f !== field && next[f].column === column) {
        next[f] = { column: null, confidence: null, reason: `Column moved to ${FIELD_LABELS[field]}.`, origin: 'user' };
      }
    }
  }
  next[field] = {
    column,
    confidence: null,
    reason: column === null ? 'Left empty by you.' : 'Chosen by you.',
    origin: 'user',
  };
  return next;
}

/** Issues to show; any `blocking` issue disables "Continue". */
export function validateMapping(mapping: Mapping): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const has = (f: Field) => mapping[f].column !== null;

  if (!has('order_date')) {
    issues.push({ field: 'order_date', message: 'Pick the column with the purchase date.', blocking: true });
  }
  if (!has('amount') && !(has('quantity') && has('unit_price'))) {
    issues.push({
      field: 'amount',
      message: 'Pick the column with the amount paid (or both quantity and unit price).',
      blocking: true,
    });
  }
  if (!has('customer_id')) {
    if (has('email')) {
      issues.push({ field: 'customer_id', message: 'No customer ID: customers will be matched by email.', blocking: false });
    } else if (has('customer_name')) {
      issues.push({
        field: 'customer_id',
        message: 'No customer ID or email: customers will be matched by name, which may merge two people with the same name.',
        blocking: false,
      });
    } else {
      issues.push({ field: 'customer_id', message: 'Pick the column that identifies each customer.', blocking: true });
    }
  }
  for (const f of REQUIRED_FIELDS) {
    const g = mapping[f];
    if (g.column !== null && g.origin === 'guessed' && g.confidence === 'low') {
      issues.push({ field: f, message: `We're not sure about ${FIELD_LABELS[f]}. Please confirm the column.`, blocking: true });
    }
  }
  const byCol = new Map<number, Field[]>();
  for (const f of ALL_FIELDS) {
    const c = mapping[f].column;
    if (c !== null) byCol.set(c, [...(byCol.get(c) ?? []), f]);
  }
  for (const fields of byCol.values()) {
    if (fields.length > 1) {
      issues.push({
        field: fields[1]!,
        message: `One column is used for both ${fields.map((f) => FIELD_LABELS[f]).join(' and ')}.`,
        blocking: true,
      });
    }
  }
  return issues;
}
