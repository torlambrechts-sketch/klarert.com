import 'server-only';
import type { Result } from '@/server/result';

// Shared by the audit download routes (docs/11 Audit outputs): POST only, from this site only (a cross-site form
// cannot make someone export), the command's refusal in plain text, the file as an attachment never cached.

const STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
};

export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return req.headers.get('sec-fetch-site') === 'same-origin';
  try {
    return (
      new URL(origin).host === (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))
    );
  } catch {
    return false;
  }
}

export function refusal(message: string, status = 403): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  });
}

export function fromResult(r: Extract<Result<unknown>, { ok: false }>): Response {
  return refusal(r.error.message, STATUS[r.error.code] ?? 500);
}

export function attachment(body: BodyInit, filename: string, type: string): Response {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
