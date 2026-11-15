import { createHmac } from 'node:crypto';

// RFC 6238 time-based codes, as an authenticator app makes them (SHA-1, 30-second steps, 6 digits), for the two-step
// sign-in specs. The secret is the base32 key the set-up page shows.

function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/[\s=]/g, '').toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error(`not base32: ${c}`);
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const step = (now = Date.now()) => Math.floor(now / 1000 / 30);

export function totp(secret: string, at = step()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(at));
  const mac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
}

/**
 * A code from a 30-second step that has not been used yet in this test (Supabase Auth may refuse a code twice).
 * Waits for the next step when needed, and never hands out a code in its last two seconds.
 */
export async function freshCode(secret: string, used: Set<number>): Promise<string> {
  for (;;) {
    const now = Date.now();
    const s = step(now);
    const left = 30_000 - (now % 30_000);
    if (!used.has(s) && left > 2_000) {
      used.add(s);
      return totp(secret, s);
    }
    await new Promise((r) => setTimeout(r, left + 100));
  }
}
