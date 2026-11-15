import { z } from 'zod';
import { slugInput } from './workspace';

// Inputs of the audit output commands (src/server/commands/audit.ts, docs/11 Audit outputs).

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');

export const soaExportInput = z.object({
  org: slugInput,
  sheetId: z.uuid('Not found.'),
  /** Every requirement, not only the statement of applicability's view. */
  all: z.boolean().optional(),
});

export const auditScopesInput = z.object({ org: slugInput });

/** A page of the Exports list: entries before this id (the previous page's last), or the newest. */
export const auditExportsInput = z.object({
  org: slugInput,
  before: z.number().int().positive().optional(),
});

/** "workspace", "folder:<id>" or "install:<id>". */
export const auditScope = z
  .string()
  .regex(
    /^(workspace|(folder|install):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
    'Choose a scope.',
  );

const endsAfterStart = (p: { from: string; to: string }) => p.from <= p.to;
const periodError = { message: 'The period ends before it starts.', path: ['to'] };

export const auditPackInput = z
  .object({ org: slugInput, scope: auditScope, from: isoDate, to: isoDate, files: z.boolean() })
  .refine(endsAfterStart, periodError);

export const managementReviewInput = z
  .object({ org: slugInput, from: isoDate, to: isoDate })
  .refine(endsAfterStart, periodError);
