import { z } from 'zod';
import type { Ctx, Entity, Site } from '../types';
import { base, cmpText, emptyLast, findByName, issue } from './helpers';
import type { FieldTypeDef, LabelOption } from './types';

export type EntityConfig = Record<string, never>;

export interface EntityValue {
  entityId: string;
  siteId: string | null;
}

const SEP = /\s+[·|/–—-]\s+/;

const siteOf = (entity: Entity, input: unknown, ctx: Ctx): Site | undefined => {
  const sites = new Map([...ctx.sites].filter(([, s]) => s.entityId === entity.id));
  return findByName(sites, input);
};

function fromText(text: string, ctx: Ctx): EntityValue | null {
  const t = text.trim();
  if (!t) return null;
  const whole = findByName(ctx.entities, t);
  if (whole) return { entityId: whole.id, siteId: null };
  const m = t.split(SEP);
  if (m.length !== 2) return null;
  const entity = findByName(ctx.entities, m[0]);
  const site = entity && siteOf(entity, m[1], ctx);
  return entity && site ? { entityId: entity.id, siteId: site.id } : null;
}

function normalize(input: unknown, _cfg: EntityConfig, ctx: Ctx): EntityValue | null {
  if (typeof input === 'string') return fromText(input, ctx);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as { entityId?: unknown; siteId?: unknown };
  const entity = findByName(ctx.entities, o.entityId);
  if (!entity) return null;
  if (o.siteId === null || o.siteId === undefined || o.siteId === '')
    return { entityId: entity.id, siteId: null };
  const site = siteOf(entity, o.siteId, ctx);
  return site ? { entityId: entity.id, siteId: site.id } : null;
}

function toText(v: EntityValue | null, _cfg: EntityConfig, ctx: Ctx): string {
  const entity = v && ctx.entities.get(v.entityId);
  if (!v || !entity) return '';
  const site = v.siteId ? ctx.sites.get(v.siteId) : undefined;
  return site ? `${entity.name} · ${site.name}` : entity.name;
}

export const entity: FieldTypeDef<EntityValue, EntityConfig> = base<EntityValue, EntityConfig>({
  id: 'entity',
  label: 'Entity and site',
  family: 'choice',
  description: 'A legal entity of the workspace and, optionally, one of its sites.',
  storage: 'values',
  kind: 'option',
  valueSchema: z.object({ entityId: z.string().min(1), siteId: z.string().min(1).nullable() }),
  configSchema: z.object({}).strict() as z.ZodType<EntityConfig>,
  defaultConfig: () => ({}),
  defaultWidth: 200,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize,
  parseText: (text, _cfg, ctx) => fromText(text, ctx),
  isEmpty: (v) => !v || !v.entityId,
  validate: (v, field, _item, ctx) => {
    if (!v) return [];
    const site = v.siteId ? ctx.sites.get(v.siteId) : undefined;
    if (!ctx.entities.has(v.entityId)) {
      return [issue(field, 'entity_unknown', 'This entity no longer exists.')];
    }
    if (v.siteId && (!site || site.entityId !== v.entityId)) {
      return [issue(field, 'site_mismatch', 'The site does not belong to this entity.')];
    }
    return [];
  },
  toText,
  compare: (a, b, cfg, ctx) =>
    emptyLast(
      a,
      b,
      (v) => !v || !v.entityId,
      (x, y) => cmpText(toText(x, cfg, ctx), toText(y, cfg, ctx)),
    ),
  options: (cfg, ctx) => {
    const out: LabelOption[] = [];
    for (const e of ctx.entities.values()) {
      out.push({ id: e.id, label: e.name, color: 'navy' });
      for (const s of ctx.sites.values()) {
        if (s.entityId === e.id)
          out.push({
            id: `${e.id}:${s.id}`,
            label: toText({ entityId: e.id, siteId: s.id }, cfg, ctx),
            color: 'navy',
          });
      }
    }
    return out;
  },
});
