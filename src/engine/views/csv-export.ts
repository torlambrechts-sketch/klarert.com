// "Export to CSV" from the Table (docs/18 §5): the shown items, or the selected ones from the bulk bar, with display
// values (labels and names, never ids), in the shown columns' order. Restricted fields read "Restricted". Pure.
import { toCsv } from '../audit/csv';
import type { Ctx, Field, Item } from '../types';
import { defOf, visibleTextOf } from '../values';

/** The CSV text: ID, the item label ("Item"), then one column per field that holds a value. */
export function itemsCsv(fields: Field[], items: Item[], ctx: Ctx, itemLabel = 'Item'): string {
  const cols = fields.filter((f) => defOf(f).storage !== 'none');
  const head = ['ID', itemLabel, ...cols.map((f) => f.name)];
  const rows = items.map((it) => [
    it.displayId,
    it.name,
    ...cols.map((f) => visibleTextOf(it, f, ctx)),
  ]);
  return toCsv([head, ...rows], { bom: true });
}

/** A file name for the export: the sheet's name and the date, in plain characters. */
export function csvFileName(sheetName: string, today: string): string {
  const base = sheetName
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${base || 'sheet'}-${today}.csv`;
}
