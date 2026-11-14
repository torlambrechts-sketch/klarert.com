import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Database } from '@/lib/database.types';
import { env } from '@/lib/env';
import { isCronAuthorised } from '@/server/cron-auth';
import { releaseIdleHolds } from '@/server/scheduler/edit-holds';
import {
  emptySummary,
  runDateChecks,
  workspacesWithDateChecks,
  type DateCheckSummary,
} from '@/server/scheduler/date-checks';
import {
  claimRetentionDay,
  runRetentionChecks,
  workspacesWithRetention,
} from '@/server/scheduler/retention-checks';

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
  // retention (docs/02 §18): once a day per workspace, due records go to the review queue; nothing is erased here
  const retention = { workspaces: 0, queued: 0, failed: 0 };
  const day = now.toISOString().slice(0, 10);
  try {
    for (const orgId of await workspacesWithRetention(db)) {
      try {
        if (!(await claimRetentionDay(db, orgId, day))) continue;
        const r = await runRetentionChecks(db, orgId, { now });
        retention.workspaces += 1;
        retention.queued += r.queued;
      } catch (e) {
        retention.failed += 1;
        console.error(
          JSON.stringify({
            level: 'error',
            source: 'scheduler.retention',
            org: orgId,
            message: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'scheduler.retention',
        message: e instanceof Error ? e.message : String(e),
      }),
    );
  }
  let releasedHolds = 0;
  try {
    releasedHolds = await releaseIdleHolds(db, now);
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'scheduler',
        message: e instanceof Error ? e.message : String(e),
      }),
    );
  }
  const body = {
    ok: true,
    at: now.toISOString(),
    ms: Date.now() - started,
    ...total,
    releasedHolds,
    retention,
  };
  console.info(JSON.stringify({ level: 'info', source: 'scheduler', ...body }));
  return NextResponse.json(body);
}
