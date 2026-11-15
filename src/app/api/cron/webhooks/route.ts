import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Database } from '@/lib/database.types';
import { env } from '@/lib/env';
import { isCronAuthorised } from '@/server/cron-auth';
import { checkWebhookUrl } from '@/server/webhooks/ssrf';
import { postJson, resolveAll } from '@/server/webhooks/transport';
import { runWebhookWorker, type Settled } from '@/server/webhooks/worker';

// The webhook worker (docs/04 §9): Vercel Cron, every 5 minutes, `GET /api/cron/webhooks` with
// `Authorization: Bearer ${CRON_SECRET}`. One of the four places allowed the service role (CLAUDE.md rule 6):
// outbound_webhooks has no policies, and claiming/recording are service-role-only functions.

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
  const summary = await runWebhookWorker({
    async claim(limit) {
      const { data, error } = await db.rpc('claim_outbound_webhooks', { p_limit: limit });
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      // each automation signs its webhooks with its own key (0056, SA-12)
      const ids = [...new Set(rows.flatMap((r) => (r.automation_id ? [r.automation_id] : [])))];
      const keys = new Map<string, string>();
      if (ids.length > 0) {
        const { data: secrets, error: keyError } = await db
          .from('automation_secrets')
          .select('automation_id, signing_key')
          .in('automation_id', ids);
        if (keyError) throw new Error(keyError.message);
        for (const k of secrets ?? []) keys.set(k.automation_id, k.signing_key);
      }
      return rows.map((r) => ({
        id: r.id,
        url: r.url,
        payload: r.payload,
        attempts: r.attempts,
        signingKey: r.automation_id ? (keys.get(r.automation_id) ?? null) : null,
      }));
    },
    async record(id, s: Settled) {
      const { error } = await db.rpc('record_webhook_attempt', {
        p_id: id,
        p_status: s.status,
        // used only when retrying / failed
        p_next_attempt_at: (s.status === 'retrying' ? s.nextAttemptAt : new Date()).toISOString(),
        p_error: s.status === 'sent' ? '' : s.error,
      });
      if (error) throw new Error(error.message);
    },
    check: (url) => checkWebhookUrl(url, resolveAll),
    send: postJson,
    now: () => Date.now(),
    hmacHex: (key, message) => createHmac('sha256', key).update(message).digest('hex'),
  });
  const body = { ok: true, ms: Date.now() - started, ...summary };
  console.info(JSON.stringify({ level: 'info', source: 'webhooks', ...body }));
  return NextResponse.json(body);
}
