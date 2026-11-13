// CSV for audit outputs (docs/11 Audit outputs): RFC 4180 quoting, CRLF line ends, and cells that a spreadsheet would
// run as a formula (=, +, -, @, tab, carriage return at the start) prefixed with an apostrophe. Plain numbers such as
// "-3" are left as they are. Pure.

const NUMBER = /^[-+]?\d+(\.\d+)?$/;
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  let v = value;
  if (FORMULA.test(v) && !NUMBER.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Rows to CSV text. `bom` starts the text with a byte order mark so spreadsheet apps read it as UTF-8. */
export function toCsv(rows: readonly (readonly string[])[], opts: { bom?: boolean } = {}): string {
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return opts.bom ? `﻿${text}` : text;
}
