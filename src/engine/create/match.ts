// Goal matching for the Create wizard (docs/05 §4 Create): "What do you need to handle?" → the 3–5 closest ready-made
// starting points. Keyword ranking over templates/intents.json only: no AI, nothing leaves the browser. Pure.

export type TargetKind = 'pack' | 'start' | 'app' | 'recipe';

export interface IntentTarget {
  kind: TargetKind;
  id: string;
}

export interface Intent {
  id: string;
  label: string;
  /** Shown as an example chip under the goal box. */
  chip: boolean;
  keywords: string[];
  /** Best first. */
  targets: IntentTarget[];
}

/** A starting point the wizard can offer (what the workspace's catalogue actually has). */
export interface Candidate extends IntentTarget {
  title: string;
  description: string;
}

export interface GoalMatch extends Candidate {
  score: number;
  /** The intent that matched, e.g. "Complaints". */
  because: string | null;
}

/** Lower case words, punctuation dropped, a plural "s" folded ("complaints" → "complaint"). */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

const containsRun = (hay: string[], needle: string[]) => {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++)
    if (needle.every((w, j) => hay[i + j] === w)) return true;
  return false;
};

/**
 * How well a query matches an intent: a whole keyword phrase scores 2 per word (longer phrases win), a query word that
 * starts a keyword word (3+ letters, "supp" → "supplier") scores 1 per query word.
 */
export function intentScore(query: string[], intent: Pick<Intent, 'keywords' | 'label'>): number {
  if (!query.length) return 0;
  let best = 0;
  const phrases = [...intent.keywords, intent.label].map(words);
  for (const p of phrases) if (containsRun(query, p)) best = Math.max(best, p.length * 2);
  let partial = 0;
  for (const q of query) {
    if (q.length < 3) continue;
    if (phrases.some((p) => p.some((w) => w.startsWith(q)))) partial += 1;
  }
  return best + partial * 0.5;
}

/**
 * The closest starting points for a goal: every intent scored, each of its targets the workspace offers inherits the
 * score less a little per place in the list; the candidate's own title and description count a little too. At most
 * `limit` (5), best first; ties keep the catalogue's order. An empty query returns nothing.
 */
export function rankGoal(
  query: string,
  intents: Intent[],
  candidates: Candidate[],
  limit = 5,
): GoalMatch[] {
  const q = words(query);
  if (!q.length) return [];
  const key = (t: IntentTarget) => `${t.kind}:${t.id}`;
  const byKey = new Map(candidates.map((c) => [key(c), c]));
  const scored = new Map<string, GoalMatch>();
  const offer = (c: Candidate, score: number, because: string | null) => {
    const k = key(c);
    const was = scored.get(k);
    if (!was || score > was.score) scored.set(k, { ...c, score, because });
  };
  for (const intent of intents) {
    const s = intentScore(q, intent);
    if (s <= 0) continue;
    intent.targets.forEach((t, i) => {
      const c = byKey.get(key(t));
      if (c) offer(c, s - i * 0.25, intent.label);
    });
  }
  // the candidates' own words: a weak signal, so a title match never outranks a keyword match
  for (const c of candidates) {
    const own = words(`${c.title} ${c.description}`);
    const hits = q.filter((w) => w.length >= 3 && own.some((o) => o.startsWith(w))).length;
    if (hits) offer(c, hits * 0.4, scored.get(key(c))?.because ?? null);
  }
  const order = new Map(candidates.map((c, i) => [key(c), i]));
  return [...scored.values()]
    .sort((a, b) => b.score - a.score || order.get(key(a))! - order.get(key(b))!)
    .slice(0, limit);
}

/** The example chips under the goal box, in file order. */
export const goalChips = (intents: Intent[]) => intents.filter((i) => i.chip).map((i) => i.label);
