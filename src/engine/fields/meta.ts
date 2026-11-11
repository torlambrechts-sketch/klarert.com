import { z } from 'zod';
import type { Ctx } from '../types';
import {
  base,
  cmpNumber,
  cmpText,
  emptyLast,
  findPersonId,
  formatDateTime,
  isBlank,
  isoDateInZone,
} from './helpers';
import type { FieldTypeDef, ValueKind } from './types';

export const META_WHICH = ['created_at', 'created_by', 'updated_at', 'updated_by'] as const;
export interface MetaConfig {
  which: (typeof META_WHICH)[number];
}

const isWhen = (cfg: MetaConfig) => cfg.which.endsWith('_at');

/** *_at fields filter as dates, *_by fields as people. */
export function metaKind(cfg: MetaConfig): ValueKind {
  return isWhen(cfg) ? 'date' : 'people';
}

const instant = (input: unknown): string | null => {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d/.test(input.trim())) return null;
  const ms = Date.parse(input.trim());
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

const normalize = (input: unknown, cfg: MetaConfig, ctx: Ctx) =>
  isWhen(cfg) ? instant(input) : (findPersonId(input, ctx) ?? null);

const personName = (v: string | null, ctx: Ctx) => (v ? (ctx.people.get(v)?.name ?? '') : '');

export const meta: FieldTypeDef<string, MetaConfig> = base<string, MetaConfig>({
  id: 'meta',
  label: 'Created and updated',
  family: 'computed',
  description: 'Who created or last updated the item, and when.',
  storage: 'computed',
  kind: 'date',
  valueSchema: z.string().min(1),
  configSchema: z.object({ which: z.enum(META_WHICH) }),
  defaultConfig: () => ({ which: 'created_at' }),
  defaultWidth: 150,
  formAllowed: false,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: [],
  normalize,
  parseText: normalize,
  compute: (item, field) => {
    const v = {
      created_at: item.createdAt,
      created_by: item.createdBy,
      updated_at: item.updatedAt,
      updated_by: item.updatedBy,
    }[field.config.which];
    return v || null;
  },
  isEmpty: isBlank,
  toText: (v, cfg, ctx) =>
    !v ? '' : isWhen(cfg) ? formatDateTime(v, ctx.timeZone) : personName(v, ctx),
  toDate: (v, cfg, ctx) => (v && isWhen(cfg) ? isoDateInZone(v, ctx.timeZone) : null),
  effectiveKind: (field) => metaKind(field.config),
  compare: (a, b, cfg, ctx) =>
    emptyLast(a, b, isBlank, (x, y) =>
      isWhen(cfg)
        ? cmpNumber(Date.parse(x), Date.parse(y))
        : cmpText(personName(x, ctx), personName(y, ctx)),
    ),
});
