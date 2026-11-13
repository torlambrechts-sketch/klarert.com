import { z } from 'zod';
import { slugInput } from './workspace';

// Inputs of the sub-item commands (docs/02 §12). Values arrive raw; the child sheet's field registry normalises them.

const uuid = z.uuid('Not found.');
const position = z.string().regex(/^[0-9A-Za-z]{1,80}$/, 'Bad position.');
const name = z
  .string()
  .trim()
  .min(1, 'A name is required.')
  .max(500, 'A name can be at most 500 characters.');
const label = z
  .string()
  .trim()
  .min(1, 'Give sub-items a name, like Actions.')
  .max(40, 'Use at most 40 characters.');
const json = z.json();

export const templateRowInput = z.object({
  name,
  values: z.record(z.string().max(64), json).default({}),
});

export const enableSubitemsInput = z.object({
  org: slugInput,
  sheetId: uuid,
  label: label.optional(),
});

export const subitemSettingsInput = z.object({
  org: slugInput,
  sheetId: uuid,
  label: label.optional(),
  blockClose: z.boolean().optional(),
  lockCascade: z.boolean().optional(),
  template: z.array(templateRowInput).max(50, 'A template has at most 50 sub-items.').optional(),
});

export const createSubitemInput = z.object({
  org: slugInput,
  /** The child sheet. */
  sheetId: uuid,
  parentId: uuid,
  name,
  position,
  values: z.record(z.string().max(64), z.unknown()).optional(),
  hold: z.boolean().optional(),
  mutationId: z.string().max(64).optional(),
});

export const subitemsFromTemplateInput = z.object({
  org: slugInput,
  /** The parent sheet. */
  sheetId: uuid,
  parentId: uuid,
  mutationId: z.string().max(64).optional(),
});

export const moveSubitemInput = z.object({
  org: slugInput,
  /** The child sheet. */
  sheetId: uuid,
  itemId: uuid,
  parentId: uuid,
  position,
  mutationId: z.string().max(64).optional(),
});
