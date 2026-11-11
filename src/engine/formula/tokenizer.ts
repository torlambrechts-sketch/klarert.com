// Formula tokenizer (docs/03 §7). Hand-written; never eval.

export type Token =
  | { type: 'num'; value: number; pos: number }
  | { type: 'str'; value: string; pos: number }
  | { type: 'ref'; key: string; pos: number }
  | { type: 'ident'; name: string; pos: number }
  | { type: 'op'; op: Operator; pos: number }
  | { type: 'punct'; value: '(' | ')' | ','; pos: number };

export type Operator = '+' | '-' | '*' | '/' | '%' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=';

export type TokenizeResult =
  { ok: true; tokens: Token[] } | { ok: false; message: string; pos: number };

const TWO_CHAR: readonly string[] = ['<=', '>=', '<>'];
const ONE_CHAR = '+-*/%&=<>';
const NUMBER = /^(\d+(\.\d+)?|\.\d+)/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

export function tokenize(src: string): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = NUMBER.exec(src.slice(i));
      if (!m) return { ok: false, message: `Unexpected "${c}"`, pos: i };
      tokens.push({ type: 'num', value: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let value = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) j++;
        value += src[j];
        j++;
      }
      if (j >= src.length)
        return { ok: false, message: 'Text is missing its closing quote', pos: i };
      tokens.push({ type: 'str', value, pos: i });
      i = j + 1;
      continue;
    }
    if (c === '{') {
      const j = src.indexOf('}', i + 1);
      if (j < 0) return { ok: false, message: 'Field reference is missing its closing }', pos: i };
      const key = src.slice(i + 1, j).trim();
      if (!key) return { ok: false, message: 'Empty field reference', pos: i };
      tokens.push({ type: 'ref', key, pos: i });
      i = j + 1;
      continue;
    }
    const id = IDENT.exec(src.slice(i));
    if (id) {
      tokens.push({ type: 'ident', name: id[0], pos: i });
      i += id[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR.includes(two)) {
      tokens.push({ type: 'op', op: two as Operator, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR.includes(c)) {
      tokens.push({ type: 'op', op: c as Operator, pos: i });
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      tokens.push({ type: 'punct', value: c, pos: i });
      i++;
      continue;
    }
    return { ok: false, message: `Unexpected "${c}"`, pos: i };
  }
  return { ok: true, tokens };
}
