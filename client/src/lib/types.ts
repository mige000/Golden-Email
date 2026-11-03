// Shared data model. Everything in /lib is pure and React-free.

/** Whole days since 1970-01-01 (UTC). All date math happens on these integers. */
export type Day = number;

/** Where a number came from — shown as a tag next to every figure in the UI. */
export type ValueSource = 'measured' | 'assumed' | 'user';

export interface Sourced<T> {
  value: T;
  source: ValueSource;
}

export type Confidence = 'high' | 'medium' | 'low';

// ---------- Raw input & column mapping ----------

export interface RawTable {
  headers: string[];
  rows: string[][];
}

export const REQUIRED_FIELDS = ['customer_id', 'order_date', 'amount'] as const;
export const OPTIONAL_FIELDS = [
  'customer_name',
  'email',
  'category',
  'quantity',
  'unit_price',
  'order_id',
] as const;
export type Field = (typeof REQUIRED_FIELDS)[number] | (typeof OPTIONAL_FIELDS)[number];

export interface FieldGuess {
  /** Column index in RawTable.headers, or null when unmapped. */
  column: number | null;
  confidence: Confidence | null;
  /** Plain-English explanation, e.g. "Picked “Txn Dt”: 98% of values are dates". */
  reason: string;
  /** 'guessed' by the app or chosen by the user via override. */
  origin: 'guessed' | 'user';
}

export type Mapping = Record<Field, FieldGuess>;

export interface MappingIssue {
  field: Field | null;
  message: string;
  blocking: boolean;
}

// ---------- Cleaned data ----------

export type DateOrder = 'ymd' | 'mdy' | 'dmy';

/** One order (line items already collapsed). Negative amount = refund. */
export interface Transaction {
  customerId: string;
  day: Day;
  amount: number;
  orderId?: string;
  name?: string;
  email?: string;
  category?: string;
}

export interface CleaningReport {
  rowsRead: number;
  rowsKept: number;
  dropped: { reason: string; count: number }[];
  /** Plain-English notes such as "Read 41 dates as day-first". */
  notes: string[];
  warnings: string[];
  dateOrder: DateOrder | null;
  dateOrderAmbiguous: boolean;
  lineItemsCollapsed: number;
  refunds: number;
  orphanRefunds: number;
  customerKey: 'customer_id' | 'email' | 'customer_name';
}

// ---------- Customers & segments ----------

export interface Customer {
  id: string;
  name?: string;
  email?: string;
  /** Sorted ascending; purchases only (refunds excluded). */
  orderDays: Day[];
  firstDay: Day;
  lastDay: Day;
  /** Days since last purchase, relative to "today". */
  recency: number;
  /** Number of purchases. */
  orders: number;
  /** Net spend after refunds. */
  totalSpend: number;
  /** Average order value (net spend / orders). */
  aov: number;
}

export const SEGMENT_IDS = [
  'vip',
  'regular',
  'secondTimer',
  'new',
  'slipping',
  'lost',
  'oneAndDone',
] as const;
export type SegmentId = (typeof SEGMENT_IDS)[number];

export const SEGMENT_LABELS: Record<SegmentId, string> = {
  vip: 'VIPs',
  regular: 'Regulars',
  secondTimer: 'Second-timers',
  new: 'New customers',
  slipping: 'Slipping away',
  lost: 'Lost',
  oneAndDone: 'One-and-done',
};

export interface TypicalGap {
  days: number;
  /** Number of repeat customers the median was computed from. */
  basis: number;
  repeatShare: number;
  /** Days of history before "today" the gap was measured over. */
  historyDays: number;
  confidence: Confidence;
  source: ValueSource;
}

export interface Thresholds {
  /** Active = recency ≤ missingDays. */
  missingDays: Sourced<number>;
  /** Lost = recency > lostDays. */
  lostDays: Sourced<number>;
}

// ---------- Settings (the single source of truth the sliders edit) ----------

export type Tone = 'friendly' | 'professional' | 'playful';
export type BusinessType = 'online_store' | 'salon' | 'gym' | 'restaurant' | 'travel' | 'other';

export interface UpliftAssumptions {
  /** Uplift from a plain email, no discount (fraction, 0.01 = 1 point). */
  u0: number;
  /** Uplift at the reference discount. */
  uRef: number;
  /** Reference discount (fraction). */
  dRef: number;
}

export interface Settings {
  todayOverride: Day | null;
  gapOverride: number | null;
  /** null → 2 × typical gap */
  missingDaysOverride: number | null;
  /** null → 3 × missing threshold */
  lostDaysOverride: number | null;
  /** Top X% of customers by total spend (computed across all customers). */
  vipPercent: number;
  regularsMinOrders: number;
  /** Profit margin as a fraction of each sale. */
  margin: number;
  /** Time window W in days: a purchase counts if it happens within W days of the email. */
  windowDays: number;
  uplift: UpliftAssumptions;
  p0Overrides: Partial<Record<SegmentId, number>>;
  /** Percent of each segment held out as "don't email" (0–30). */
  holdoutPercent: number;
  seed: number;
  tone: Tone;
  businessType: BusinessType | null;
}
