import { z } from 'zod';
import type { Ctx, Issue } from '../types';
import {
  base,
  cmpNumber,
  cmpText,
  emptyLast,
  findPersonId,
  isBlank,
  issue,
  splitList,
} from './helpers';
import type { FieldTypeDef } from './types';

export interface PeopleConfig {
  multiple: boolean;
}

type V = string[];

function normalize(input: unknown, cfg: PeopleConfig, ctx: Ctx): V | null {
  let parts: unknown[];
  if (Array.isArray(input)) parts = input;
  else if (typeof input === 'string') parts = findPersonId(input, ctx) ? [input] : splitList(input);
  else return null;
  const ids: string[] = [];
  for (const p of parts) {
    const id = findPersonId(p, ctx);
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (!ids.length) return null;
  return cfg.multiple ? ids : ids.slice(0, 1);
}

const nameOf = (id: string, ctx: Ctx) => ctx.people.get(id)?.name;

export const people: FieldTypeDef<V, PeopleConfig> = base<V, PeopleConfig>({
  id: 'people',
  label: 'People',
  family: 'choice',
  description: 'Who is responsible: one or more people in the workspace.',
  storage: 'values',
  kind: 'people',
  valueSchema: z.array(z.string().min(1)),
  configSchema: z.object({ multiple: z.boolean() }),
  defaultConfig: () => ({ multiple: true }),
  defaultWidth: 110,
  formAllowed: true,
  // Only a single-person field can be the lane field; views check cfg.multiple.
  kanbanCapable: true,
  calendarCapable: false,
  triggers: ['field_changed', 'field_becomes'],
  normalize,
  parseText: (text, cfg, ctx) => normalize(text, cfg, ctx),
  validate: (v, field, _item, ctx) => {
    const out: Issue[] = [];
    if (v && !field.config.multiple && v.length > 1) {
      out.push(issue(field, 'people_single', 'Choose one person.'));
    }
    if (v?.some((id) => !ctx.people.has(id))) {
      out.push(
        issue(
          field,
          'people_unknown',
          'Someone in this field is no longer in the workspace.',
          'warning',
        ),
      );
    }
    return out;
  },
  toText: (v, _cfg, ctx) =>
    (v ?? [])
      .map((id) => nameOf(id, ctx))
      .filter((n): n is string => !!n)
      .join(', '),
  compare: (a, b, _cfg, ctx) =>
    emptyLast(
      a,
      b,
      isBlank,
      (x, y) =>
        cmpText(nameOf(x[0]!, ctx) ?? '', nameOf(y[0]!, ctx) ?? '') ||
        cmpNumber(x.length, y.length),
    ),
});
