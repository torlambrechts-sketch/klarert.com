'use server';

import * as approvals from '@/server/commands/approvals';

// Server actions for approval workflows (docs/04 §13): the definition editor, the item panel and My work. Each binds
// one command, which validates (Zod), authorises and calls the RPC; the callers refresh what they show.

export const saveApprovalWorkflowsAction = async (input: unknown) =>
  approvals.saveApprovalWorkflows(input);
export const previewSubmissionAction = async (input: unknown) => approvals.previewSubmission(input);
export const submitForApprovalAction = async (input: unknown) => approvals.submitForApproval(input);
export const decideApprovalAction = async (input: unknown) => approvals.decideApproval(input);
export const withdrawApprovalAction = async (input: unknown) => approvals.withdrawApproval(input);
export const itemApprovalsAction = async (input: unknown) => approvals.itemApprovals(input);
