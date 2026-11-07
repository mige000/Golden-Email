# Running Golden Email

## Requirements

- Node.js 20.12 or newer (developed on Node 25)
- Optional: a free Google Gemini API key, for AI-written email drafts. Without one, the app uses built-in email templates and everything else works the same.

## Setup

```bash
npm install
cp .env.example .env   # optional: then paste your key after GEMINI_API_KEY=
```

Get a Gemini key at <https://aistudio.google.com/apikey>. The key is only read by the server. It is never sent to the browser or logged. `.env` is gitignored.

## Run

```bash
npm run dev
```

Open <http://localhost:5173>. This starts the web app (Vite) and the small API server (port 8787) together.

To run as a single server, the way you'd deploy it:

```bash
npm run build
npm start          # app + API on http://localhost:8787
```

The app works without the API server: `npm run dev:client` runs the web app alone, and email drafts fall back to templates.

## Try it

On the first screen, pick a sample instead of uploading a file:

| Sample | What it shows |
|---|---|
| **CD store** | Real purchase history (1997–98, 23,570 customers). The data is old, so try **Plan as of** on the "Check your data" step to see the plan at an earlier date. |
| **Online store** | A clean export, one row per order. |
| **Hair salon** | Month-first dates and frequent visits. |
| **Travel agency** | No customer ID column (customers are matched by email), and few repeat customers, so the app asks how often customers come back. |
| **Messy file** | Odd headers, `$`/`€` and European decimals, mixed date formats, line items, refunds and blank rows: shows the column mapping and cleaning. |

Your own CSV needs one row per purchase with **who** bought, **when**, and **how much**. Column names don't matter.

## All commands

| Command | What it does |
|---|---|
| `npm run dev` | Web app + API with live reload |
| `npm run dev:client` | Web app only (no AI drafts) |
| `npm run build` | Typecheck and build the web app into `dist/` |
| `npm start` | Serve the built app + API on one port (needs `npm run build` first) |
| `npm test` | Run the unit tests (Vitest) |
| `npm run typecheck` | TypeScript check only |
| `npm run generate-data` | Regenerate the synthetic sample CSVs (deterministic). Add `-- --rows 50000` for a large performance-test file. |

## How it's put together

```
client/src/lib/          Pure TypeScript, no React, all unit-tested
  csv.ts mapping.ts        Read the CSV; guess what each column means (with reasons + confidence)
  clean.ts                 Parse dates/amounts, merge line items, handle refunds; cleaning report
  customers.ts             Per-customer recency, orders, spend; typical purchase gap
  segments.ts              Rule-based groups + plain-English reasons
  backtest.ts              "Buy anyway" rate per group, measured at past dates
  economics.ts             Uplift model, profit vs. discount, recommendation, break-even
  plan.ts holdout.ts       The weekly plan, test-group split
  export.ts email.ts       CSV export; email templates + call to the drafting API
client/src/components/   The screens (React + Tailwind; charts with Recharts)
client/src/useDerived.ts Settings → memoised pipeline (the backtest only re-runs when it has to)
client/public/samples/   Sample CSVs
server/                  Express: POST /api/draft-email (Google Gemini), GET /api/health
scripts/generate-data.ts Synthetic data generator
```

All the analysis runs in the browser, so customer data never leaves it. The only thing sent to the server, and from there to Gemini, is a group-level description (group name, its rule, the offer, the tone). Email drafts use merge fields like `{{first_name}}` instead of real names. On Gemini's free tier, Google may use what is sent to improve its products.

## Troubleshooting

- **"AI drafting isn't set up"**: `GEMINI_API_KEY` is missing from `.env`. Restart `npm run dev` after adding it.
- **"Check GEMINI_API_KEY"**: Gemini rejected the key. Check it was copied completely.
- **"The free AI quota is used up for now"**: the free tier is rate-limited. Wait a minute, or use the template that's already shown.
- **Port already in use**: something else is on 5173 or 8787. Stop it, or run the API with `PORT=8788 npm start`.
