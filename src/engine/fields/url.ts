import { z } from 'zod';
import { base, cmpText, emptyLast, isBlank } from './helpers';

function isWebUrl(s: string): boolean {
  if (!/^https:\/\/\S+$/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && (u.hostname.includes('.') || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

/** Bare hosts get https://, http is upgraded; any other scheme is refused. */
function clean(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let t = input.trim();
  const hyperlink = t.match(/^=HYPERLINK\(\s*"([^"]+)"/i);
  if (hyperlink) t = hyperlink[1]!.trim();
  if (!t) return null;
  const scheme = t.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !/^https?:\/\//i.test(t)) {
    // "localhost:3000" or "example.com:8080/x" look like schemes but are hosts with ports.
    if (!/^[^/]+:\d+(\/|$)/.test(t)) return null;
  }
  const v = `https://${t.replace(/^https?:\/\//i, '')}`;
  return isWebUrl(v) ? v : null;
}

export const url = base<string, Record<string, never>>({
  id: 'url',
  label: 'URL',
  family: 'basic',
  description: 'A web address, shown by its site name.',
  storage: 'values',
  kind: 'text',
  valueSchema: z.string().refine(isWebUrl, 'Use a web address starting with https://'),
  configSchema: z.object({}) as z.ZodType<Record<string, never>>,
  defaultConfig: () => ({}),
  defaultWidth: 170,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize: clean,
  parseText: clean,
  isEmpty: isBlank,
  // Full address: toText feeds search, CSV export and type conversion. The cell shows urlHost().
  toText: (v) => v ?? '',
  compare: (a, b) => emptyLast(a, b, isBlank, cmpText),
});

/** Host shown in the grid cell (docs/03 §3.1 "show host"). */
export function urlHost(v: string | null): string {
  if (!v) return '';
  try {
    return new URL(v).host;
  } catch {
    return v;
  }
}
