import { z } from 'zod';
import type { Ctx } from '../types';
import { base, cmpText, emptyLast, findByName, isBlank } from './helpers';
import type { FieldTypeDef } from './types';

export type TeamConfig = Record<string, never>;

const normalize = (input: unknown, _cfg: TeamConfig, ctx: Ctx): string | null =>
  findByName(ctx.teams, input)?.id ?? null;

const nameOf = (v: string | null, ctx: Ctx) => (v === null ? '' : (ctx.teams.get(v)?.name ?? ''));

export const team: FieldTypeDef<string, TeamConfig> = base<string, TeamConfig>({
  id: 'team',
  label: 'Team',
  family: 'choice',
  description: 'The team responsible, from the workspace teams.',
  storage: 'values',
  kind: 'option',
  valueSchema: z.string().min(1),
  configSchema: z.object({}) as z.ZodType<TeamConfig>,
  defaultConfig: () => ({}),
  defaultWidth: 120,
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
    [...ctx.teams.values()].map((r) => ({ id: r.id, label: r.name, color: 'navy' })),
});
