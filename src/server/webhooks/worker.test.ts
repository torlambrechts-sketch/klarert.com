import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BlockedUrlError } from './ssrf';
import {
  afterFailure,
  attempt,
  BACKOFF_MS,
  MAX_FAILURES,
  runWebhookWorker,
  SIGNATURE_HEADER,
  type Settled,
  type WebhookRow,
  type WorkerDeps,
} from './worker';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const MIN = 60_000;

describe('backoff schedule', () => {
  it('waits 1 min, 5 min, 30 min, 2 h after the 1st to 4th failure', () => {
    const waits = [0, 1, 2, 3].map((attempts) => {
      const s = afterFailure(attempts, 'HTTP 500', NOW);
      return s.status === 'retrying' ? (s.nextAttemptAt.getTime() - NOW) / MIN : s.status;
    });
    expect(waits).toEqual([1, 5, 30, 120]);
    expect(BACKOFF_MS.map((ms) => ms / MIN)).toEqual([1, 5, 30, 120, 360]);
  });

  it('the 5th failure is a dead letter', () => {
    expect(MAX_FAILURES).toBe(5);
    expect(afterFailure(4, 'HTTP 500', NOW)).toEqual({ status: 'dead_letter', error: 'HTTP 500' });
    expect(afterFailure(9, 'x', NOW).status).toBe('dead_letter');
  });
});

const row = (over: Partial<WebhookRow> = {}): WebhookRow => ({
  id: 'w1',
  url: 'https://hooks.example.com/a',
  payload: { event: 'automation' },
  attempts: 0,
  ...over,
});
const okCheck = async (u: string) => new URL(u);

describe('attempt', () => {
  it('2xx is sent, with the JSON payload', async () => {
    let body = '';
    const r = await attempt(row(), {
      check: okCheck,
      send: async (_u, b) => {
        body = b;
        return 204;
      },
    });
    expect(r).toEqual({ ok: true });
    expect(JSON.parse(body)).toEqual({ event: 'automation' });
  });

  it.each([
    [500, 'HTTP 500'],
    [404, 'HTTP 404'],
    [302, 'HTTP 302: redirects are not followed.'],
    [301, 'HTTP 301: redirects are not followed.'],
  ])('HTTP %i is a failure', async (status, error) => {
    expect(await attempt(row(), { check: okCheck, send: async () => status })).toEqual({
      ok: false,
      error,
    });
  });

  it('a blocked address fails without sending', async () => {
    let sent = false;
    const r = await attempt(row({ url: 'https://127.0.0.1/' }), {
      check: async () => {
        throw new BlockedUrlError('The webhook address points to a private or internal network.');
      },
      send: async () => {
        sent = true;
        return 200;
      },
    });
    expect(sent).toBe(false);
    expect(r).toEqual({
      ok: false,
      error: 'The webhook address points to a private or internal network.',
    });
  });

  it('a blocked address at connect time (DNS changed) fails', async () => {
    const r = await attempt(row(), {
      check: okCheck,
      send: async () => {
        throw new BlockedUrlError('The webhook address points to a private or internal network.');
      },
    });
    expect(r).toEqual({
      ok: false,
      error: 'The webhook address points to a private or internal network.',
    });
  });

  it('times out and aborts the request', async () => {
    let aborted = false;
    const r = await attempt(row(), {
      check: okCheck,
      timeoutMs: 20,
      send: (_u, _b, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });
    expect(aborted).toBe(true);
    expect(r).toEqual({ ok: false, error: 'No answer within 0 s.' });
  });

  it('a network error is a failure with its message', async () => {
    const r = await attempt(row(), {
      check: okCheck,
      send: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    expect(r).toEqual({ ok: false, error: 'connect ECONNREFUSED' });
  });
});

describe('runWebhookWorker', () => {
  function deps(rows: WebhookRow[], status: (url: string) => number) {
    const recorded: [string, Settled][] = [];
    let limit = 0;
    const d: WorkerDeps = {
      claim: async (n) => {
        limit = n;
        return rows;
      },
      record: async (id, s) => {
        recorded.push([id, s]);
      },
      check: okCheck,
      send: async (url) => status(url.toString()),
      now: () => NOW,
    };
    return { d, recorded, limit: () => limit };
  }

  it('claims at most 50 and records each outcome', async () => {
    const { d, recorded, limit } = deps(
      [
        row({ id: 'ok', url: 'https://a.example.com/' }),
        row({ id: 'retry', url: 'https://b.example.com/', attempts: 1 }),
        row({ id: 'dead', url: 'https://b.example.com/', attempts: 4 }),
      ],
      (u) => (u.startsWith('https://a.') ? 200 : 503),
    );
    expect(await runWebhookWorker(d)).toEqual({ claimed: 3, sent: 1, retrying: 1, deadLetter: 1 });
    expect(limit()).toBe(50);
    expect(Object.fromEntries(recorded)).toEqual({
      ok: { status: 'sent' },
      retry: { status: 'retrying', nextAttemptAt: new Date(NOW + 5 * MIN), error: 'HTTP 503' },
      dead: { status: 'dead_letter', error: 'HTTP 503' },
    });
  });

  it('a failing URL walks the whole schedule into the dead letter', async () => {
    let attempts = 0;
    const states: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { d, recorded } = deps([row({ attempts })], () => 500);
      await runWebhookWorker(d);
      const s = recorded[0]![1];
      states.push(
        s.status === 'retrying' ? `retry +${(s.nextAttemptAt.getTime() - NOW) / MIN}m` : s.status,
      );
      attempts += 1;
    }
    expect(states).toEqual(['retry +1m', 'retry +5m', 'retry +30m', 'retry +120m', 'dead_letter']);
  });

  it('does nothing when nothing is due', async () => {
    const { d, recorded } = deps([], () => 200);
    expect(await runWebhookWorker(d)).toEqual({ claimed: 0, sent: 0, retrying: 0, deadLetter: 0 });
    expect(recorded).toEqual([]);
  });
});

describe('signed webhooks (0056, SA-12)', () => {
  const hmacHex = (key: string, message: string) =>
    createHmac('sha256', key).update(message).digest('hex');
  const row: WebhookRow = {
    id: 'w1',
    url: 'https://hooks.example.com/x',
    payload: { item: 'CA-001' },
    attempts: 0,
    signingKey: 'k3y',
  };

  it('sends X-Klarert-Signature: t=<unix>,v1=HMAC-SHA256(key, "<t>.<body>")', async () => {
    let seen: { body: string; headers: Record<string, string> } | null = null;
    const r = await attempt(row, {
      check: async (u) => new URL(u),
      send: async (_u, body, _s, headers) => {
        seen = { body, headers };
        return 200;
      },
      now: () => NOW,
      hmacHex,
    });
    expect(r).toEqual({ ok: true });
    const t = Math.floor(NOW / 1000);
    expect(seen!.headers[SIGNATURE_HEADER]).toBe(
      `t=${t},v1=${hmacHex('k3y', `${t}.${seen!.body}`)}`,
    );
    expect(seen!.body).toBe(JSON.stringify({ item: 'CA-001' }));
  });

  it('a row whose automation is gone goes unsigned', async () => {
    let headers: Record<string, string> | null = null;
    await attempt(
      { ...row, signingKey: null },
      {
        check: async (u) => new URL(u),
        send: async (_u, _b, _s, h) => {
          headers = h;
          return 200;
        },
        now: () => NOW,
        hmacHex,
      },
    );
    expect(headers).toEqual({});
  });
});
