import { z } from 'zod';
import type { Ctx, Field, Item } from '../types';
import { base, cmpNumber, emptyLast, findPersonId, parseJson } from './helpers';
import { compareVersions } from './version';
import { resolveFieldType } from './resolve';

export interface AckEntry {
  userId: string;
  at: string;
  version: string | null;
}

export interface AckConfig {
  audience: { userIds: string[]; teamIds: string[]; jobRoleIds: string[] };
  versionFieldKey: string | null;
}

const isInstant = (s: string) => /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s));

const entrySchema = z.object({
  userId: z.string().min(1),
  at: z.string().refine(isInstant, 'Use an ISO date and time'),
  version: z.string().min(1).nullable(),
});

const isEmpty = (v: AckEntry[] | null) => !Array.isArray(v) || v.length === 0;

/** People who must acknowledge: listed users and team members, deduped. Job roles carry no members here. */
export function ackAudience(cfg: AckConfig, ctx: Ctx): string[] {
  const ids = new Set(cfg.audience.userIds);
  for (const t of cfg.audience.teamIds)
    for (const m of ctx.teams.get(t)?.memberIds ?? []) ids.add(m);
  return [...ids];
}

/** The item's current version (value of the version field), or null when none is configured or set. */
export function currentAckVersion(item: Item, field: Field<AckConfig>, ctx: Ctx): string | null {
  const vf = field.config.versionFieldKey
    ? ctx.fieldsByKey.get(field.config.versionFieldKey)
    : undefined;
  if (!vf) return null;
  const def = resolveFieldType(vf.type);
  const raw = item.values[vf.id] ?? null;
  return def ? def.toText(raw, vf.config, ctx) || null : typeof raw === 'string' ? raw : null;
}

/** Highest version among the entries: the best guess of the current version when the item is not at hand. */
function latestVersion(v: AckEntry[]): string | null {
  const vs = v.map((e) => e.version).filter((x): x is string => !!x && /^v\d+\.\d+$/.test(x));
  return vs.length ? vs.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b)) : null;
}

/** Audience members who acknowledged `version` (undefined: the latest version recorded). */
export function acknowledgedBy(
  v: AckEntry[] | null,
  cfg: AckConfig,
  ctx: Ctx,
  version?: string | null,
) {
  const audience = ackAudience(cfg, ctx);
  const ver = version === undefined ? latestVersion(v ?? []) : version;
  const done = new Set(
    (v ?? [])
      .filter((e) => (ver === null || e.version === ver) && audience.includes(e.userId))
      .map((e) => e.userId),
  );
  return { done: done.size, audience: audience.length };
}

/** % of the audience who acknowledged the given version; null when the audience is empty. */
export function ackPercent(
  v: AckEntry[] | null,
  cfg: AckConfig,
  ctx: Ctx,
  version?: string | null,
): number | null {
  const { done, audience } = acknowledgedBy(v, cfg, ctx, version);
  return audience === 0 ? null : (done / audience) * 100;
}

function normalizeAcks(input: unknown, ctx: Ctx): AckEntry[] | null {
  const arr = Array.isArray(input) ? input : input && typeof input === 'object' ? [input] : null;
  if (!arr) return null;
  const byKey = new Map<string, AckEntry>();
  for (const x of arr) {
    if (!x || typeof x !== 'object') return null;
    const o = x as Record<string, unknown>;
    const r = entrySchema.safeParse({
      ...o,
      userId: findPersonId(o.userId, ctx),
      version: o.version ?? null,
    });
    if (!r.success) return null;
    const key = `${r.data.userId}|${r.data.version ?? ''}`;
    const prev = byKey.get(key);
    if (!prev || Date.parse(prev.at) < Date.parse(r.data.at)) byKey.set(key, r.data);
  }
  const out = [...byKey.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return out.length ? out : null;
}

// toNumber has no item, so it counts acks of the latest recorded version; the command clears acks when
// the version field changes, and callers holding the item use ackPercent(v, cfg, ctx, currentAckVersion(...)).
export const ack = base<AckEntry[], AckConfig>({
  id: 'ack',
  label: 'Acknowledgement',
  family: 'compliance',
  description: 'Records who has read and acknowledged the item.',
  storage: 'values',
  kind: 'number',
  valueSchema: z.array(entrySchema),
  configSchema: z.object({
    audience: z.object({
      userIds: z.array(z.string()),
      teamIds: z.array(z.string()),
      jobRoleIds: z.array(z.string()),
    }),
    versionFieldKey: z.string().min(1).nullable(),
  }),
  defaultConfig: () => ({
    audience: { userIds: [], teamIds: [], jobRoleIds: [] },
    versionFieldKey: null,
  }),
  defaultWidth: 130,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed', 'number_above', 'number_below'],
  normalize: (input, _cfg, ctx) => normalizeAcks(input, ctx),
  parseText: (t, _cfg, ctx) => {
    const j = parseJson(t.trim());
    return j === undefined ? null : normalizeAcks(j, ctx);
  },
  isEmpty,
  toText: (v, cfg, ctx) => {
    if (isEmpty(v)) return '';
    const { done, audience } = acknowledgedBy(v, cfg, ctx);
    return audience ? `${done} of ${audience} acknowledged` : `${v!.length} acknowledged`;
  },
  toNumber: (v, cfg, ctx) => (isEmpty(v) ? null : ackPercent(v, cfg, ctx)),
  compare: (a, b, cfg, ctx) =>
    emptyLast(
      a,
      b,
      isEmpty,
      (x, y) =>
        cmpNumber(ackPercent(x, cfg, ctx) ?? -1, ackPercent(y, cfg, ctx) ?? -1) ||
        cmpNumber(x.length, y.length),
    ),
});
