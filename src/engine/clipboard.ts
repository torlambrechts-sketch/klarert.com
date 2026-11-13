// Copy and paste between grid cells and Excel/Sheets as TSV (docs/01 FR-21), and clearing a range. Pure: every
// pasted cell goes through its field type's parseText; nothing is written here.
import type { ValueKind } from './fields/types';
import type { Ctx, Field, Item, Json } from './types';
import { defOf, kindOf, textOf } from './values';

/**
 * A grid column: the item name, a field, or the stub of a collapsed column group (docs/05 §3.1). Stubs only stand in
 * for their group's columns: copy, paste and clear skip them.
 */
export type GridColumn =
  | { kind: 'name' }
  | { kind: 'field'; field: Field }
  | { kind: 'stub'; groupId: string; name: string; fields: Field[] };

/** The columns a selection runs over: everything but stubs. */
export const cellColumns = <C extends GridColumn>(columns: readonly C[]) =>
  columns.filter((c): c is Exclude<C, { kind: 'stub' }> => c.kind !== 'stub');

export interface CellRange {
  /** Inclusive row and column indexes into the visible rows and columns. */
  top: number;
  left: number;
  bottom: number;
  right: number;
}

const needsQuotes = /[\t\n\r"]/;
const quote = (s: string) => (needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Rows of cells → TSV (Excel quoting for tabs, line breaks and quotes). */
export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.map(quote).join('\t')).join('\n');
}

/** TSV → rows of cells. Handles quoted cells with tabs, line breaks and doubled quotes; drops one trailing newline. */
export function parseTsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let quoted = false;
  let atStart = true;
  while (i < src.length) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        quoted = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"' && atStart) {
      quoted = true;
      atStart = false;
      i += 1;
      continue;
    }
    if (c === '\t') {
      row.push(cell);
      cell = '';
      atStart = true;
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      atStart = true;
    } else {
      cell += c;
      atStart = false;
    }
    i += 1;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** The text of one cell, as copy puts it on the clipboard. */
export function cellText(item: Item, column: GridColumn, ctx: Ctx): string {
  if (column.kind === 'stub') return '';
  return column.kind === 'name' ? item.name : textOf(item, column.field, ctx);
}

export function copyRange(rows: Item[], all: GridColumn[], range: CellRange, ctx: Ctx): string {
  const columns = cellColumns(all);
  const out: string[][] = [];
  for (let r = range.top; r <= range.bottom; r += 1) {
    const item = rows[r];
    if (!item) continue;
    const line: string[] = [];
    for (let c = range.left; c <= range.right; c += 1) {
      const col = columns[c];
      if (col) line.push(cellText(item, col, ctx));
    }
    out.push(line);
  }
  return toTsv(out);
}

const REASONS: Partial<Record<ValueKind, string>> = {
  number: 'not a number',
  date: 'not a date',
  daterange: 'not a date range',
  option: 'not one of the options',
  ordered: 'not one of the options',
  multi: 'not one of the options',
  people: 'not a person in this workspace',
  boolean: 'not yes or no',
  text: 'not valid here',
};

export interface CellWrites {
  /** item id → new name */
  names: Map<string, string>;
  /** item id → field id → value (null clears) */
  values: Map<string, Record<string, Json | null>>;
  written: number;
  skipped: string[];
  /** "8 cells pasted, 1 skipped: not a date" */
  message: string;
}

export interface PasteOptions {
  /** False for locked items the caller may not edit. */
  canEdit: (item: Item) => boolean;
}

const cells = (n: number) => `${n} ${n === 1 ? 'cell' : 'cells'}`;

function summary(verb: string, written: number, skipped: string[]): string {
  const head = `${cells(written)} ${verb}`;
  if (skipped.length === 0) return head;
  const reasons = [...new Set(skipped)].join('; ');
  return `${head}, ${skipped.length} skipped: ${reasons}`;
}

type CellColumn = Exclude<GridColumn, { kind: 'stub' }>;

function writable(column: CellColumn): boolean {
  return column.kind === 'name' || defOf(column.field).storage === 'values';
}

function put(out: CellWrites, item: Item, column: CellColumn, value: Json | null | string) {
  if (column.kind === 'name') {
    out.names.set(item.id, value as string);
  } else {
    const patch = out.values.get(item.id) ?? {};
    patch[column.field.id] = value as Json | null;
    out.values.set(item.id, patch);
  }
  out.written += 1;
}

/**
 * Plan a paste of `text` at the top-left of `range`. A single copied cell fills the whole range (as in Excel);
 * otherwise the clipboard is laid out from the top-left and cut at the last row and column.
 */
export function planPaste(
  text: string,
  rows: Item[],
  all: GridColumn[],
  range: CellRange,
  ctx: Ctx,
  opts: PasteOptions,
): CellWrites {
  const columns = cellColumns(all);
  const matrix = parseTsv(text);
  const single = matrix.length === 1 && matrix[0]!.length === 1;
  const height = single ? range.bottom - range.top + 1 : matrix.length;
  const width = single ? range.right - range.left + 1 : Math.max(...matrix.map((r) => r.length));
  const out: CellWrites = {
    names: new Map(),
    values: new Map(),
    written: 0,
    skipped: [],
    message: '',
  };

  for (let dr = 0; dr < height; dr += 1) {
    const item = rows[range.top + dr];
    if (!item) break;
    for (let dc = 0; dc < width; dc += 1) {
      const column = columns[range.left + dc];
      if (!column) break;
      const raw = single ? matrix[0]![0]! : matrix[dr]?.[dc];
      if (raw === undefined) continue;
      if (!opts.canEdit(item)) {
        out.skipped.push('item locked');
        continue;
      }
      if (!writable(column)) {
        out.skipped.push('read-only column');
        continue;
      }
      const t = raw.trim();
      if (column.kind === 'name') {
        if (!t) out.skipped.push('a name is required');
        else put(out, item, column, t.slice(0, 500));
        continue;
      }
      const field = column.field;
      if (!t) {
        if (field.required) out.skipped.push(`${field.name} is required`);
        else put(out, item, column, null);
        continue;
      }
      const def = defOf(field);
      const v = def.parseText(t, field.config, ctx);
      if (v === null || v === undefined || def.isEmpty(v)) {
        out.skipped.push(REASONS[kindOf(field, ctx)] ?? 'cannot be pasted here');
        continue;
      }
      put(out, item, column, v as Json);
    }
  }
  out.message = summary('pasted', out.written, out.skipped);
  return out;
}

/** Plan clearing a range (Delete): names and required fields are kept, read-only cells skipped. */
export function planClear(
  rows: Item[],
  all: GridColumn[],
  range: CellRange,
  opts: PasteOptions,
): CellWrites {
  const columns = cellColumns(all);
  const out: CellWrites = {
    names: new Map(),
    values: new Map(),
    written: 0,
    skipped: [],
    message: '',
  };
  for (let r = range.top; r <= range.bottom; r += 1) {
    const item = rows[r];
    if (!item) continue;
    for (let c = range.left; c <= range.right; c += 1) {
      const column = columns[c];
      if (!column) continue;
      if (column.kind === 'name') {
        out.skipped.push('a name is required');
        continue;
      }
      const field = column.field;
      const def = defOf(field);
      if (def.storage !== 'values') {
        if (range.top !== range.bottom || range.left !== range.right) continue;
        out.skipped.push('read-only column');
        continue;
      }
      if (item.values[field.id] === undefined) continue;
      if (!opts.canEdit(item)) {
        out.skipped.push('item locked');
        continue;
      }
      if (field.required) {
        out.skipped.push(`${field.name} is required`);
        continue;
      }
      put(out, item, column, null);
    }
  }
  out.message = summary('cleared', out.written, out.skipped);
  return out;
}
