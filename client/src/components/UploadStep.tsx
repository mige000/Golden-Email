import { useRef, useState, type DragEvent } from 'react';
import { parseCsv } from '../lib/csv';
import type { BusinessType, RawTable } from '../lib/types';
import { Card, Notice } from './ui';

export interface LoadedDataset {
  name: string;
  table: RawTable;
  businessType: BusinessType | null;
}

interface Sample {
  file: string;
  title: string;
  blurb: string;
  businessType: BusinessType | null;
}

const SAMPLES: Sample[] = [
  { file: 'purchases.csv', title: 'CD store', blurb: 'Real purchase history, 1997–98 · 23,572 customers', businessType: 'online_store' },
  { file: 'online-retail.csv', title: 'Online retail', blurb: 'Real purchase history, 2010-11 · 4,374 customers', businessType: 'online_store' },
  { file: 'online-store.csv', title: 'Online store', blurb: 'Clean export, one row per order (generated)', businessType: 'online_store' },
  { file: 'hair-salon.csv', title: 'Hair salon', blurb: 'Members visiting every few weeks (generated)', businessType: 'salon' },
  { file: 'travel-agency.csv', title: 'Travel agency', blurb: 'Rare trips, no customer ID column (generated)', businessType: 'travel' },
  { file: 'messy.csv', title: 'Messy file', blurb: 'Odd headers, mixed formats, line items (generated)', businessType: 'online_store' },
];

const MAX_BYTES = 50 * 1024 * 1024;

function toDataset(name: string, text: string, businessType: BusinessType | null): LoadedDataset {
  if (!text.trim()) throw new Error('That file is empty.');
  const table = parseCsv(text);
  if (table.headers.length < 2) throw new Error('We couldn’t find columns in that file. Is it a CSV (comma-separated) file?');
  if (table.rows.length === 0) throw new Error('That file has a header row but no data rows.');
  return { name, table, businessType };
}

export function UploadStep({ onLoad }: { onLoad: (d: LoadedDataset) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) return setError('That file is over 50 MB. Try exporting a shorter date range.');
    setBusy(file.name);
    try {
      onLoad(toDataset(file.name, await file.text(), null));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We couldn’t read that file.');
    } finally {
      setBusy(null);
    }
  };

  const loadSample = async (s: Sample) => {
    setError(null);
    setBusy(s.file);
    try {
      const res = await fetch(`/samples/${s.file}`);
      if (!res.ok) throw new Error(`Couldn’t load the ${s.title} sample.`);
      onLoad(toDataset(`${s.title} (sample)`, await res.text(), s.businessType));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load that sample.');
    } finally {
      setBusy(null);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight text-slate-900">Who should you email this week?</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Upload your sales history and get a weekly email plan: who to email, what to say, and whether a
          discount will actually make you money.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? 'border-emerald-500 bg-emerald-50' : 'border-slate-300 bg-surface'
        }`}
      >
        <p className="text-base font-medium text-slate-900">Drop your sales CSV here</p>
        <p className="mt-1 text-sm text-slate-500">
          One row per purchase, with <strong>who</strong> bought, <strong>when</strong>, and <strong>how much</strong>.
          Column names don’t matter; we’ll figure them out.
        </p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-on-accent hover:bg-emerald-500"
        >
          {busy && !SAMPLES.some((s) => s.file === busy) ? 'Reading…' : 'Choose a file'}
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
            e.target.value = '';
          }}
        />
        <p className="mt-3 text-xs text-slate-400">Your data stays in your browser. Nothing is uploaded to a server.</p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <Card>
        <h2 className="text-sm font-semibold text-slate-900">No file handy? Try a sample</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SAMPLES.map((s) => (
            <button
              key={s.file}
              type="button"
              disabled={busy !== null}
              onClick={() => void loadSample(s)}
              className="rounded-lg border border-slate-200 p-3 text-left transition hover:border-emerald-500 hover:bg-emerald-50/50 disabled:opacity-60"
            >
              <span className="block text-sm font-medium text-slate-900">{busy === s.file ? 'Loading…' : s.title}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{s.blurb}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
