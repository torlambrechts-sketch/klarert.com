import 'server-only';
import dns from 'node:dns';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { assertPublicAddress, BlockedUrlError, type Resolver } from './ssrf';

// The webhook transport: one HTTPS POST. Node's https rather than fetch, because the address check must apply to
// the connection itself: the lookup below refuses the socket when any address the name resolves to is private, so a
// DNS answer that changes between checkWebhookUrl and the connection (rebinding) cannot reach an internal host.
// https.request never follows redirects (a 3xx is reported as such and counts as a failure), and the AbortSignal
// carries the worker's 10 s timeout.

/** All addresses of a name (the resolver checkWebhookUrl uses). */
export const resolveAll: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true });

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    try {
      if (addresses.length === 0)
        throw new BlockedUrlError(`The host ${hostname} could not be found.`);
      for (const a of addresses) assertPublicAddress(a.address);
    } catch (e) {
      return callback(e as NodeJS.ErrnoException, '', 0);
    }
    if (options.all)
      return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
};

export function postJson(
  url: URL,
  body: string,
  signal: AbortSignal,
  extra: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        signal,
        lookup: guardedLookup,
        headers: {
          ...extra,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'ComplianceOS-Webhooks/1.0',
        },
      },
      (res) => {
        res.resume(); // the body is not used
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
