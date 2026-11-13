import { z } from 'zod';
import { slugInput } from './workspace';

// Inputs of the pack commands (src/server/commands/packs.ts, docs/11).
const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);

export const listPacksInput = z.object({ org: slugInput });
export const previewPackInput = z.object({ org: slugInput, key });
export const installPackInput = z.object({
  org: slugInput,
  key,
  /** The catalogue hash the person previewed: the install refuses a pack that changed since. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});
export const archivePackInput = z.object({ org: slugInput, installId: z.uuid() });
