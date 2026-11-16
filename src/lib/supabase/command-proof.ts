// The command gate (migration 0053, security review SA-3): the database refuses writes from people unless the request
// carries `x-klarert-command: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<user id>")>`. Only the app's server
// knows the secret, so writes come through the server commands (CLAUDE.md rule 2), with their validation, status
// rules and automations. Pure apart from the injected clock and HMAC, so it is unit-tested; server.ts wires it in.

export const COMMAND_HEADER = 'x-klarert-command';

/** The well-known local development secret (supabase/seed.sql); never used for a hosted Supabase URL. */
export const LOCAL_COMMAND_SECRET = 'klarert-local-command-secret';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']);

/** True when the URL points at this machine (the local Supabase stack); false for anything else or a bad URL. */
export function isLocalUrl(url: string | undefined): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url ?? '').hostname);
  } catch {
    return false;
  }
}

/**
 * The secret to sign with: SUPABASE_COMMAND_SECRET, else the local development value when the Supabase URL is on this
 * machine. Null otherwise: no header is sent and the database refuses the write (fail closed).
 */
export function commandSecret(env: { secret?: string; supabaseUrl: string }): string | null {
  const s = env.secret?.trim();
  if (s) return s;
  return isLocalUrl(env.supabaseUrl) ? LOCAL_COMMAND_SECRET : null;
}

/** The user id (`sub`) of a bearer JWT, unverified: the database binds the proof to the session it verifies. */
export function jwtSubject(authorization: string | null): string {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const payload = token?.split('.')[1];
  if (!payload) return '';
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub?: unknown };
    return typeof json.sub === 'string' && json.sub !== '' ? json.sub : '';
  } catch {
    return '';
  }
}

/** The header value for a request made as `userId` ('' when signed out) at `nowMs`. */
export function commandProof(
  secret: string,
  userId: string,
  nowMs: number,
  hmacHex: (key: string, message: string) => string,
): string {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v1=${hmacHex(secret, `${t}.${userId}`)}`;
}

/**
 * A fetch for the person's server client: requests to PostgREST carry the proof, bound to the session in their
 * Authorization header. Everything else (Auth, Storage) is passed through unchanged.
 */
export function withCommandProof(
  base: typeof fetch,
  opts: {
    secret: string | null;
    restUrl: string;
    now: () => number;
    hmacHex: (key: string, message: string) => string;
  },
): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!opts.secret || !url.startsWith(opts.restUrl)) return base(input, init);
    const headers = new Headers(
      init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined),
    );
    headers.set(
      COMMAND_HEADER,
      commandProof(opts.secret, jwtSubject(headers.get('authorization')), opts.now(), opts.hmacHex),
    );
    return base(input, { ...init, headers });
  };
}
