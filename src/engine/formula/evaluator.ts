// AST evaluator (docs/03 §7). Independent of field types: references resolve through the env.
import {
  type FormulaError,
  type FormulaValue,
  formulaError,
  isFormulaError,
  isNumberLike,
  lookupFunction,
  textOf,
  toNum,
  truthy,
} from './functions';
import type { BinaryOp, Node } from './parser';

export interface FormulaEnv {
  /** Value of `{key}`: a number, an ISO date, text ("" when empty) or an error such as #REF. */
  ref(key: string): FormulaValue | FormulaError;
  /** ISO date for TODAY(). */
  today: string;
}

export type FormulaResult = FormulaValue | FormulaError;

export function evaluate(node: Node, env: FormulaEnv): FormulaResult {
  switch (node.type) {
    case 'num':
    case 'str':
    case 'bool':
      return node.value;
    case 'ref':
      return env.ref(node.key);
    case 'neg': {
      const v = evaluate(node.arg, env);
      if (isFormulaError(v)) return v;
      const n = toNum(v);
      return isFormulaError(n) ? n : -n;
    }
    case 'binary': {
      const l = evaluate(node.left, env);
      if (isFormulaError(l)) return l;
      const r = evaluate(node.right, env);
      if (isFormulaError(r)) return r;
      return binary(node.op, l, r);
    }
    case 'call':
      return call(node.name, node.args, env);
  }
}

function call(name: string, argNodes: Node[], env: FormulaEnv): FormulaResult {
  if (name === 'IF') {
    const cond = evaluate(argNodes[0]!, env);
    if (isFormulaError(cond)) return cond;
    const branch = truthy(cond) ? argNodes[1] : argNodes[2];
    return branch ? evaluate(branch, env) : '';
  }
  const fn = lookupFunction(name);
  if (!fn?.call) return formulaError('#ERR', `Unknown function ${name}`);
  if (argNodes.length < fn.minArgs || argNodes.length > fn.maxArgs) return formulaError('#ERR', `Wrong number of arguments for ${name}`);
  const args: FormulaValue[] = [];
  for (const a of argNodes) {
    const v = evaluate(a, env);
    if (isFormulaError(v)) return v;
    args.push(v);
  }
  return finite(fn.call(args, { today: env.today }));
}

function finite(v: FormulaResult): FormulaResult {
  return typeof v === 'number' && !Number.isFinite(v) ? formulaError('#ERR', 'The result is not a finite number') : v;
}

function arithmetic(a: FormulaValue, b: FormulaValue, f: (x: number, y: number) => FormulaResult): FormulaResult {
  const x = toNum(a);
  if (isFormulaError(x)) return x;
  const y = toNum(b);
  if (isFormulaError(y)) return y;
  return finite(f(x, y));
}

const isText = (v: FormulaValue) => typeof v === 'string' && v !== '' && !isNumberLike(v);

function compare(a: FormulaValue, b: FormulaValue): number {
  if (isNumberLike(a) && isNumberLike(b)) {
    const x = toNum(a) as number;
    const y = toNum(b) as number;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = textOf(a);
  const y = textOf(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function binary(op: BinaryOp, a: FormulaValue, b: FormulaValue): FormulaResult {
  switch (op) {
    case '+':
      if (isText(a) || isText(b)) return textOf(a) + textOf(b);
      return arithmetic(a, b, (x, y) => x + y);
    case '-':
      return arithmetic(a, b, (x, y) => x - y);
    case '*':
      return arithmetic(a, b, (x, y) => x * y);
    case '/':
      return arithmetic(a, b, (x, y) => (y === 0 ? formulaError('#DIV0') : x / y));
    case '%':
      return arithmetic(a, b, (x, y) => (y === 0 ? formulaError('#DIV0') : x % y));
    case '&':
      return textOf(a) + textOf(b);
    case '=':
      return compare(a, b) === 0;
    case '<>':
      return compare(a, b) !== 0;
    case '<':
      return compare(a, b) < 0;
    case '>':
      return compare(a, b) > 0;
    case '<=':
      return compare(a, b) <= 0;
    case '>=':
      return compare(a, b) >= 0;
  }
}
