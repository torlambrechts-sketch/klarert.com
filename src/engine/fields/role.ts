import { z } from 'zod';
import type { Ctx } from '../types';
import { base, cmpText, emptyLast, findByName, isBlank } from './helpers';
import type { FieldTypeDef } from './types';

export type RoleConfig = Record<string, never>;

const normalize = (input: unknown, _cfg: RoleConfig, ctx: Ctx): string | null =>
  findByName(ctx.jobRoles, input)?.id ?? null;

const nameOf = (v: string | null, ctx: Ctx) =>
  v === null ? '' : (ctx.jobRoles.get(v)?.name ?? '');

export const role: FieldTypeDef<string, RoleConfig> = base<string, RoleConfig>({
  id: 'role',
  label: 'Role',
  family: 'choice',
  description: 'The job role responsible, from the workspace job roles.',
  storage: 'values',
  kind: 'option',
  valueSchema: z.string().min(1),
  configSchema: z.object({}).strict() as z.ZodType<RoleConfig>,
  defaultConfig: () => ({}),
  defaultWidth: 140,
  formAllowed: true,
  kanbanCapable: false,
  calendarCapable: false,
  triggers: ['field_changed'],
  normalize,
  parseText: (text, cfg, ctx) => normalize(text, cfg, ctx),
  toText: (v, _cfg, ctx) => nameOf(v, ctx),
  compare: (a, b, _cfg, ctx) =>
    emptyLast(
      a,
      b,
      (v) => isBlank(nameOf(v, ctx)),
      (x, y) => cmpText(nameOf(x, ctx), nameOf(y, ctx)),
    ),
  options: (_cfg, ctx) =>
    [...ctx.jobRoles.values()].map((r) => ({ id: r.id, label: r.name, color: 'navy' })),
});
