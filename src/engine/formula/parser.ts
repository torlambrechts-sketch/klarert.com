// Recursive-descent parser: tokens → AST (docs/03 §7).
// Precedence, lowest first: comparison, &, + -, * / %, unary minus, primary.
import { lookupFunction } from './functions';
import { type Operator, type Token, tokenize } from './tokenizer';

export type BinaryOp = Operator;

export type Node =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'ref'; key: string }
  | { type: 'neg'; arg: Node }
  | { type: 'binary'; op: BinaryOp; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] };

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: '#ERR'; message: string };

class SyntaxError_ extends Error {}

const COMPARE: readonly Operator[] = ['=', '<>', '<', '>', '<=', '>='];
const ADDITIVE: readonly Operator[] = ['+', '-'];
const MULTIPLICATIVE: readonly Operator[] = ['*', '/', '%'];

export function parse(src: string): ParseResult {
  const t = tokenize(src);
  if (!t.ok) return { ok: false, error: '#ERR', message: t.message };
  if (t.tokens.length === 0) return { ok: false, error: '#ERR', message: 'The formula is empty' };
  try {
    return { ok: true, ast: new Parser(t.tokens).parseAll() };
  } catch (e) {
    if (e instanceof SyntaxError_) return { ok: false, error: '#ERR', message: e.message };
    throw e;
  }
}

class Parser {
  private p = 0;
  constructor(private readonly tokens: Token[]) {}

  parseAll(): Node {
    const node = this.comparison();
    const extra = this.peek();
    if (extra) throw new SyntaxError_(`Unexpected ${describe(extra)}`);
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.p];
  }

  private next(): Token {
    const t = this.tokens[this.p++];
    if (!t) throw new SyntaxError_('The formula ends too early');
    return t;
  }

  private takeOp(ops: readonly Operator[]): Operator | null {
    const t = this.peek();
    if (t?.type === 'op' && ops.includes(t.op)) {
      this.p++;
      return t.op;
    }
    return null;
  }

  private isPunct(v: '(' | ')' | ','): boolean {
    const t = this.peek();
    return t?.type === 'punct' && t.value === v;
  }

  private expect(v: '(' | ')' | ','): void {
    const t = this.next();
    if (t.type !== 'punct' || t.value !== v)
      throw new SyntaxError_(`Expected "${v}" but found ${describe(t)}`);
  }

  private binaryLevel(ops: readonly Operator[], operand: () => Node): Node {
    let left = operand();
    for (let op = this.takeOp(ops); op; op = this.takeOp(ops)) {
      left = { type: 'binary', op, left, right: operand() };
    }
    return left;
  }

  private comparison = (): Node => this.binaryLevel(COMPARE, this.concat);
  private concat = (): Node => this.binaryLevel(['&'], this.additive);
  private additive = (): Node => this.binaryLevel(ADDITIVE, this.multiplicative);
  private multiplicative = (): Node => this.binaryLevel(MULTIPLICATIVE, this.unary);

  private unary = (): Node => {
    if (this.takeOp(['-'])) return { type: 'neg', arg: this.unary() };
    return this.primary();
  };

  private primary(): Node {
    const t = this.next();
    switch (t.type) {
      case 'num':
        return { type: 'num', value: t.value };
      case 'str':
        return { type: 'str', value: t.value };
      case 'ref':
        return { type: 'ref', key: t.key };
      case 'punct':
        if (t.value === '(') {
          const inner = this.comparison();
          this.expect(')');
          return inner;
        }
        throw new SyntaxError_(`Unexpected ${describe(t)}`);
      case 'ident':
        return this.identifier(t.name);
      case 'op':
        throw new SyntaxError_(`Unexpected ${describe(t)}`);
    }
  }

  private identifier(raw: string): Node {
    const name = raw.toUpperCase();
    if ((name === 'TRUE' || name === 'FALSE') && !this.isPunct('('))
      return { type: 'bool', value: name === 'TRUE' };
    const fn = lookupFunction(name);
    if (!fn) throw new SyntaxError_(`Unknown function ${raw}`);
    this.expect('(');
    const args: Node[] = [];
    if (!this.isPunct(')')) {
      args.push(this.comparison());
      while (this.isPunct(',')) {
        this.p++;
        args.push(this.comparison());
      }
    }
    this.expect(')');
    if (args.length < fn.minArgs || args.length > fn.maxArgs) {
      const want =
        fn.minArgs === fn.maxArgs
          ? `${fn.minArgs}`
          : fn.maxArgs === Infinity
            ? `at least ${fn.minArgs}`
            : `${fn.minArgs} to ${fn.maxArgs}`;
      throw new SyntaxError_(
        `${name} takes ${want} argument${want.endsWith(' 1') || want === '1' ? '' : 's'}, not ${args.length}`,
      );
    }
    return { type: 'call', name, args };
  }
}

function describe(t: Token): string {
  switch (t.type) {
    case 'num':
      return `number ${t.value}`;
    case 'str':
      return 'text';
    case 'ref':
      return `{${t.key}}`;
    case 'ident':
      return t.name;
    case 'op':
      return `"${t.op}"`;
    case 'punct':
      return `"${t.value}"`;
  }
}

/** Field keys a formula references, in order of first use; works on formulas that do not parse yet. */
export function referencedKeysOf(src: string): string[] {
  const keys: string[] = [];
  for (const m of src.matchAll(/\{([^{}]*)\}/g)) {
    const key = m[1]!.trim();
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}
