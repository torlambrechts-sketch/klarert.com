// Starter recipes (docs/04 §11): a recipe names field roles ("status", "person") and the field types each role
// accepts; the builder maps every role to a field of the sheet and turns the recipe into a draft. Pure.
import type { Automation, Ctx, Field, Json } from '../types';
import type { AutomationDraft } from './builder';
import type { ActionJson } from './types';

export interface Recipe {
  id: string;
  title: string;
  /** role → field type ids that can fill it */
  roles: Record<string, string[]>;
  trigger: Record<string, Json>;
  conditions?: Record<string, Json>[];
  actions: Record<string, Json>[];
}

/** role → field key (null = not chosen yet). */
export type RoleMapping = Record<string, string | null>;

/** Fields of this sheet that can fill each role (the role's types, in sheet order). */
export function roleCandidates(recipe: Recipe, ctx: Ctx): Record<string, Field[]> {
  const fields = ctx.fieldsOf(ctx.sheet.id);
  return Object.fromEntries(
    Object.entries(recipe.roles).map(([role, types]) => [
      role,
      fields.filter((f) => types.includes(f.type)),
    ]),
  );
}

/** The first fitting field per role, a different one per role where the sheet has enough. */
export function defaultMapping(recipe: Recipe, ctx: Ctx): RoleMapping {
  const candidates = roleCandidates(recipe, ctx);
  const used = new Set<string>();
  const out: RoleMapping = {};
  for (const role of Object.keys(recipe.roles)) {
    const list = candidates[role] ?? [];
    const pick = list.find((f) => !used.has(f.key)) ?? list[0];
    out[role] = pick?.key ?? null;
    if (pick) used.add(pick.key);
  }
  return out;
}

/** Roles that cannot be filled on this sheet (no field of an accepted type). */
export function unfillableRoles(recipe: Recipe, ctx: Ctx): string[] {
  const c = roleCandidates(recipe, ctx);
  return Object.keys(recipe.roles).filter((r) => (c[r] ?? []).length === 0);
}

const TOKEN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}|\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Replace roles in one string, in one pass so a replacement is never replaced again: `{{role}}` (in messages) becomes
 * the template `{field_key}`, `{role}` (in field key positions, "field:{person}") becomes the key itself. Other
 * `{...}` tokens ({name}, {id}) stay. A string that is exactly an unmapped `{role}` becomes null.
 */
function fill(text: string, mapping: RoleMapping): Json {
  const whole = text.match(/^\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (whole && whole[1]! in mapping && !mapping[whole[1]!]) return null;
  return text.replace(TOKEN, (all, double?: string, single?: string) => {
    const role = double ?? single!;
    if (!(role in mapping)) return all;
    const key = mapping[role];
    if (!key) return all;
    return double ? `{${key}}` : key;
  });
}

function walk(v: Json, mapping: RoleMapping): Json {
  if (typeof v === 'string') return fill(v, mapping);
  if (Array.isArray(v)) {
    // a recipient whose role is not mapped is dropped rather than kept as "field:{person}"
    return v
      .map((x) => walk(x, mapping))
      .filter(
        (x) =>
          !(
            typeof x === 'string' &&
            /\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(x) &&
            x.startsWith('field:')
          ),
      );
  }
  if (v && typeof v === 'object')
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, mapping)]));
  return v;
}

/** The recipe as a draft for the builder; null values (a status to reach, a target sheet) are filled in there. */
export function applyRecipe(recipe: Recipe, mapping: RoleMapping): AutomationDraft {
  return {
    name: '',
    trigger: walk(recipe.trigger, mapping) as Automation['trigger'],
    conditions: (recipe.conditions ?? []).map((c) =>
      walk(c, mapping),
    ) as unknown as AutomationDraft['conditions'],
    actions: recipe.actions.map((a) => walk(a, mapping)) as ActionJson[],
  };
}

/** The `source` of an automation saved from a recipe (automations.source: custom | template:<id> | pack:<id>). */
export const recipeSource = (recipeId: string) => `template:${recipeId}`;
