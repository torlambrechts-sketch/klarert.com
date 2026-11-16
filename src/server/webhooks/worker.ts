// The webhook worker (docs/04 §9): claims due rows, POSTs each with a 10 s timeout, and records sent / retrying /
// dead_letter. Free of Supabase and of the network: the route (src/app/api/cron/webhooks/route.ts) injects the
// claim/record RPCs and the transport, so the backoff, timeouts and transitions are unit-tested.
import { BlockedUrlError } from './ssrf';

const MIN = 60_000;
/** Wait before the next attempt after the 1st, 2nd, 3rd … failure (docs/04 §9). */
export const BACKOFF_MS = [1 * MIN, 5 * MIN, 30 * MIN, 120 * MIN, 360 * MIN];
/** After this many failed attempts the row is a dead letter and the automation's creator is told. */
export const MAX_FAILURES = 5;
export const TIMEOUT_MS = 10_000;
export const BATCH = 50;
/** Rows sent at the same time; 50 rows × 10 s stay well inside one function run. */
const CONCURRENCY = 10;

export type Settled =
  | { status: 'sent' }
  | { status: 'retrying'; nextAttemptAt: Date; error: string }
  | { status: 'dead_letter'; error: string };

/** What happens after an attempt that failed: `attempts` is the count of failures before this one. */
export function afterFailure(attempts: number, error: string, now: number): Settled {
  const failures = attempts + 1;
  if (failures >= MAX_FAILURES) return { status: 'dead_letter', error };
  const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]!;
  return { status: 'retrying', nextAttemptAt: new Date(now + wait), error };
}

export interface WebhookRow {
  id: string;
  url: string;
  payload: unknown;
  attempts: number;
  /** The automation's signing key (0056); null when the automation is gone: the POST is then unsigned. */
  signingKey?: string | null;
}

/** The signature header receivers check (SA-12): HMAC-SHA256 of "<t>.<body>" with the automation's key. */
// A wire name: receivers already check this header, so it keeps "Klarert" after the rename to Keptrow (docs/14).
export const SIGNATURE_HEADER = 'X-Klarert-Signature';

export function signatureHeader(
  key: string,
  body: string,
  nowMs: number,
  hmacHex: (key: string, message: string) => string,
): string {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v1=${hmacHex(key, `${t}.${body}`)}`;
}

export interface WorkerDeps {
  claim(limit: number): Promise<WebhookRow[]>;
  record(id: string, settled: Settled): Promise<void>;
  /** Checks the URL (https, SSRF guard) and returns it parsed; throws BlockedUrlError. */
  check(url: string): Promise<URL>;
  /** POST the JSON body with the extra headers; resolves with the HTTP status. No redirects; honours the signal. */
  send(
    url: URL,
    body: string,
    signal: AbortSignal,
    headers: Record<string, string>,
  ): Promise<number>;
  now(): number;
  /** HMAC-SHA256 as hex, for the signature header (the route always gives it; rows without a key go unsigned). */
  hmacHex?(key: string, message: string): string;
  timeoutMs?: number;
}

export interface WorkerSummary {
  claimed: number;
  sent: number;
  retrying: number;
  deadLetter: number;
}

/** One attempt: the outcome and the error text people see in the dead-letter notice. */
export async function attempt(
  row: WebhookRow,
  deps: Pick<WorkerDeps, 'check' | 'send' | 'timeoutMs' | 'hmacHex'> &
    Partial<Pick<WorkerDeps, 'now'>>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = await deps.check(row.url);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof BlockedUrlError ? e.message : 'The webhook address was refused.',
    };
  }
  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = JSON.stringify(row.payload ?? {});
    const headers: Record<string, string> =
      row.signingKey && deps.hmacHex
        ? {
            [SIGNATURE_HEADER]: signatureHeader(
              row.signingKey,
              body,
              (deps.now ?? Date.now)(),
              deps.hmacHex,
            ),
          }
        : {};
    const status = await deps.send(url, body, controller.signal, headers);
    if (status >= 200 && status < 300) return { ok: true };
    if (status >= 300 && status < 400)
      return { ok: false, error: `HTTP ${status}: redirects are not followed.` };
    return { ok: false, error: `HTTP ${status}` };
  } catch (e) {
    if (controller.signal.aborted)
      return { ok: false, error: `No answer within ${Math.round(timeoutMs / 1000)} s.` };
    if (e instanceof BlockedUrlError) return { ok: false, error: e.message };
    return {
      ok: false,
      error: e instanceof Error && e.message ? e.message.slice(0, 200) : 'The request failed.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runWebhookWorker(deps: WorkerDeps): Promise<WorkerSummary> {
  const rows = await deps.claim(BATCH);
  const summary: WorkerSummary = { claimed: rows.length, sent: 0, retrying: 0, deadLetter: 0 };
  const queue = [...rows];
  const lane = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const r = await attempt(row, deps);
      const settled: Settled = r.ok
        ? { status: 'sent' }
        : afterFailure(row.attempts, r.error, deps.now());
      await deps.record(row.id, settled);
      if (settled.status === 'sent') summary.sent += 1;
      else if (settled.status === 'retrying') summary.retrying += 1;
      else summary.deadLetter += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, lane));
  return summary;
}
