import { z } from 'zod';
import { slugInput } from './workspace';

// Input of the Design read (docs/05 §3.8, §4): the whole workspace, and one sheet's form answers when given.
export const readDesignInput = z.object({
  org: slugInput,
  sheetId: z.uuid('Not found.').nullable().optional(),
});

// The data-flow record export, for the log (docs/05 §4, 0049): the page's filters and what it covered. Keys and
// counts only: never an address or a field value.
const filterKey = z.string().trim().min(1).max(120).nullable().optional();
export const dataFlowExportInput = z.object({
  org: slugInput,
  app: filterKey,
  pack: filterKey,
  group: filterKey,
  domain: filterKey,
  differs: z.boolean().optional(),
  sheets: z.number().int().min(0),
  destinations: z.number().int().min(0),
});
