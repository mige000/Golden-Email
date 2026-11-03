import Papa from 'papaparse';
import type { RawTable } from './types';

/** Parse CSV text into headers + rows. Blank rows are kept so cleaning can report them. */
export function parseCsv(text: string): RawTable {
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: false });
  const data = result.data;
  // A trailing newline produces one empty row; that isn't a "blank row" in the user's file.
  while (data.length > 0 && data[data.length - 1]!.every((c) => c.trim() === '')) data.pop();
  const [headerRow = [], ...rest] = data;
  const headers = headerRow.map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = rest.map((r) =>
    r.length === headers.length ? r : headers.map((_, i) => r[i] ?? ''),
  );
  return { headers, rows };
}
