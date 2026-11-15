import { z } from 'zod';
import { slugInput } from './workspace';

// Input of the Design read (docs/05 §3.8, §4): the whole workspace, and one sheet's form answers when given.
export const readDesignInput = z.object({
  org: slugInput,
  sheetId: z.uuid('Not found.').nullable().optional(),
});
