// Public API of the formula language (docs/03 §7). Pure; no eval, no new Function.
import { isIsoDate } from '../fields/helpers';
import { type FormulaEnv, type FormulaResult, evaluate } from './evaluator';
import {
  type FormulaError,
  type FormulaValue,
  formulaError,
  isFormulaError,
  isNumericText,
  truthy,
} from './functions';
import { type Node, type ParseResult, parse, referencedKeysOf } from './parser';

export type { FormulaEnv, FormulaResult, Node as FormulaAst, ParseResult };
export type { FormulaError, FormulaErrorCode, FormulaValue } from './functions';
export { FUNCTION_NAMES, formulaError, isFormulaError } from './functions';

export type FormulaResultType = 'auto' | 'number' | 'text' | 'date' | 'boolean';

/** References that are not fields: item name, display id and group name. */
export const SPECIAL_REFS = ['name', 'id', 'group'] as const;
export const isSpecialRef = (key: string) =>
  (SPECIAL_REFS as readonly string[]).includes(key.toLowerCase());

export function parseFormula(src: string): ParseResult {
  return parse(src);
}

/** Evaluates source or a parsed AST. An empty formula gives "". Syntax errors give #ERR. */
export function evaluateFormula(src: string | Node, env: FormulaEnv): FormulaResult {
  if (typeof src === 'string') {
    if (src.trim() === '') return '';
    const parsed = parse(src);
    if (!parsed.ok) return formulaError('#ERR', parsed.message);
    return evaluate(parsed.ast, env);
  }
  return evaluate(src, env);
}

/** Field keys referenced by a formula (without name/id/group), for dependencies, cycles and autocomplete. */
export function referencedKeys(src: string): string[] {
  return referencedKeysOf(src).filter((k) => !isSpecialRef(k));
}

const ISO_DATE = /^\d{4}-\d\d-\d\d$/;

/** Applies the configured result type to a raw result. "" stays "" (empty). */
export function coerceResult(v: FormulaResult, result: FormulaResultType): FormulaResult {
  if (isFormulaError(v) || v === '') return v;
  switch (result) {
    case 'auto':
      return typeof v === 'string' && isNumericText(v) ? Number(v) : v;
    case 'number':
      if (typeof v === 'number') return v;
      if (typeof v === 'boolean') return v ? 1 : 0;
      return isNumericText(v) ? Number(v) : formulaError('#ERR', 'The result is not a number');
    case 'text':
      return typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
    case 'date':
      return typeof v === 'string' && ISO_DATE.test(v) && isIsoDate(v)
        ? v
        : formulaError('#ERR', 'The result is not a date');
    case 'boolean':
      return truthy(v);
  }
}

/** Value as stored/shown by the formula field: errors become their "#…" code. */
export function resultToValue(v: FormulaResult): FormulaValue {
  return isFormulaError(v) ? v.error : v;
}
