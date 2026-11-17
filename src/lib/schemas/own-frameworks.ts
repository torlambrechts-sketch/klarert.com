import { z } from 'zod';
import { FRAMEWORK_KINDS, RELATIONS } from '@/engine/frameworks/types';
import { OWN_LIMITS } from '@/engine/frameworks/own';
import { slugInput } from './workspace';

// Inputs of the own-framework commands (src/server/commands/own-frameworks.ts, docs/12 Your own frameworks).
// A draft may hold values that break the framework's rules (a title too long, a missing parent): the person fixes
// them in the grid, and ownFrameworkProblems blocks publishing until they are gone. The caps here only stop input
// far beyond any framework.

const ownKey = z
  .string()
  .regex(/^w[0-9a-f]{8}-[a-z0-9][a-z0-9-]{0,29}$/, 'Not a framework of this workspace.');
const requirementKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}@[0-9A-Za-z.-]{1,20}#[^#@]{1,40}$/);

const line = (max: number) => z.string().max(max);
const draftRow = z.object({
  ref: line(200),
  parent: line(200),
  kind: line(40),
  title: line(1000),
  text: line(OWN_LIMITS.text * 2),
  guidance: line(OWN_LIMITS.guidance * 2),
  questions: z.array(line(1000)).max(50),
  evidence: z.array(line(1000)).max(50),
  tags: z.array(line(100)).max(50),
});

export const draftInput = z.object({
  title: line(500),
  shortTitle: line(100),
  kind: z.enum(FRAMEWORK_KINDS),
  requirements: z.array(draftRow).max(OWN_LIMITS.requirements * 2 + 10),
  mappings: z
    .array(z.object({ ref: line(200), to: requirementKey, relation: z.enum(RELATIONS) }))
    .max(OWN_LIMITS.requirements),
  copiedFrom: z.string().max(80).nullable(),
});

export const ownFrameworkEditorInput = z.object({ org: slugInput, key: ownKey.optional() });

export const createOwnFrameworkInput = z.object({
  org: slugInput,
  title: z.string().trim().min(1, 'Give the framework a name.').max(OWN_LIMITS.frameworkTitle),
  shortTitle: z
    .string()
    .trim()
    .min(1, 'Give a short name.')
    .max(OWN_LIMITS.shortTitle, `At most ${OWN_LIMITS.shortTitle} characters.`),
  kind: z.enum(FRAMEWORK_KINDS).default('internal'),
  start: z.enum(['paste', 'blank', 'copy']),
  /** paste: the rows read from the list (importRequirements ran in the browser; checked again on publish). */
  requirements: draftInput.shape.requirements.optional(),
  /** copy: the catalogue framework whose structure is copied, and whether to map to it (equivalent, for review). */
  copy: z
    .object({
      framework: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
      version: z.string().regex(/^[0-9A-Za-z.-]{1,20}$/),
      mappings: z.boolean(),
    })
    .optional(),
});

export const saveOwnDraftInput = z.object({ org: slugInput, key: ownKey, draft: draftInput });
export const deleteOwnDraftInput = z.object({ org: slugInput, key: ownKey });

export const publishOwnFrameworkInput = z.object({
  org: slugInput,
  key: ownKey,
  draft: draftInput,
  source: z
    .string()
    .trim()
    .min(1, 'Say where the text comes from.')
    .max(OWN_LIMITS.source, `At most ${OWN_LIMITS.source} characters.`),
  rightsConfirmed: z.literal(true, 'Confirm that you have the right to use this text.'),
  /** What the dialog showed: publishing refuses when the draft has become something else since. */
  expect: z.enum(['first', 'revision', 'edition']),
});

export const ownMappingOptionsInput = z.object({ org: slugInput });

export const mapOwnRequirementInput = z.object({
  org: slugInput,
  from: requirementKey,
  to: requirementKey,
  relation: z.enum(RELATIONS).default('related'),
  note: z
    .string()
    .trim()
    .max(OWN_LIMITS.note, `At most ${OWN_LIMITS.note} characters.`)
    .default(''),
});

export const retireOwnMappingInput = z.object({
  org: slugInput,
  id: z.number().int().positive(),
});
