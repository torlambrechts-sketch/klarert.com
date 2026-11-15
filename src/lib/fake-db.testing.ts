// For unit tests only: an in-memory stand-in for the Supabase client that answers list queries the way PostgREST does,
// including its row cap (supabase/config.toml max_rows = 1000): a request without a range, or with a range wider than
// the cap, gets at most 1000 rows and no error. A query helper that forgets to page silently loses rows here exactly as
// it would against the API, so its test fails.
import type { Db } from './sheet-query';

export const MAX_ROWS = 1000;

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

/** "settings->retention->rules" or "trigger->>type": a JSON path into a row. */
function get(row: Row, path: string): unknown {
  const parts = path.split(/->>?/);
  let v: unknown = row[parts[0]!];
  for (const p of parts.slice(1)) v = v && typeof v === 'object' ? (v as Row)[p] : undefined;
  return v;
}

const cmp = (a: unknown, b: unknown) => (a === b ? 0 : (a as string) < (b as string) ? -1 : 1);

export interface FakeDb {
  db: Db;
  /** Every request made: table (or rpc:<name>) and the range asked for. */
  requests: { source: string; range: [number, number] | null }[];
}

export function fakeDb(
  tables: Record<string, Row[]>,
  rpcs: Record<string, (args: Record<string, unknown>) => Row[] | unknown> = {},
): FakeDb {
  const requests: FakeDb['requests'] = [];

  function query(source: string, rows: () => Row[] | unknown) {
    const preds: Pred[] = [];
    const orders: { col: string; asc: boolean }[] = [];
    let range: [number, number] | null = null;
    let limit: number | null = null;
    let single: 'maybe' | 'one' | null = null;
    let head = false;
    let count = false;
    const run = () => {
      requests.push({ source, range });
      const raw = rows();
      if (!Array.isArray(raw)) return { data: raw, error: null, count: null };
      let out = (raw as Row[]).filter((r) => preds.every((p) => p(r)));
      const total = out.length;
      if (orders.length)
        out = [...out].sort((a, b) => {
          for (const o of orders) {
            const c = cmp(get(a, o.col), get(b, o.col));
            if (c) return o.asc ? c : -c;
          }
          return 0;
        });
      if (range) out = out.slice(range[0], range[1] + 1);
      if (limit !== null) out = out.slice(0, limit);
      out = out.slice(0, MAX_ROWS);
      if (head) return { data: null, error: null, count: count ? total : null };
      if (single) return { data: out[0] ?? null, error: null, count: null };
      return { data: out, error: null, count: count ? total : null };
    };
    const b = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) head = true;
        if (opts?.count) count = true;
        return b;
      },
      eq(col: string, v: unknown) {
        preds.push((r) => get(r, col) === v);
        return b;
      },
      neq(col: string, v: unknown) {
        preds.push((r) => get(r, col) !== v);
        return b;
      },
      is(col: string, v: unknown) {
        preds.push((r) => (get(r, col) ?? null) === v);
        return b;
      },
      in(col: string, vs: unknown[]) {
        preds.push((r) => vs.includes(get(r, col)));
        return b;
      },
      not(col: string, op: string, v: unknown) {
        if (op !== 'is') throw new Error(`fakeDb: not.${op} is not supported`);
        preds.push((r) => (get(r, col) ?? null) !== v);
        return b;
      },
      gte(col: string, v: unknown) {
        preds.push((r) => cmp(get(r, col), v) >= 0);
        return b;
      },
      gt(col: string, v: unknown) {
        preds.push((r) => cmp(get(r, col), v) > 0);
        return b;
      },
      lt(col: string, v: unknown) {
        preds.push((r) => cmp(get(r, col), v) < 0);
        return b;
      },
      lte(col: string, v: unknown) {
        preds.push((r) => cmp(get(r, col), v) <= 0);
        return b;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orders.push({ col, asc: opts?.ascending !== false });
        return b;
      },
      range(from: number, to: number) {
        range = [from, to];
        return b;
      },
      limit(n: number) {
        limit = n;
        return b;
      },
      maybeSingle() {
        single = 'maybe';
        return b;
      },
      single() {
        single = 'one';
        return b;
      },
      then<T>(ok: (r: ReturnType<typeof run>) => T, ko?: (e: unknown) => T) {
        return Promise.resolve().then(run).then(ok, ko);
      },
    };
    return b;
  }

  const db = {
    from: (table: string) => query(table, () => tables[table] ?? []),
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      const fn = rpcs[name];
      if (!fn) throw new Error(`fakeDb: no rpc ${name}`);
      return query(`rpc:${name}`, () => fn(args));
    },
  };
  return { db: db as unknown as Db, requests };
}

/** `n` rows made by `make(i)`. */
export const many = <T>(n: number, make: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => make(i));

/** A sortable id for row i: "id-0000042". */
export const seqId = (prefix: string, i: number) => `${prefix}-${String(i).padStart(7, '0')}`;
