import { z } from 'zod';
import { ACTION_IDS, TRIGGER_IDS } from '@/engine/automations';
import type { Json } from '@/engine/types';
import { conditionSchema } from '@/engine/views/config';
import { slugInput } from './workspace';

// Inputs of the automation commands (docs/04 §10, FR-32–FR-34). The shape is checked here; whether the trigger,
// conditions and actions fit the sheet is checked by the engine (draftProblems) against the sheet's fields.

const uuid = z.uuid('Not found.');
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string().max(10000),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(json).max(200),
    z.record(z.string().max(64), json),
  ]),
);

const triggerSchema = z
  .object({ type: z.enum(TRIGGER_IDS as [string, ...string[]]) })
  .catchall(json);
const actionSchema = z.object({ type: z.enum(ACTION_IDS as [string, ...string[]]) }).catchall(json);

export const automationDraftSchema = z.object({
  name: z.string().trim().max(200, 'Use at most 200 characters.'),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(20, 'Use at most 20 conditions.'),
  actions: z.array(actionSchema).min(1, 'Add an action.').max(10, 'Use at most 10 actions.'),
});

export const createAutomationInput = z.object({
  org: slugInput,
  sheetId: uuid,
  draft: automationDraftSchema,
  /** custom, or template:<recipe id> when started from a recipe. */
  source: z
    .string()
    .regex(/^(custom|template:[a-z0-9-]{1,60})$/)
    .default('custom'),
  enabled: z.boolean().default(true),
});

export const updateAutomationInput = z.object({
  org: slugInput,
  automationId: uuid,
  draft: automationDraftSchema,
});

export const toggleAutomationInput = z.object({
  org: slugInput,
  automationId: uuid,
  enabled: z.boolean(),
});

export const automationRefInput = z.object({ org: slugInput, automationId: uuid });

export const pauseAutomationInput = z.object({
  org: slugInput,
  automationId: uuid,
  itemId: uuid,
  paused: z.boolean(),
});
