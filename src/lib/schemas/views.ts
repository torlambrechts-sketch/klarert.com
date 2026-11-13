import { z } from 'zod';
import { conditionSchema, viewConfigSchema, viewTypeInput } from '@/engine/views/config';
import { MAX_TABS, sheetTabSchema } from '@/engine/views/tabs';
import { slugInput } from './workspace';

// Inputs of the view and form commands (docs/01 FR-25, FR-26).

const uuid = z.uuid('Not found.');
const viewName = z
  .string()
  .trim()
  .min(1, 'A name is required.')
  .max(60, 'A view name can be at most 60 characters.');
/** A saved view's uuid or a built-in view ("table", "kanban" …; the former "list" and "grid" read as "table"). */
const viewRef = z.union([uuid, viewTypeInput]);

export const createViewInput = z.object({
  org: slugInput,
  sheetId: uuid,
  name: viewName,
  type: viewTypeInput,
  config: viewConfigSchema,
  /** Shared views are visible to every member and need an editor; personal views only to their owner. */
  shared: z.boolean(),
});

export const updateViewInput = z.object({
  org: slugInput,
  viewId: uuid,
  name: viewName.optional(),
  config: viewConfigSchema.optional(),
});

export const duplicateViewInput = z.object({
  org: slugInput,
  viewId: uuid,
  name: viewName,
  shared: z.boolean(),
});

export const deleteViewInput = z.object({ org: slugInput, viewId: uuid });

export const setDefaultViewInput = z.object({ org: slugInput, sheetId: uuid, viewId: viewRef });

/** A sheet's tab set (the rules: sheetTabsSchema, checked by the command once the default is known). */
export const setSheetTabsInput = z.object({
  org: slugInput,
  sheetId: uuid,
  tabs: z.array(sheetTabSchema).min(1).max(MAX_TABS),
  /** The view that opens first. Left out: the current one, or the Table when the new set hides it. */
  defaultViewId: viewRef.optional(),
});

export const filterItemsInput = z.object({
  org: slugInput,
  sheetId: uuid,
  conditions: z.array(conditionSchema).max(30),
});

export const formLinkInput = z.object({ org: slugInput, viewId: uuid });
export const disableFormLinkInput = z.object({ org: slugInput, linkId: uuid });

export const publicSubmitInput = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, 'This form link is not valid.'),
  name: z.string().max(500, 'Keep it under 500 characters.'),
  answers: z.record(z.uuid(), z.unknown()),
  /** Honeypot: people never see or fill it. */
  website: z.string().max(500).optional(),
});
