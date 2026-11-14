import { z } from 'zod';
import { slugInput } from './workspace';

// Inputs of the Create wizard's commands (src/server/commands/bundles.ts, docs/05 §4 Create, docs/11 Bundles).
const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const level = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,39}$/)
  .nullish();
/** Part ids (src/engine/packs/select.ts): `sheet:<ref>`, `form:<sheet>.<form>`, `automation:<ref>`, `dashboard:<ref>`. */
const partId = z.string().regex(/^(sheet|form|automation|dashboard):[a-z0-9_.-]{1,120}$/);

export const createOptionsInput = z.object({ org: slugInput });
export const bundleDetailsInput = z.object({ org: slugInput, key, level });

export const folderChoice = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('pack') }),
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('folder'), name: z.string().trim().min(1).max(80) }),
]);

export const createBundleInput = z.object({
  org: slugInput,
  key,
  level,
  /** The catalogue hash the person previewed: a pack that changed since is refused. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  exclude: z.array(partId).max(200).default([]),
  folder: folderChoice.default({ mode: 'pack' }),
  name: z.string().trim().min(1, 'Give it a name.').max(120),
  ownerId: z.uuid({ message: 'Choose an owner.' }),
  /** Required: a ready-made process is reviewed by its owner by this date. */
  reviewBy: z.iso.date({ message: 'Choose a review date.' }),
});

export const markReviewedInput = z.object({ org: slugInput, installId: z.uuid() });
