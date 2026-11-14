import { z } from 'zod';
import { slugInput } from './workspace';

// Inputs of the framework commands (src/server/commands/frameworks.ts, docs/12).
const framework = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const version = z.string().regex(/^[0-9A-Za-z.-]{1,20}$/);

export const listFrameworksInput = z.object({ org: slugInput });
export const previewAdoptionInput = z.object({
  org: slugInput,
  framework,
  version,
  /** The sheet whose items are the workspace's controls (it has a requirement field that links to any library). */
  controlsSheetId: z.uuid().nullable().optional(),
});
export const adoptFrameworkInput = previewAdoptionInput.extend({
  /** The catalogue hash of the library pack the person previewed. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export const requirementContextInput = z.object({
  org: slugInput,
  sheetId: z.uuid(),
  itemId: z.uuid(),
});

/** Move an adopted library to the new edition that replaces it (docs/12): the old library's sheet. */
export const editionMoveInput = z.object({
  org: slugInput,
  fromSheetId: z.uuid(),
});
