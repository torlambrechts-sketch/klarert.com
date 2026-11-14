// Built-in formula functions (docs/03 §7). Names are matched case-insensitively.
import { addDays, addMonths, daysBetween, isIsoDate } from '../fields/helpers';

export type FormulaValue = number | string | boolean;
export type FormulaErrorCode = '#REF' | '#LOOP' | '#ERR' | '#DIV0';
/** Errors are values, not exceptions; they propagate through operators and functions. */
export interface FormulaError {
  error: FormulaErrorCode;
  message?: string;
}

export const formulaError = (error: FormulaErrorCode, message?: string): FormulaError =>
  message === undefined ? { error } : { error, message };

export const isFormulaError = (v: unknown): v is FormulaError =>
  typeof v === 'object' &&
  v !== null &&
  'error' in v &&
  typeof (v as FormulaError).error === 'string';

const NUMERIC = /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i;
export const isNumericText = (s: string) => NUMERIC.test(s);

/** Numbers, booleans and numeric text count as numbers; "" is not. */
export const isNumberLike = (v: FormulaValue) =>
  typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && isNumericText(v));

/** Arithmetic coercion: "" is 0, TRUE is 1, text that is not a number is an error. */
export function toNum(v: FormulaValue): number | FormulaError {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === '') return 0;
  if (isNumericText(v)) return Number(v);
  return formulaError('#ERR', `"${v}" is not a number`);
}

export function textOf(v: FormulaValue): string {
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

export function truthy(v: FormulaValue): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (isNumericText(v)) return Number(v) !== 0;
  return v !== '';
}

export interface FunctionEnv {
  today: string;
}

export interface FormulaFunction {
  minArgs: number;
  /** Infinity for variadic functions. */
  maxArgs: number;
  /** IF is lazy and handled by the evaluator; every other function gets evaluated, error-free arguments. */
  call?(args: FormulaValue[], env: FunctionEnv): FormulaValue | FormulaError;
}

function numbers(args: FormulaValue[]): number[] | FormulaError {
  const out: number[] = [];
  for (const a of args) {
    if (a === '') continue; // blanks are skipped, as in spreadsheets
    const n = toNum(a);
    if (isFormulaError(n)) return n;
    out.push(n);
  }
  return out;
}

function roundTo(x: number, d: number): number {
  const sign = x < 0 ? -1 : 1;
  const r = Number(`${Math.round(Number(`${Math.abs(x)}e${d}`))}e${-d}`);
  return sign * r;
}

function dateArg(v: FormulaValue): string | '' | FormulaError {
  if (v === '') return '';
  return typeof v === 'string' && isIsoDate(v)
    ? v
    : formulaError('#ERR', 'Expected a date (YYYY-MM-DD)');
}

export const FUNCTIONS: Record<string, FormulaFunction> = {
  IF: { minArgs: 2, maxArgs: 3 },
  AND: { minArgs: 1, maxArgs: Infinity, call: (args) => args.every(truthy) },
  OR: { minArgs: 1, maxArgs: Infinity, call: (args) => args.some(truthy) },
  NOT: { minArgs: 1, maxArgs: 1, call: ([x]) => !truthy(x!) },
  ROUND: {
    minArgs: 1,
    maxArgs: 2,
    call: ([x, d]) => {
      const n = toNum(x!);
      const p = d === undefined ? 0 : toNum(d);
      if (isFormulaError(n)) return n;
      if (isFormulaError(p)) return p;
      return roundTo(n, Math.trunc(p));
    },
  },
  ABS: {
    minArgs: 1,
    maxArgs: 1,
    call: ([x]) => {
      const n = toNum(x!);
      return isFormulaError(n) ? n : Math.abs(n);
    },
  },
  MIN: {
    minArgs: 1,
    maxArgs: Infinity,
    call: (args) => {
      const ns = numbers(args);
      if (isFormulaError(ns)) return ns;
      return ns.length ? Math.min(...ns) : '';
    },
  },
  MAX: {
    minArgs: 1,
    maxArgs: Infinity,
    call: (args) => {
      const ns = numbers(args);
      if (isFormulaError(ns)) return ns;
      return ns.length ? Math.max(...ns) : '';
    },
  },
  TODAY: { minArgs: 0, maxArgs: 0, call: (_args, env) => env.today },
  DAYS: {
    minArgs: 2,
    maxArgs: 2,
    call: ([a, b]) => {
      const da = dateArg(a!);
      const db = dateArg(b!);
      if (isFormulaError(da)) return da;
      if (isFormulaError(db)) return db;
      return da === '' || db === '' ? '' : daysBetween(da, db);
    },
  },
  ADDDAYS: {
    minArgs: 2,
    maxArgs: 2,
    call: ([d, n]) => {
      const date = dateArg(d!);
      if (isFormulaError(date)) return date;
      const days = toNum(n!);
      if (isFormulaError(days)) return days;
      return date === '' ? '' : addDays(date, Math.trunc(days));
    },
  },
  /** Calendar months; a day past the target month's end clamps to its last day (31 Jan + 1 → 28 Feb). */
  ADDMONTHS: {
    minArgs: 2,
    maxArgs: 2,
    call: ([d, n]) => {
      const date = dateArg(d!);
      if (isFormulaError(date)) return date;
      const months = toNum(n!);
      if (isFormulaError(months)) return months;
      return date === '' ? '' : addMonths(date, Math.trunc(months));
    },
  },
  CONCAT: { minArgs: 0, maxArgs: Infinity, call: (args) => args.map(textOf).join('') },
  LEN: { minArgs: 1, maxArgs: 1, call: ([x]) => textOf(x!).length },
  EMPTY: { minArgs: 1, maxArgs: 1, call: ([x]) => x === '' },
};

export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

export function lookupFunction(name: string): FormulaFunction | undefined {
  return FUNCTIONS[name.toUpperCase()];
}
