import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Database } from '@/lib/database.types';
import { env } from '@/lib/env';
import { isCronAuthorised } from '@/server/cron-auth';
import {
  emptySummary,
  runDateChecks,
  workspacesWithDateChecks,
  type DateCheckSummary,
} from '@/server/scheduler/date-checks';

// The scheduler (docs/04 §8): Vercel Cron, every 15 minutes, `GET /api/cron/scheduler` with
// `Authorization: Bearer ${CRON_SECRET}`. One of the four places allowed the service role (CLAUDE.md rule 6): the
// client is created here, after the secret matched, and used for date checks of every workspace in turn.

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function serviceClient() {
  const key = z.string().min(20).parse(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorised(request.headers.get('authorization'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const started = Date.now();
  const db = serviceClient();
  const now = new Date();
  const total: DateCheckSummary & { workspaces: number; failed: number } = {
    ...emptySummary(),
    workspaces: 0,
    failed: 0,
  };
  for (const orgId of await workspacesWithDateChecks(db)) {
    try {
      const s = await runDateChecks(db, orgId, { now });
      total.workspaces += 1;
      for (const k of Object.keys(s) as (keyof DateCheckSummary)[]) total[k] += s[k];
    } catch (e) {
      // one workspace failing does not stop the others; its occurrences stay unclaimed for the next run
      total.failed += 1;
      console.error(
        JSON.stringify({
          level: 'error',
          source: 'scheduler',
          org: orgId,
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }
  const body = { ok: true, at: now.toISOString(), ms: Date.now() - started, ...total };
  console.info(JSON.stringify({ level: 'info', source: 'scheduler', ...body }));
  return NextResponse.json(body);
}
