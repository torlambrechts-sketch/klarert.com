// The Create wizard's goals (templates/intents.json, docs/05 §4 Create), validated at load (CLAUDE.md: templates are
// validated by Zod). Starts and recipes are checked against their own files here; pack and app ids are checked
// against the catalogue by the tests (the catalogue is read at run time, a missing pack is simply not offered).
import { z } from 'zod';
import raw from '../../../templates/intents.json';
import type { Intent } from '@/engine/create/match';
import { recipeById } from '@/lib/recipes';
import { startById } from '@/lib/starts';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);

const intentSchema = z
  .object({
    id,
    label: z.string().trim().min(1).max(40),
    chip: z.boolean().default(false),
    keywords: z.array(z.string().trim().min(2).max(60)).min(1).max(40),
    targets: z
      .array(z.object({ kind: z.enum(['pack', 'start', 'app', 'recipe']), id }))
      .min(1)
      .max(6),
  })
  .superRefine((i, ctx) => {
    i.targets.forEach((t, n) => {
      if (t.kind === 'start' && !startById(t.id))
        ctx.addIssue({ code: 'custom', path: ['targets', n], message: `Unknown start "${t.id}".` });
      if (t.kind === 'recipe' && !recipeById(t.id))
        ctx.addIssue({
          code: 'custom',
          path: ['targets', n],
          message: `Unknown recipe "${t.id}".`,
        });
    });
  });

export const intentsFile = z
  .object({ notes: z.string().optional(), intents: z.array(intentSchema).min(1).max(60) })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    f.intents.forEach((i, n) => {
      if (seen.has(i.id))
        ctx.addIssue({
          code: 'custom',
          path: ['intents', n],
          message: `Duplicate intent "${i.id}".`,
        });
      seen.add(i.id);
    });
  });

export const INTENTS: Intent[] = intentsFile.parse(raw).intents;
