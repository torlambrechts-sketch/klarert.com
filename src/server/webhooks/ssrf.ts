// SSRF guard for outbound webhooks (docs/04 §9). Pure apart from the injected resolver: unit-tested with literal
// addresses in every notation and with resolvers that answer like a rebinding attacker (one public answer, one
// private). The worker's transport also calls `assertPublicAddress` on the address it actually connects to, so a
// name that resolves differently between the check and the connection is still refused.
import { isIP } from 'node:net';

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

// ───────────────────────── IPv4 ─────────────────────────

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const cidr4 = (base: string, bits: number): [number, number] => [v4ToInt(base)!, bits];

/** Not reachable on the public internet, or reachable but internal (metadata services, carrier NAT …). */
const BLOCKED_V4: [number, number][] = [
  cidr4('0.0.0.0', 8), // "this" network
  cidr4('10.0.0.0', 8), // private
  cidr4('100.64.0.0', 10), // carrier-grade NAT
  cidr4('127.0.0.0', 8), // loopback
  cidr4('169.254.0.0', 16), // link-local, incl. 169.254.169.254 cloud metadata
  cidr4('172.16.0.0', 12), // private
  cidr4('192.0.0.0', 24), // IETF protocol assignments
  cidr4('192.0.2.0', 24), // documentation
  cidr4('192.88.99.0', 24), // 6to4 relay anycast
  cidr4('192.168.0.0', 16), // private
  cidr4('198.18.0.0', 15), // benchmarking
  cidr4('198.51.100.0', 24), // documentation
  cidr4('203.0.113.0', 24), // documentation
  cidr4('224.0.0.0', 4), // multicast
  cidr4('240.0.0.0', 4), // reserved, incl. 255.255.255.255 broadcast
];

function blockedV4(n: number): boolean {
  return BLOCKED_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return n >= base && n < base + size;
  });
}

// ───────────────────────── IPv6 ─────────────────────────

/** The 128-bit value of an IPv6 address (with an optional dotted IPv4 tail), or null. Zone ids are refused. */
export function v6ToBigInt(ip: string): bigint | null {
  if (ip.includes('%')) return null;
  let s = ip.toLowerCase();
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  if (s.slice(lastColon + 1).includes('.')) {
    const v4 = v4ToInt(s.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    s = `${s.slice(0, lastColon + 1)}x`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) =>
    part === ''
      ? []
      : part
          .split(':')
          .map((h) => (h === 'x' ? -1 : /^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const expand = (list: number[]) => list.flatMap((h) => (h === -1 ? tail : [h]));
  const a = expand(head);
  const b = expand(rest);
  if ([...a, ...b].some((h) => Number.isNaN(h))) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - a.length - b.length;
    if (fill < 1) return null;
    groups = [...a, ...Array<number>(fill).fill(0), ...b];
  } else groups = a;
  if (groups.length !== 8) return null;
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

const cidr6 = (base: string, bits: number): [bigint, number] => [v6ToBigInt(base)!, bits];

const BLOCKED_V6: [bigint, number][] = [
  cidr6('::', 128), // unspecified
  cidr6('::1', 128), // loopback
  cidr6('::', 96), // IPv4-compatible (deprecated)
  cidr6('::ffff:0:0', 96), // IPv4-mapped
  cidr6('::ffff:0:0:0', 96), // IPv4-translated
  cidr6('64:ff9b::', 96), // NAT64 well-known prefix
  cidr6('64:ff9b:1::', 48), // NAT64 local use
  cidr6('100::', 64), // discard
  cidr6('2001::', 32), // Teredo
  cidr6('2001:2::', 48), // benchmarking
  cidr6('2001:db8::', 32), // documentation
  cidr6('2001:10::', 28), // ORCHID
  cidr6('2002::', 16), // 6to4 (embeds an IPv4 address)
  cidr6('fc00::', 7), // unique local, incl. fd00:ec2::254 cloud metadata
  cidr6('fe80::', 10), // link-local
  cidr6('fec0::', 10), // site-local (deprecated)
  cidr6('ff00::', 8), // multicast
];

function blockedV6(n: bigint): boolean {
  return BLOCKED_V6.some(([base, bits]) => n >> BigInt(128 - bits) === base >> BigInt(128 - bits));
}

/** Is this literal address one a webhook must never reach? Anything that does not parse counts as blocked. */
export function isBlockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '');
  const family = isIP(ip);
  if (family === 4) {
    const n = v4ToInt(ip);
    return n === null || blockedV4(n);
  }
  if (family === 6) {
    const n = v6ToBigInt(ip);
    return n === null || blockedV6(n);
  }
  return true;
}

/** Throws unless the address is public. */
export function assertPublicAddress(address: string): void {
  if (isBlockedAddress(address))
    throw new BlockedUrlError('The webhook address points to a private or internal network.');
}

// ───────────────────────── URLs ─────────────────────────

const BLOCKED_NAMES =
  /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$|^metadata(\.google\.internal)?$/;

/**
 * Check a webhook URL before sending: https only, no credentials, a public host name or address, and every address
 * the name resolves to is public (one private answer is enough to refuse). Returns the parsed URL.
 */
export async function checkWebhookUrl(raw: string, resolve: Resolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('The webhook address is not a valid URL.');
  }
  if (url.protocol !== 'https:')
    throw new BlockedUrlError('Webhooks are sent to https:// addresses only.');
  if (url.username || url.password)
    throw new BlockedUrlError('The webhook address must not contain a user name or password.');
  // URL normalises 0x7f.1, 2130706433 and similar to dotted quads, and keeps IPv6 in brackets
  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!host) throw new BlockedUrlError('The webhook address has no host.');
  if (isIP(host)) {
    assertPublicAddress(host);
    return url;
  }
  if (BLOCKED_NAMES.test(host) || !host.includes('.'))
    throw new BlockedUrlError('The webhook address points to a private or internal network.');
  let answers: { address: string }[];
  try {
    answers = await resolve(host);
  } catch {
    throw new BlockedUrlError(`The host ${host} could not be found.`);
  }
  if (answers.length === 0) throw new BlockedUrlError(`The host ${host} could not be found.`);
  for (const a of answers) assertPublicAddress(a.address);
  return url;
}
