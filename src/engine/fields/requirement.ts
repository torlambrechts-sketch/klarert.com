import { z } from 'zod';
import type { Ctx, TriggerId } from '../types';
import { base, cmpNumber, cmpText, emptyLast, issue, splitList } from './helpers';
import type { FieldTypeDef } from './types';

export interface LibraryLinkConfig {
  targetSheetId: string | null;
  multiple: boolean;
  inverseFieldId: string | null;
}

export const libraryLinkConfigSchema = z.object({
  targetSheetId: z.string().min(1).nullable(),
  multiple: z.boolean(),
  inverseFieldId: z.string().min(1).nullable(),
});

const isEmpty = (v: string[] | null) => !Array.isArray(v) || v.length === 0;

function normalizeIds(input: unknown, cfg: LibraryLinkConfig): string[] | null {
  let parts: unknown[];
  if (Array.isArray(input)) parts = input;
  else if (typeof input === 'string') parts = splitList(input);
  else return null;
  const ids = [
    ...new Set(
      parts
        .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
        .map((p) => p.trim()),
    ),
  ];
  if (ids.length === 0) return null;
  return cfg.multiple ? ids : ids.slice(0, 1);
}

/** Links to items of a library sheet (requirement, controllink). Values live in item_links. */
export function libraryLinkType(spec: {
  id: string;
  label: string;
  description: string;
  defaultWidth: number;
}): FieldTypeDef<string[], LibraryLinkConfig> {
  const triggers: TriggerId[] = ['field_changed'];
  const text = (v: string[] | null, ctx: Ctx) =>
    (v ?? [])
      .map((id) => ctx.item(id)?.displayId)
      .filter((d): d is string => !!d)
      .join(', ');
  return base<string[], LibraryLinkConfig>({
    id: spec.id,
    label: spec.label,
    family: 'compliance',
    description: spec.description,
    storage: 'links',
    kind: 'link',
    valueSchema: z.array(z.string().min(1)),
    configSchema: libraryLinkConfigSchema,
    defaultConfig: () => ({ targetSheetId: null, multiple: true, inverseFieldId: null }),
    defaultWidth: spec.defaultWidth,
    formAllowed: true,
    kanbanCapable: false,
    calendarCapable: false,
    triggers,
    normalize: (input, cfg) => normalizeIds(input, cfg),
    parseText: (t, cfg) => normalizeIds(t, cfg),
    compute: (item, field, ctx) => {
      const ids = ctx.links(item.id, field.id);
      return ids.length ? ids : null;
    },
    validate: (v, field, _item, ctx) =>
      (v ?? []).some((id) => ctx.sheetOf(id) && !ctx.sheetOf(id)?.isLibrary)
        ? [issue(field, 'not_library', 'Link only to items of a library sheet.')]
        : [],
    isEmpty,
    toText: (v, _cfg, ctx) => text(v, ctx),
    toNumber: (v) => (isEmpty(v) ? null : v!.length),
    compare: (a, b, _cfg, ctx) =>
      emptyLast(
        a,
        b,
        isEmpty,
        (x, y) => cmpText(text(x, ctx), text(y, ctx)) || cmpNumber(x.length, y.length),
      ),
  });
}

export const requirement = libraryLinkType({
  id: 'requirement',
  label: 'Requirement',
  description: 'Links the item to requirements in a library sheet.',
  defaultWidth: 180,
});
