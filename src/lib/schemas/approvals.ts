import { z } from 'zod';
import { workflowsSchema } from '@/engine/approvals/definition';
import { slugInput } from './workspace';

// Inputs of the approval commands (docs/04 §13). The definitions' shape is the engine's schema; whether they fit the
// sheet's fields is checked by workflowProblems in the command.

const uuid = z.uuid('Not found.');
const comment = z.string().trim().max(2000, 'Keep the comment under 2000 characters.');

export const saveWorkflowsInput = z.object({
  org: slugInput,
  sheetId: uuid,
  workflows: workflowsSchema,
});

export const submitApprovalInput = z.object({
  org: slugInput,
  sheetId: uuid,
  itemId: uuid,
  workflowId: z.string().min(1).max(40),
  comment: comment.optional(),
});

export const decideApprovalInput = z
  .object({
    org: slugInput,
    instanceId: uuid,
    decision: z.enum(['approved', 'rejected']),
    comment: comment.optional(),
  })
  .refine((v) => v.decision === 'approved' || !!v.comment?.trim(), {
    message: 'Say why you reject it.',
    path: ['comment'],
  });

export const withdrawApprovalInput = z.object({
  org: slugInput,
  instanceId: uuid,
  comment: comment.optional(),
});

export const itemApprovalsInput = z.object({ org: slugInput, itemId: uuid });

export const previewSubmissionInput = z.object({ org: slugInput, sheetId: uuid, itemId: uuid });
