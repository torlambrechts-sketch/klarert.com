'use server';

import { revalidatePath } from 'next/cache';
import {
  createManagementReview,
  listAuditExports,
  type AuditExports,
} from '@/server/commands/audit';
import type { Result } from '@/server/result';

// "Add to Management review" on the inputs page: the command validates, authorises (editors) and writes.
export async function createManagementReviewAction(
  input: unknown,
): Promise<Result<{ sheetId: string; displayId: string }>> {
  const r = await createManagementReview(input);
  if (r.ok && input && typeof input === 'object' && 'org' in input)
    revalidatePath(`/${String(input.org)}`, 'layout');
  return r;
}

// The Exports list's next page (and Retry): the command authorises (owners, admins and auditors) and reads.
export async function listAuditExportsAction(input: unknown): Promise<Result<AuditExports>> {
  return listAuditExports(input);
}
