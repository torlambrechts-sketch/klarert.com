// @mentions in updates (docs/01 FR-28, FR-36): people by display name and job roles by name. The body keeps the
// plain text ("@Maria Pereira please check"); mentions are found again by matching names, longest first, so the same
// parser drives the composer, the server and the feed. Pure.

export interface MentionCandidate {
  kind: 'person' | 'role';
  id: string;
  name: string;
}

export interface MentionSpan {
  start: number;
  /** Exclusive; covers the "@" and the name. */
  end: number;
  kind: MentionCandidate['kind'];
  id: string;
  name: string;
}

const WORD = /[\p{L}\p{N}_]/u;

/** Every "@Name" in the body that names a candidate, left to right; the longest name wins at each "@". */
export function parseMentions(
  body: string,
  candidates: readonly MentionCandidate[],
): MentionSpan[] {
  const sorted = [...candidates]
    .filter((c) => c.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  const lower = body.toLowerCase();
  const spans: MentionSpan[] = [];
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '@') continue;
    if (i > 0 && WORD.test(body[i - 1]!)) continue; // an email address, not a mention
    const hit = sorted.find((c) => {
      const name = c.name.toLowerCase();
      if (!lower.startsWith(name, i + 1)) return false;
      const next = body[i + 1 + name.length];
      return next === undefined || !WORD.test(next);
    });
    if (!hit) continue;
    const end = i + 1 + hit.name.length;
    spans.push({ start: i, end, kind: hit.kind, id: hit.id, name: hit.name });
    i = end - 1;
  }
  return spans;
}

/**
 * The people an update notifies: mentioned people, and everyone holding a mentioned job role. The author is never
 * notified about their own update. Order follows the body; no duplicates.
 */
export function mentionedUserIds(
  spans: readonly MentionSpan[],
  holders: (roleId: string) => readonly string[],
  authorId: string,
): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (id !== authorId && !out.includes(id)) out.push(id);
  };
  for (const s of spans) {
    if (s.kind === 'person') add(s.id);
    else holders(s.id).forEach(add);
  }
  return out;
}

/** The "@query" being typed just before the caret, or null. */
export function activeMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && WORD.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /^\s/.test(query)) return null;
  return { start: at, query };
}

/** Candidates whose name matches the query: names starting with it first, then names containing it. */
export function suggestMentions(
  query: string,
  candidates: readonly MentionCandidate[],
  limit = 8,
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  const starts = candidates.filter((c) => c.name.toLowerCase().startsWith(q));
  const words = candidates.filter(
    (c) =>
      !starts.includes(c) &&
      c.name
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.startsWith(q)),
  );
  return [...starts, ...words].slice(0, limit);
}

/** Replace the "@query" at `start…caret` with "@Name " and return the new text and caret. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const insert = `@${name} `;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}
