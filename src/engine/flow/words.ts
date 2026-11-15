// Words and masks the flow shares: a restricted field's name never reaches someone who may not see the field, a
// webhook address shows only its host, a sheet the person cannot open has no name. Pure.
import type { FlowAutomation, FlowField, FlowForm, FlowWorld } from './types';

export const RESTRICTED_FIELD = 'Restricted field';
export const UNREADABLE_SHEET = 'A sheet you cannot open';

/** "hooks.slack.com/…": the host of an https address, never its path, query or secret. */
export function maskUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.trim()) return 'No address yet';
  try {
    const u = new URL(url.trim());
    return `${u.hostname}/…`;
  } catch {
    return 'An address that is not valid';
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Text with every hidden field's real name replaced (case-insensitive, whole words only where the name is a word). */
export function scrub(text: string, hiddenNames: readonly string[]): string {
  let out = text;
  for (const name of hiddenNames) {
    const n = name.trim();
    if (n.length < 2) continue;
    out = out.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}])${escape(n)}(?=$|[^\\p{L}\\p{N}])`, 'giu'),
      `$1${RESTRICTED_FIELD}`,
    );
  }
  return out;
}

/** A hidden field as the person may know it: no name, description, help or option labels. */
function maskField(f: FlowField): FlowField {
  if (!f.hidden) return f;
  const cfg = f.config && typeof f.config === 'object' ? (f.config as Record<string, unknown>) : {};
  const options = Array.isArray(cfg.options)
    ? (cfg.options as { id?: unknown }[]).map((o) => ({ ...o, label: 'Restricted' }))
    : undefined;
  return {
    ...f,
    name: RESTRICTED_FIELD,
    description: null,
    config: { ...cfg, ...(options ? { options } : {}) },
  };
}

/**
 * The world with every restricted field the person may not see (fields.field_hidden) masked: its name, description
 * and option labels, and its name inside automation and form names and form labels. Idempotent; the server returns
 * only a masked world and the engine masks again before deriving.
 */
const masked = new WeakSet<FlowWorld>();
const maskedOf = new WeakMap<FlowWorld, FlowWorld>();
export function maskWorld(world: FlowWorld): FlowWorld {
  if (masked.has(world)) return world;
  const hit = maskedOf.get(world);
  if (hit) return hit;
  const out = maskOnce(world);
  masked.add(out);
  maskedOf.set(world, out);
  return out;
}

function maskOnce(world: FlowWorld): FlowWorld {
  const hiddenNames = world.fields
    .filter((f) => f.hidden && f.name !== RESTRICTED_FIELD)
    .map((f) => f.name);
  const hiddenKeys = new Map<string, Set<string>>();
  for (const f of world.fields)
    if (f.hidden) {
      const set = hiddenKeys.get(f.sheetId) ?? new Set<string>();
      set.add(f.key);
      hiddenKeys.set(f.sheetId, set);
    }
  if (!hiddenNames.length && !hiddenKeys.size) return world;
  const automations: FlowAutomation[] = world.automations.map((a) => ({
    ...a,
    name: scrub(a.name, hiddenNames),
  }));
  const forms: FlowForm[] = world.forms.map((form) => {
    const keys = hiddenKeys.get(form.sheetId);
    return {
      ...form,
      name: scrub(form.name, hiddenNames),
      layout: {
        ...form.layout,
        fields: form.layout.fields.map((q) =>
          keys?.has(q.key)
            ? { ...q, label: q.label ? RESTRICTED_FIELD : q.label, help: undefined }
            : q,
        ),
      },
    };
  });
  return { ...world, fields: world.fields.map(maskField), automations, forms };
}

/** "1 run", "2 runs". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a, b and c". */
export function listWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
