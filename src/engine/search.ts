// Global search (docs/01 FR-5, docs/05 §2.3): ranking of the candidates the server found under the person's RLS.
// Sheets by name; items by display id or name, and items where a person who matches the query is in a people field.
// Pure. Only names, display ids, sheet names and people names are ever searched: never values, so protected values
// cannot leak through search.

export const MAX_SHEETS = 5;
export const MAX_ITEMS = 8;
export const MIN_QUERY = 1;
export const MAX_QUERY = 80;

export interface SheetHit {
  id: string;
  name: string;
}

export interface ItemHit {
  id: string;
  sheetId: string;
  sheetName: string;
  displayId: string;
  name: string;
  /** Set when the item was found through a person in one of its people fields. */
  person?: string;
}

export interface SearchResults {
  sheets: SheetHit[];
  items: ItemHit[];
}

export const normaliseQuery = (q: string) => q.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY);

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** 0 exact · 1 starts with · 2 a word starts with · 3 contains · null no match. */
export function textScore(text: string, query: string): number | null {
  const t = fold(text);
  const q = fold(query);
  if (!q) return null;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.split(/[\s\-_/.,:;()]+/).some((w) => w.startsWith(q))) return 2;
  if (t.includes(q)) return 3;
  return null;
}

/** Item score: display id matches first (people type ids to jump), then names, then matches through a person. */
export function itemScore(hit: ItemHit, query: string): number | null {
  const id = textScore(hit.displayId, query);
  if (id !== null && id <= 1) return id; // CA-014 exact 0, CA-0 prefix 1
  const name = textScore(hit.name, query);
  const scores = [
    name === null ? null : 2 + name, // 2 … 5
    id === null ? null : 6,
    hit.person && textScore(hit.person, query) !== null ? 7 : null,
  ].filter((s): s is number => s !== null);
  return scores.length > 0 ? Math.min(...scores) : null;
}

const byText = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

export function rankSearch(
  query: string,
  sheets: SheetHit[],
  items: ItemHit[],
  limits = { sheets: MAX_SHEETS, items: MAX_ITEMS },
): SearchResults {
  const q = normaliseQuery(query);
  if (q.length < MIN_QUERY) return { sheets: [], items: [] };
  const rankedSheets = sheets
    .map((s) => ({ s, score: textScore(s.name, q) }))
    .filter((x): x is { s: SheetHit; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score || byText(a.s.name, b.s.name))
    .slice(0, limits.sheets)
    .map((x) => x.s);
  const seen = new Set<string>();
  const rankedItems = items
    .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    .map((i) => ({ i, score: itemScore(i, q) }))
    .filter((x): x is { i: ItemHit; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score || byText(a.i.displayId, b.i.displayId))
    .slice(0, limits.items)
    .map((x) => x.i);
  return { sheets: rankedSheets, items: rankedItems };
}

/** Escape a query for an SQL LIKE pattern (`%` and `_` are literal). */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
