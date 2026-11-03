/**
 * Deterministic synthetic sample data for the Win-Back Planner.
 *
 *   npm run generate-data                 → client/public/samples/{online-store,hair-salon,travel-agency,messy}.csv
 *   npm run generate-data -- --rows 50000 → also client/public/samples/online-store-50k.csv (perf testing, gitignored)
 *
 * One generative model drives every business type:
 *  - Each customer joins on a random day and orders again with a probability that RISES with every
 *    order placed (continueProb[k]), so "chance of buying again" jumps from 1 → 2 → 3 orders.
 *  - Each customer has a personal gap (business gap × noise); "faders" stretch their gap after
 *    every order, which produces a realistic slipping-away group.
 *  - Customer-level spend has a heavy tail, so a small group of big spenders (VIPs) emerges.
 *  - A few customers who stopped come back once after a long break, so "lost" groups have a small,
 *    realistic chance of buying on their own instead of exactly zero.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- Seeded randomness ----------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  normal(): number {
    const u = 1 - this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Multiplicative noise with median 1. */
  lognormal(sigma: number): number {
    return Math.exp(sigma * this.normal());
  }
}

// ---------- Dates ----------

const DAY_MS = 86_400_000;
const toDay = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const parts = (day: number) => {
  const d = new Date(day * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};
const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = {
  iso: (day: number) => {
    const p = parts(day);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  },
  mdy: (day: number) => {
    const p = parts(day);
    return `${pad(p.m)}/${pad(p.d)}/${p.y}`;
  },
  dmy: (day: number) => {
    const p = parts(day);
    return `${pad(p.d)}/${pad(p.m)}/${p.y}`;
  },
  text: (day: number) => {
    const p = parts(day);
    return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
  },
};

// ---------- Simulation ----------

export interface BusinessConfig {
  customers: number;
  startIso: string;
  endIso: string;
  /** Median days between visits for a typical repeat customer. */
  gapDays: number;
  /** Median order value. */
  aov: number;
  /** P(order k+1 | k orders so far), indexed by k−1; the last value repeats. */
  continueProb: number[];
  /** Share of customers whose gaps stretch after every order. */
  faderShare: number;
  /** Chance a customer who stopped comes back once after a long break (4–14 personal gaps). */
  comebackProb: number;
  categories: readonly string[];
}

export interface SimOrder {
  customer: number;
  day: number;
  amount: number;
  category: string;
}

export interface SimCustomer {
  index: number;
  first: string;
  last: string;
}

const FIRST = ['Ava', 'Ben', 'Chloe', 'Dan', 'Elena', 'Femi', 'Grace', 'Hiro', 'Isla', 'Jonah', 'Kira', 'Liam', 'Maya', 'Noor', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Uma', 'Victor', 'Wen', 'Xavi', 'Yara', 'Zoe'];
const LAST = ['Adams', 'Brown', 'Chen', 'Diaz', 'Evans', 'Fischer', 'Garcia', 'Hughes', 'Ito', 'Jones', 'Khan', 'Lopez', 'Martin', 'Nguyen', 'Okafor', 'Patel', 'Rossi', 'Silva', 'Taylor', 'Walker', 'Young', 'Zhang'];

export function simulate(cfg: BusinessConfig, seed: number) {
  const rng = new Rng(seed);
  const start = toDay(cfg.startIso);
  const end = toDay(cfg.endIso);
  const customers: SimCustomer[] = [];
  const orders: SimOrder[] = [];

  for (let c = 0; c < cfg.customers; c++) {
    customers.push({ index: c, first: rng.pick(FIRST), last: rng.pick(LAST) });
    // Frequent customers come back faster and more reliably.
    const frequent = rng.chance(0.2);
    const personalGap = cfg.gapDays * rng.lognormal(0.35) * (frequent ? 0.6 : 1);
    const personalAov = cfg.aov * rng.lognormal(0.6);
    const fade = rng.chance(cfg.faderShare) ? 1.25 + rng.float() * 0.3 : 1;
    const loyaltyBoost = frequent ? 0.1 : 0;
    const favourite = rng.pick(cfg.categories);

    let day = rng.int(start, end);
    let k = 0;
    let cameBack = false;
    while (day <= end) {
      k++;
      orders.push({
        customer: c,
        day,
        amount: Math.round(personalAov * rng.lognormal(0.25) * 100) / 100,
        category: rng.chance(0.6) ? favourite : rng.pick(cfg.categories),
      });
      const pCont = cfg.continueProb[Math.min(k - 1, cfg.continueProb.length - 1)]!;
      if (!rng.chance(Math.min(0.95, pCont + loyaltyBoost))) {
        if (cameBack || !rng.chance(cfg.comebackProb)) break;
        cameBack = true;
        day += Math.round(personalGap * (4 + rng.float() * 10));
        continue;
      }
      day += Math.max(1, Math.round(personalGap * rng.lognormal(0.4) * fade ** (k - 1)));
    }
  }

  orders.sort((a, b) => a.day - b.day || a.customer - b.customer);
  return { customers, orders };
}

// ---------- Business types ----------

const RANGE = { startIso: '2024-11-01', endIso: '2026-10-31' };

export const BUSINESSES = {
  onlineStore: {
    ...RANGE,
    customers: 2500,
    gapDays: 45,
    aov: 55,
    continueProb: [0.3, 0.52, 0.66, 0.75, 0.8],
    faderShare: 0.35,
    comebackProb: 0.2,
    categories: ['Home', 'Kitchen', 'Beauty', 'Outdoor', 'Stationery', 'Toys'],
  },
  salon: {
    ...RANGE,
    customers: 900,
    gapDays: 35,
    aov: 70,
    continueProb: [0.5, 0.68, 0.78, 0.85, 0.88],
    faderShare: 0.3,
    comebackProb: 0.2,
    categories: ['Cut', 'Colour', 'Blow-dry', 'Treatment', 'Highlights'],
  },
  travel: {
    startIso: '2023-11-01',
    endIso: '2026-10-31',
    customers: 700,
    gapDays: 300,
    aov: 1800,
    continueProb: [0.12, 0.3, 0.45],
    faderShare: 0.2,
    comebackProb: 0.04,
    categories: ['Beach', 'City break', 'Cruise', 'Safari', 'Ski'],
  },
} satisfies Record<string, BusinessConfig>;

// ---------- CSV output ----------

function csv(header: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

const custId = (i: number) => `C${String(i + 1).padStart(5, '0')}`;
const email = (c: SimCustomer) =>
  `${c.first}.${c.last}${c.index + 1}@example.com`.toLowerCase();

/** Online store: clean, ISO dates, one row per order. The "easy" file. */
export function onlineStoreCsv(seed = 1, customers = BUSINESSES.onlineStore.customers): string {
  const { customers: cs, orders } = simulate({ ...BUSINESSES.onlineStore, customers }, seed);
  return csv(
    ['Order ID', 'Customer ID', 'Customer Name', 'Email', 'Order Date', 'Category', 'Order Total'],
    orders.map((o, i) => {
      const c = cs[o.customer]!;
      return [`ORD-${100000 + i}`, custId(c.index), `${c.first} ${c.last}`, email(c), fmt.iso(o.day), o.category, o.amount.toFixed(2)];
    }),
  );
}

/** Salon: US month-first dates, "Member #" / "Paid" headers. */
export function salonCsv(seed = 2): string {
  const { customers: cs, orders } = simulate(BUSINESSES.salon, seed);
  return csv(
    ['Member #', 'Client', 'Visit Date', 'Service', 'Paid'],
    orders.map((o) => {
      const c = cs[o.customer]!;
      return [`M${1000 + c.index}`, `${c.first} ${c.last}`, fmt.mdy(o.day), o.category, o.amount.toFixed(2)];
    }),
  );
}

/** Travel: no customer ID (forces email fallback), day-first dates, sparse repeats. */
export function travelCsv(seed = 3): string {
  const { customers: cs, orders } = simulate(BUSINESSES.travel, seed);
  return csv(
    ['Booking Ref', 'Traveller', 'Email', 'Booking Date', 'Destination', 'Total Price'],
    orders.map((o, i) => {
      const c = cs[o.customer]!;
      return [`BK${70000 + i}`, `${c.first} ${c.last}`, email(c), fmt.dmy(o.day), o.category, o.amount.toFixed(2)];
    }),
  );
}

/**
 * Messy: odd headers, line items (repeated order numbers), Grand Total sometimes blank (use Qty × Unit
 * Price), $ and € signs, European decimals, (12.50) refunds, mixed date formats (mostly day-first),
 * blank rows, rows missing a customer, and ID case/whitespace noise.
 */
export function messyCsv(seed = 4): string {
  const rng = new Rng(seed + 1000);
  const { customers: cs, orders } = simulate({ ...BUSINESSES.onlineStore, customers: 600 }, seed);
  const rows: (string | number)[][] = [];

  const money = (v: number) => {
    const r = rng.float();
    if (r < 0.15) {
      // European: 1.234,56 or 12,50
      const [int, dec] = Math.abs(v).toFixed(2).split('.');
      const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      return `${v < 0 ? '-' : ''}€${grouped},${dec}`;
    }
    if (r < 0.6) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return v.toFixed(2);
  };
  const date = (day: number) => {
    const r = rng.float();
    if (r < 0.7) return fmt.dmy(day);
    if (r < 0.92) return fmt.iso(day);
    return fmt.text(day);
  };
  const noisyId = (i: number) => {
    const id = custId(i);
    const r = rng.float();
    if (r < 0.1) return id.toLowerCase();
    if (r < 0.2) return ` ${id} `;
    return id;
  };

  orders.forEach((o, i) => {
    const c = cs[o.customer]!;
    const orderNo = `#${50000 + i}`;
    const items = rng.int(1, 3);
    const day = date(o.day);
    let remaining = o.amount;
    for (let j = 0; j < items; j++) {
      const lineTotal = j === items - 1 ? Math.round(remaining * 100) / 100 : Math.round((o.amount / items) * 100) / 100;
      remaining -= lineTotal;
      const qty = rng.int(1, 3);
      const unit = Math.round((lineTotal / qty) * 100) / 100;
      const total = Math.round(unit * qty * 100) / 100;
      const missingTotal = rng.chance(0.15);
      const missingCustomer = rng.chance(0.01);
      rows.push([
        missingCustomer ? '' : noisyId(c.index),
        day,
        orderNo,
        rng.pick(BUSINESSES.onlineStore.categories),
        qty,
        money(unit),
        missingTotal ? '' : money(total),
        email(c),
      ]);
    }
    // Occasional refund on a past order.
    if (rng.chance(0.03)) {
      const refund = Math.round(o.amount * 0.5 * 100) / 100;
      rows.push([noisyId(c.index), date(o.day + rng.int(2, 20)), `#R${50000 + i}`, 'Refund', 1, '', `(${refund.toFixed(2)})`, email(c)]);
    }
    if (rng.chance(0.01)) rows.push(['', '', '', '', '', '', '', '']);
  });

  return csv([' Cust # ', 'Txn Dt', 'Order No', 'Item', 'Qty', 'Unit Price', 'Grand Total', 'E-mail'], rows);
}

// ---------- CLI ----------

function main() {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'samples');
  mkdirSync(outDir, { recursive: true });
  const write = (name: string, content: string) => {
    writeFileSync(join(outDir, name), content);
    console.log(`wrote ${name} (${content.split('\n').length - 2} rows)`);
  };

  write('online-store.csv', onlineStoreCsv());
  write('hair-salon.csv', salonCsv());
  write('travel-agency.csv', travelCsv());
  write('messy.csv', messyCsv());

  const rowsFlag = process.argv.indexOf('--rows');
  if (rowsFlag !== -1) {
    const target = Number(process.argv[rowsFlag + 1]);
    // Calibrate customers → rows from the default simulation's orders-per-customer.
    const sample = simulate(BUSINESSES.onlineStore, 5);
    const perCustomer = sample.orders.length / sample.customers.length;
    write(`online-store-${Math.round(target / 1000)}k.csv`, onlineStoreCsv(5, Math.round(target / perCustomer)));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
