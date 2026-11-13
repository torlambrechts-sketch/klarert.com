import { z } from 'zod';
import { slugInput } from './workspace';

// Inputs of the item and field commands (docs/02 §4). Values arrive raw; the field registry normalises them.

const uuid = z.uuid('Not found.');
/** fractional-indexing keys: base-62 digits. */
const position = z.string().regex(/^[0-9A-Za-z]{1,80}$/, 'Bad position.');
const mutationId = z.string().max(64).optional();
const raw = z.unknown();
const values = z.record(z.string().max(64), raw);
const itemName = z
  .string()
  .trim()
  .min(1, 'A name is required.')
  .max(500, 'A name can be at most 500 characters.');

const base = { org: slugInput, sheetId: uuid, mutationId };

export const createItemInput = z.object({
  ...base,
  groupId: uuid,
  name: itemName,
  position,
  values: values.optional(),
  /** Set when the item comes from a form view (internal form): automations see form_submitted. */
  formViewId: uuid.optional(),
  /** Added inline: automations wait until the person finishes the row (finishItem). */
  hold: z.boolean().optional(),
});

export const finishItemInput = z.object({ ...base, itemId: uuid });

export const setValuesInput = z.object({
  ...base,
  itemId: uuid,
  values: values.optional(),
  name: itemName.optional(),
  /** Comment for a status rule that requires one (docs/03 §6). */
  note: z.string().trim().min(1).max(10_000).optional(),
  /** Long text and checklist edits: reject when someone else saved in between (docs/02 §5). */
  expectedUpdatedAt: z.string().max(40).optional(),
  /** Edited in the Table or the item panel: automations wait until the person finishes the row (finishItem). */
  hold: z.boolean().optional(),
});

export const bulkSetValuesInput = z.object({
  ...base,
  items: z
    .array(z.object({ itemId: uuid, values: values.optional(), name: itemName.optional() }))
    .min(1)
    .max(5000, 'Change at most 5000 items at once.'),
});

export const moveItemsInput = z.object({
  ...base,
  moves: z
    .array(z.object({ itemId: uuid, groupId: uuid, position }))
    .min(1)
    .max(5000),
});

export const archiveItemsInput = z.object({
  ...base,
  itemIds: z.array(uuid).min(1).max(5000),
  archived: z.boolean(),
});

export const setLinksInput = z.object({
  ...base,
  itemId: uuid,
  fieldId: uuid,
  to: z.array(uuid).max(500),
});

export const lockItemInput = z.object({
  ...base,
  itemId: uuid,
  locked: z.boolean(),
  reason: z.string().trim().max(200).optional(),
});

export const clickButtonInput = z.object({ ...base, itemId: uuid, fieldId: uuid });

// ───────────── fields ─────────────

const fieldName = z
  .string()
  .trim()
  .min(1, 'A field needs a name.')
  .max(80, 'A field name can be at most 80 characters.');

export const addFieldInput = z.object({
  org: slugInput,
  sheetId: uuid,
  type: z.string().min(1).max(40),
  name: fieldName.optional(),
  /** Insert before or after this field; at the end when neither is given. */
  beforeFieldId: uuid.optional(),
  afterFieldId: uuid.optional(),
});

const ruleSchema = z.object({
  id: z.string().min(1).max(40),
  whenFieldKey: z.string().min(1).max(40),
  whenValues: z.array(z.json()).max(50),
  require: z.array(z.string().max(40)).max(20).optional(),
  requireComment: z.boolean().optional(),
  message: z.string().trim().max(300).optional(),
  fromDone: z.boolean().optional(),
});

const conditionSchema = z.object({
  fieldKey: z.string().min(1).max(40),
  op: z.string().min(1).max(40),
  value: z.json().optional(),
});

export const validationSchema = z.object({
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  pattern: z
    .string()
    .max(200, 'A pattern can be at most 200 characters.')
    .refine((p) => {
      try {
        new RegExp(p);
        return true;
      } catch {
        return false;
      }
    }, 'This pattern is not a valid regular expression.')
    .optional(),
  unique: z.boolean().optional(),
  maxLength: z.number().int().positive().optional(),
});

export const updateFieldInput = z.object({
  org: slugInput,
  fieldId: uuid,
  name: fieldName.optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  required: z.boolean().optional(),
  locked: z.boolean().optional(),
  width: z.number().int().min(60).max(600).optional(),
  config: z.record(z.string(), z.json()).optional(),
  validation: validationSchema.optional(),
  rules: z.array(ruleSchema).max(20).optional(),
  visibility: conditionSchema.nullable().optional(),
});

export const fieldRefInput = z.object({ org: slugInput, fieldId: uuid });
/** A new option typed in a picker (label types whose options people define). */
export const addFieldOptionInput = z.object({
  ...base,
  fieldId: uuid,
  label: z
    .string()
    .trim()
    .min(1, 'Type a name for the option.')
    .max(80, 'An option can be at most 80 characters.'),
});
export const moveFieldInput = fieldRefInput.extend({ toIndex: z.number().int().min(0) });
export const changeTypeInput = fieldRefInput.extend({
  to: z.string().min(1).max(40),
  /** false = preview only. */
  apply: z.boolean(),
  /** When the type can't convert in place: true replaces the field (the old one is deleted, restorable for 30
   *  days), false keeps both. */
  replace: z.boolean().optional(),
});
export const deletedFieldsInput = z.object({ org: slugInput, sheetId: uuid });
