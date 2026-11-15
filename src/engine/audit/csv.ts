// CSV for audit outputs (docs/11 Audit outputs) and the formula escaping grid copy shares (SA-11): RFC 4180 quoting,
// CRLF line ends, and cells that a spreadsheet would
// run as a formula (=, +, -, @, tab, carriage return at the start) prefixed with an apostrophe. Plain numbers such as
// "-3" are left as they are. Pure.

const NUMBER = /^[-+]?\d+(\.\d+)?$/;
const FORMULA = /^[=+\-@\t\r]/;

/**
 * A cell a spreadsheet would run as a formula, with an apostrophe in front so it shows as text. Plain numbers stay
 * as they are. Shared by CSV exports and grid copy (src/engine/clipboard.ts, SA-11).
 */
export function escapeFormula(value: string): string {
  return FORMULA.test(value) && !NUMBER.test(value) ? `'${value}` : value;
}

/** A cell as escapeFormula wrote it, without the apostrophe: pasting a copied cell back gives the value it had. */
export function unescapeFormula(value: string): string {
  return value.startsWith("'") && escapeFormula(value.slice(1)) === value ? value.slice(1) : value;
}

export function csvCell(value: string): string {
  const v = escapeFormula(value);
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Rows to CSV text. `bom` starts the text with a byte order mark so spreadsheet apps read it as UTF-8. */
export function toCsv(rows: readonly (readonly string[])[], opts: { bom?: boolean } = {}): string {
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return opts.bom ? `﻿${text}` : text;
}
