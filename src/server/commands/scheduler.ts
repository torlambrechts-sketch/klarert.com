import 'server-only';
import { z } from 'zod';
import { invalid, ok, type Result } from '@/server/result';
import {
  dateCheckMessage,
  runDateChecks,
  type DateCheckSummary,
} from '@/server/scheduler/date-checks';
import { withOrg } from './context';

const input = z.object({ org: z.string().min(1).max(40) });

/**
 * "Run date checks now" (docs/04 §8, §10): owners and admins run the scheduler's own code for their workspace only,
 * with their own client (RLS for reads; claim_schedule_occurrence checks the role again in the database).
 */
export async function runDateChecksNow(
  raw: unknown,
): Promise<Result<{ summary: DateCheckSummary; messages: string[] }>> {
  const p = input.safeParse(raw);
  if (!p.success) return invalid(p.error);
  return withOrg(
    p.data.org,
    'admin',
    async ({ supabase, orgId }) => {
      const summary = await runDateChecks(supabase, orgId, {
        now: new Date(),
        workspace: p.data.org,
      });
      return ok({ summary, messages: [dateCheckMessage(summary)] });
    },
    'runDateChecksNow',
  );
}
