import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND, EMAIL_SENDER, SITE_URL, SUPPORT_EMAIL } from './brand';

// The rename to Keptrow (owner decision, 16 Nov 2026; docs/14).

const ROOT = process.cwd();
const SCANNED = ['src', 'supabase/templates'];

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) return files(path);
    return /\.(ts|tsx|css|html|json|md)$/.test(e.name) ? [path] : [];
  });
}

/** Every file under src/ and supabase/templates/ that contains `needle` (any case), with its line numbers. */
function hits(needle: RegExp): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  for (const file of SCANNED.flatMap(files)) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    const at = lines.flatMap((l, i) => (needle.test(l) ? [i + 1] : []));
    if (at.length) found[relative(ROOT, join(ROOT, file))] = at;
  }
  return found;
}

// the old name, built so this file does not match itself
const OLD_NAME = new RegExp(['Compliance', 'OS\\b'].join('[\\s_-]*'), 'i');

/** Files that may still name the old product, and why. Nothing a person sees. */
const OLD_NAME_ALLOWED: Record<string, string> = {
  'src/lib/brand.ts': 'the comment that records the rename',
  'src/server/commands/two-step.ts':
    'the comment saying authenticator apps set up before the rename keep the old label',
};

/** Files that may say "klarert", and why: wire names, stored keys and the old domain's redirect. */
const KLARERT_ALLOWED: Record<string, string> = {
  'src/lib/brand.ts': 'the comment that records the rename and the redirect',
  'src/lib/brand.test.ts': 'this allow-list',
  'src/lib/site/legacy-domain.ts': 'klarert.com and www.klarert.com redirect to www.keptrow.com',
  'src/lib/site/legacy-domain.test.ts': 'tests of that redirect',
  'src/lib/supabase/command-proof.ts':
    'x-klarert-command and klarert_command_secret: wire names the database checks (migration 0053)',
  'src/server/webhooks/worker.ts': 'X-Klarert-Signature: receivers already verify this header',
  'src/server/webhooks/worker.test.ts': 'tests of X-Klarert-Signature',
  'src/server/commands/automations.ts': 'names X-Klarert-Signature for the signing key',
  'src/components/automations/builder.tsx': 'tells owners the X-Klarert-Signature header name',
  'src/server/commands/frameworks.ts':
    '"Klarert mapping v1": the stored source of every cross-walk',
  'src/engine/frameworks/types.ts': '"Klarert mapping v1": the stored source of every cross-walk',
  'src/lib/frameworks/catalogue.test.ts':
    'asserts the stored cross-walk source "Klarert mapping v1"',
  'src/components/packs/setup-card.tsx':
    'the browser storage key klarert.setup-dismissed.*: renaming it would bring back dismissed cards',
};

describe('the brand', () => {
  it('is Keptrow, with the descriptor, on www.keptrow.com', () => {
    expect(BRAND.product).toBe('Keptrow');
    expect(BRAND.wordmark).toBe('Keptrow');
    expect(BRAND.descriptor).toBe('Keptrow — the compliance spreadsheet');
    expect(SITE_URL).toBe('https://www.keptrow.com');
    expect(SUPPORT_EMAIL).toBe('support@keptrow.com');
    expect(EMAIL_SENDER).toBe('Keptrow <no-reply@mail.keptrow.com>');
  });

  it('no file in src/ or supabase/templates/ names the old product, except the allow-list', () => {
    const found = hits(OLD_NAME);
    for (const file of Object.keys(found))
      expect(OLD_NAME_ALLOWED, `${file}:${found[file]!.join(',')}`).toHaveProperty([file]);
  });

  it('"klarert" is left only in wire names, stored keys and the redirect, each with a reason', () => {
    const found = hits(/klarert/i);
    for (const file of Object.keys(found))
      expect(KLARERT_ALLOWED, `${file}:${found[file]!.join(',')}`).toHaveProperty([file]);
  });

  it('the allow-lists hold no stale entries', () => {
    const old = hits(OLD_NAME);
    const klarert = hits(/klarert/i);
    for (const file of Object.keys(OLD_NAME_ALLOWED)) expect(old, file).toHaveProperty([file]);
    for (const file of Object.keys(KLARERT_ALLOWED)) expect(klarert, file).toHaveProperty([file]);
  });
});
