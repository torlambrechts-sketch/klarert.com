// Starter recipes from templates/automation-recipes.json (docs/04 §11), validated at load (CLAUDE.md: templates are
// validated by Zod). The builder maps each recipe's roles to fields of the sheet (src/engine/automations/recipes.ts).
import { z } from 'zod';
import raw from '../../templates/automation-recipes.json';
import { isActionId, isTriggerId, type Recipe } from '@/engine/automations';
import { isFieldTypeId } from '@/engine/fields/registry';
import type { Json } from '@/engine/types';

const json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(json),
    z.record(z.string(), json),
  ]),
);

const recipeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  title: z.string().min(1),
  roles: z.record(
    z.string(),
    z
      .array(
        // `sub:<type>`: a field of the sheet's sub-items (sub-item triggers)
        z
          .string()
          .refine((t) => isFieldTypeId(t.replace(/^sub:/, '')), {
            message: 'Unknown field type in a recipe role',
          }),
      )
      .min(1),
  ),
  trigger: z
    .record(z.string(), json)
    .refine((t) => isTriggerId(t.type), { message: 'Unknown trigger in a recipe' }),
  conditions: z.array(z.record(z.string(), json)).optional(),
  actions: z
    .array(
      z
        .record(z.string(), json)
        .refine((a) => isActionId(a.type), { message: 'Unknown action in a recipe' }),
    )
    .min(1),
});

const recipesFile = z.object({ recipes: z.array(recipeSchema), notes: z.string().optional() });

export const RECIPES: Recipe[] = recipesFile.parse(raw).recipes;

export const recipeById = (id: string | null | undefined) => RECIPES.find((r) => r.id === id);
