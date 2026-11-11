// CSV import (templates/starts.json rules.csvTypes, docs/01 FR-6). Pure: text in, table, types and item values out.
// The first row holds the field names; the first column is the item name; every other column becomes a field.
import Papa from 'papaparse';
import type { Ctx, Json, LabelColor } from '../types';
import { parseDate, parseNumber } from './helpers';
import { fieldType } from './registry';

export const CSV_LIMITS = { rows: 10_000, columns: 100, bytes: 10 * 1024 * 1024 } as const;

export interface CsvTable {
  /** Header row, one name per column (column 0 is the item name). */
  header: string[];
  /** Body rows, every row padded to the header length, cells trimmed. */
  rows: string[][];
}

export type CsvParse = { ok: true; table: CsvTable } | { ok: false; message: string };

const MAX_NAME = 500;
const MAX_FIELD_NAME = 80;

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Parse CSV text (comma, semicolon or tab separated; quoted cells) and check the limits. */
export function parseCsv(text: string): CsvParse {
  if (byteLength(text) > CSV_LIMITS.bytes)
    return { ok: false, message: 'The file is larger than 10 MB. Split it and import the parts.' };
  const src = text.replace(/^﻿/, '');
  if (!src.trim()) return { ok: false, message: 'Paste CSV text or choose a file first.' };
  const parsed = Papa.parse<string[]>(src, { skipEmptyLines: 'greedy' });
  const all = parsed.data.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (all.length === 0) return { ok: false, message: 'Paste CSV text or choose a file first.' };
  const width = Math.max(...all.map((r) => r.length));
  if (width > CSV_LIMITS.columns)
    return {
      ok: false,
      message: `The file has ${width} columns. Import at most ${CSV_LIMITS.columns}.`,
    };
  if (all.length - 1 > CSV_LIMITS.rows)
    return {
      ok: false,
      message: `The file has ${(all.length - 1).toLocaleString('en-GB')} rows. Import at most ${CSV_LIMITS.rows.toLocaleString('en-GB')}.`,
    };
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => String(r[i] ?? '').trim());
  const header = pad(all[0]!).map((h, i) =>
    (h || (i === 0 ? 'Name' : `Column ${i + 1}`)).slice(0, MAX_FIELD_NAME),
  );
  return { ok: true, table: { header, rows: all.slice(1).map(pad) } };
}

/** The types CSV detection can produce, in the order they are tried. */
export const CSV_DETECTED_TYPES = [
  'date',
  'number',
  'email',
  'url',
  'yesno',
  'dropdown',
  'text',
] as const;
export type CsvDetectedType = (typeof CSV_DETECTED_TYPES)[number];

const YESNO = /^(yes|no|true|false|1|0)$/i;
const URLISH = /^(https?:\/\/\S+|www\.\S+|[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?)$/i;
const PURE_NUMBER = /^[+-]?\d+([.,]\d+)?$/;

const isDate = (v: string) => !PURE_NUMBER.test(v) && parseDate(v) !== null;
const isEmail = (v: string) => fieldType('email')!.parseText(v, {}, undefined as never) !== null;
const isUrl = (v: string) =>
  URLISH.test(v) && fieldType('url')!.parseText(v, {}, undefined as never) !== null;

/**
 * Per column: all dates → date; all numbers → number; all emails → email; all URLs → url; yes/no/true/false/1/0 →
 * yesno; ≤ 12 distinct values and ≥ 2 repeats → dropdown; otherwise text. Empty cells are ignored.
 */
export function detectColumnType(cells: readonly string[]): CsvDetectedType {
  const values = cells.map((c) => c.trim()).filter(Boolean);
  if (values.length === 0) return 'text';
  if (values.every(isDate)) return 'date';
  if (values.every((v) => parseNumber(v) !== null)) return 'number';
  if (values.every(isEmail)) return 'email';
  if (values.every(isUrl)) return 'url';
  if (values.every((v) => YESNO.test(v))) return 'yesno';
  const distinct = new Set(values).size;
  if (distinct <= 12 && values.length - distinct >= 2) return 'dropdown';
  return 'text';
}

export interface CsvColumn {
  /** Column index in the table (≥ 1). */
  index: number;
  name: string;
  type: string;
}

/** Suggested fields for a table: every column after the first, with its detected type. */
export function planColumns(table: CsvTable): CsvColumn[] {
  return table.header.slice(1).map((name, i) => ({
    index: i + 1,
    name,
    type: detectColumnType(table.rows.map((r) => r[i + 1] ?? '')),
  }));
}

/** Types a CSV column can be imported as: types whose value is stored on the item. */
export function csvImportable(typeId: string): boolean {
  return fieldType(typeId)?.storage === 'values';
}

const OPTION_COLORS: LabelColor[] = [
  'blue',
  'green',
  'orange',
  'purple',
  'teal',
  'pink',
  'navy',
  'yellow',
  'red',
  'dark',
  'grey',
];

/** Field config for an imported column: dropdown options come from the column's distinct values. */
export function columnConfig(
  typeId: string,
  cells: readonly string[],
  newId: (prefix: string) => string,
): Json {
  const def = fieldType(typeId);
  if (!def) throw new Error(`unknown field type ${typeId}`);
  if (typeId === 'dropdown') {
    const seen = new Map<string, string>();
    for (const c of cells) {
      const label = c.trim().slice(0, 80);
      if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
    }
    if (seen.size > 0)
      return {
        options: [...seen.values()].map((label, i) => ({
          id: newId('opt_'),
          label,
          color: OPTION_COLORS[i % OPTION_COLORS.length]!,
        })),
      };
  }
  return def.defaultConfig() as Json;
}

export interface CsvField {
  /** Column index in the table (≥ 1). */
  index: number;
  fieldId: string;
  type: string;
  config: unknown;
}

export interface CsvItem {
  name: string;
  values: Record<string, Json>;
}

/**
 * Rows to item names and values through each type's parseText. A cell that does not parse is left empty and counted.
 */
export function rowsToItems(
  table: CsvTable,
  fields: readonly CsvField[],
  ctx: Ctx,
): { items: CsvItem[]; skippedCells: number } {
  let skippedCells = 0;
  const defs = fields.map((f) => {
    const def = fieldType(f.type);
    if (!def) throw new Error(`unknown field type ${f.type}`);
    return { ...f, def };
  });
  const items = table.rows.map((row) => {
    const values: Record<string, Json> = {};
    for (const f of defs) {
      const raw = row[f.index]?.trim() ?? '';
      if (!raw) continue;
      const v = f.def.parseText(raw, f.config, ctx);
      if (v === null || v === undefined || f.def.isEmpty(v)) skippedCells += 1;
      else values[f.fieldId] = v as Json;
    }
    const name = (row[0]?.trim() || 'Untitled').slice(0, MAX_NAME);
    return { name, values };
  });
  return { items, skippedCells };
}
