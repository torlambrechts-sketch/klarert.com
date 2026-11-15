// Email transports (docs/09 §10). One interface, `send(message)`, and two transports:
// - Brevo's transactional API (https://api.brevo.com/v3/smtp/email; Brevo keeps data in the EU) when BREVO_API_KEY
//   is set;
// - local Mailpit, the Supabase local stack's mail catcher, through its HTTP send API, only when the Supabase URL is
//   on this machine (local development and CI, where e2e reads the mail back).
// Anything else fails closed: nothing is sent, the caller is told, and one clear error is logged. Real mail never
// leaves CI: there the key is ignored. Logs carry the tag and the outcome only, never an address, subject or body.
// Pure apart from the injected env, fetch and log, so it is unit-tested with a fake fetch; index.ts wires it in.

import { isLocalUrl } from '@/lib/supabase/command-proof';

/** What a message is, for logs and the provider's tag: lowercase letters, digits, `_` and `-`. */
export type EmailTag = 'invite' | 'invite_resend';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  tag: EmailTag;
  /**
   * One key per intended email, e.g. `invite/<id>`. Brevo has no idempotency key (checked 15 Nov 2026), so it is sent
   * as `X-Mailin-custom` to trace the message in Brevo's logs, and duplicates are prevented on our side: one send per
   * invite created (an address has one open invite), resends counted and rate-limited in the database (0070).
   */
  idempotencyKey: string;
}

export type SendResult =
  | { sent: true; id: string | null }
  | {
      sent: false;
      /** not_configured: no transport; rejected: the provider refused it; unavailable: try again later. */
      reason: 'not_configured' | 'rejected' | 'unavailable';
    };

export interface EmailTransport {
  readonly name: 'brevo' | 'local';
  send(message: EmailMessage): Promise<SendResult & { status?: number }>;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;
export type EmailEnv = Readonly<Record<string, string | undefined>>;

export const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
/** Supabase's local Mailpit web port (supabase/config.toml [local_smtp]); MAILPIT_URL overrides it. */
export const LOCAL_MAILPIT_URL = 'http://127.0.0.1:54324';
const LOCAL_FROM = 'Compliance OS <no-reply@mail.klarert.com>';
const TIMEOUT_MS = 10_000;

const ADDRESS = /^[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+$/;

/** `Name <address>` or a bare address; null when it is not one. */
export function parseFrom(from: string | undefined): { name: string; email: string } | null {
  const raw = from?.trim();
  if (!raw) return null;
  const named = raw.match(/^(.*?)\s*<([^<>]+)>$/);
  const email = (named ? named[2]! : raw).trim();
  if (!ADDRESS.test(email)) return null;
  return { name: (named?.[1] ?? '').trim().replace(/^"(.*)"$/, '$1'), email };
}

/** Too many requests and server errors can pass; anything else (400 bad request, 401 bad key) was refused. */
const outcome = (status: number): 'rejected' | 'unavailable' =>
  status === 429 || status >= 500 ? 'unavailable' : 'rejected';

export function brevoTransport(opts: {
  apiKey: string;
  from: string;
  fetch: Fetch;
}): EmailTransport {
  const sender = parseFrom(opts.from)!;
  return {
    name: 'brevo',
    async send(m) {
      const res = await opts.fetch(BREVO_URL, {
        method: 'POST',
        headers: {
          'api-key': opts.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: sender.name
            ? { email: sender.email, name: sender.name }
            : { email: sender.email },
          // no open pixel (honoured on Brevo Enterprise plans) and opens and clicks anonymised (docs/09 §10)
          to: [{ email: m.to, contactPixelTrackingConsent: false, removeTrackingPixel: true }],
          subject: m.subject,
          htmlContent: m.html,
          textContent: m.text,
          tags: [m.tag],
          headers: { 'X-Mailin-custom': m.idempotencyKey },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { sent: false, reason: outcome(res.status), status: res.status };
      const body = (await res.json().catch(() => null)) as { messageId?: unknown } | null;
      return {
        sent: true,
        id: typeof body?.messageId === 'string' ? body.messageId : null,
        status: res.status,
      };
    },
  };
}

export function localTransport(opts: { url: string; from: string; fetch: Fetch }): EmailTransport {
  const from = parseFrom(opts.from) ?? parseFrom(LOCAL_FROM)!;
  return {
    name: 'local',
    async send(m) {
      const res = await opts.fetch(`${opts.url.replace(/\/+$/, '')}/api/v1/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: { Email: from.email, Name: from.name },
          To: [{ Email: m.to }],
          Subject: m.subject,
          Text: m.text,
          HTML: m.html,
          Tags: [m.tag],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { sent: false, reason: outcome(res.status), status: res.status };
      const body = (await res.json().catch(() => null)) as { ID?: unknown } | null;
      return { sent: true, id: typeof body?.ID === 'string' ? body.ID : null, status: res.status };
    },
  };
}

export type TransportChoice = { transport: EmailTransport } | { transport: null; problem: string };

/** CI runners (not Vercel, which sets CI only while it builds): no real mail ever leaves them. */
const inCi = (env: EmailEnv) => !!env.CI && env.CI !== 'false' && !env.VERCEL;

/**
 * Brevo when BREVO_API_KEY is set (and EMAIL_FROM is an address), outside CI. Otherwise Mailpit, only when the
 * Supabase URL is on this machine. Otherwise none: the problem says what to set.
 */
export function chooseTransport(env: EmailEnv, fetch: Fetch): TransportChoice {
  const key = env.BREVO_API_KEY?.trim();
  const local = isLocalUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (key && !inCi(env)) {
    const from = env.EMAIL_FROM?.trim();
    if (!from || !parseFrom(from))
      return {
        transport: null,
        problem:
          'EMAIL_FROM is missing or not an email address: no email is sent until it is set (for example "Compliance OS <no-reply@mail.klarert.com>")',
      };
    return { transport: brevoTransport({ apiKey: key, from, fetch }) };
  }
  if (local)
    return {
      transport: localTransport({
        url: env.MAILPIT_URL?.trim() || LOCAL_MAILPIT_URL,
        from: env.EMAIL_FROM?.trim() || LOCAL_FROM,
        fetch,
      }),
    };
  return {
    transport: null,
    problem: key
      ? 'BREVO_API_KEY is ignored in CI and Supabase is not local: no email is sent'
      : 'BREVO_API_KEY is not set: no email is sent until BREVO_API_KEY and EMAIL_FROM are set',
  };
}

export type EmailLog = (level: 'info' | 'error', fields: Record<string, unknown>) => void;

/**
 * Send one message with the chosen transport. Never throws. Logs the tag, the transport and the outcome (with the
 * provider's status code on failure), never the address, subject or body.
 */
export async function deliver(
  message: EmailMessage,
  deps: { env: EmailEnv; fetch: Fetch; log: EmailLog },
): Promise<SendResult> {
  const choice = chooseTransport(deps.env, deps.fetch);
  if (!choice.transport) {
    deps.log('error', { tag: message.tag, outcome: 'not_configured', message: choice.problem });
    return { sent: false, reason: 'not_configured' };
  }
  const transport = choice.transport.name;
  try {
    const { status, ...result } = await choice.transport.send(message);
    deps.log(result.sent ? 'info' : 'error', {
      tag: message.tag,
      transport,
      outcome: result.sent ? 'sent' : result.reason,
      ...(result.sent ? {} : { status }),
    });
    return result;
  } catch (e) {
    // a timeout or a network error: the name only (a message could echo the request)
    deps.log('error', {
      tag: message.tag,
      transport,
      outcome: 'unavailable',
      error: e instanceof Error ? e.name : 'Error',
    });
    return { sent: false, reason: 'unavailable' };
  }
}

/** Whether any transport is set up: commands that count a send (a resend) check this first. */
export const emailConfigured = (env: EmailEnv) =>
  chooseTransport(env, () => Promise.reject(new Error('not sending'))).transport !== null;
