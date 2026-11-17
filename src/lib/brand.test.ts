import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND, EMAIL_SENDER, SITE_URL, SUPPORT_EMAIL } from './brand';

// The rename to Keptrow (owner decision, 16 Nov 2026; docs/14).

const ROOT = process.cwd();
/** The code, the email templates, the scripts, the tests and the templates, and the config files beside them. */
const SCANNED_DIRS = ['src', 'supabase/templates', 'scripts', 'tests', 'templates'];
const SCANNED_FILES = [
  'next.config.ts',
  '.env.example',
  'package.json',
  'supabase/config.toml',
  'supabase/seed.sql',
];

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory())
      return e.name === '__pycache__' || e.name === 'node_modules' ? [] : files(path);
    return /\.(ts|tsx|mjs|cjs|js|css|html|json|md|py|sql|toml)$/.test(e.name) ? [path] : [];
  });
}

/** Every scanned file that contains `needle` (any case), with its line numbers. */
function hits(needle: RegExp): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  for (const file of [...SCANNED_DIRS.flatMap(files), ...SCANNED_FILES]) {
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
  'src/lib/brand.test.ts': 'this allow-list',
  'scripts/seed-risk-register.ts':
    'cites the design file compliance-os.js (reference/compliance-os-sun-v2.html), a file name',
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
  'src/lib/reset-link.ts':
    'the httpOnly cookie klarert-reset-link: renaming it only makes a reset under way at the deploy start again',
  'templates/frameworks/crosswalks.json':
    '"Klarert mapping v1": the stored source of every cross-walk',
  'tests/e2e/frameworks.spec.ts': 'asserts the stored cross-walk source "Klarert mapping v1"',
  'tests/e2e/landing.spec.ts':
    'the 301 from klarert.com and www.klarert.com (email links included), and that no page says Klarert',
  'next.config.ts': 'serves LEGACY_REDIRECTS and explains the HSTS policy www.klarert.com keeps',
  '.env.example': 'SUPABASE_COMMAND_SECRET is the Vault secret klarert_command_secret',
  'supabase/config.toml': 'project_id "klarert.com" names the local Docker containers and volumes',
  'supabase/seed.sql': 'seeds the Vault secret klarert_command_secret (migration 0053)',
  'scripts/hosted/README.md':
    'the Vault secret klarert_command_secret, and klarert.com kept in Brevo and as an auth redirect URL',
  'scripts/hosted/auth-config.py': 'keeps the klarert.com redirect URLs during the transition',
};

describe('the brand', () => {
  it('is Keptrow, with the descriptor, on www.keptrow.com', () => {
    expect(BRAND.product).toBe('Keptrow');
    expect(BRAND.wordmark).toBe('Keptrow');
    expect(BRAND.descriptor).toBe('Keptrow — the compliance spreadsheet');
    expect(SITE_URL).toBe('https://www.keptrow.com');
    expect(SUPPORT_EMAIL).toBe('support@keptrow.com');
    expect(EMAIL_SENDER).toBe('Keptrow <no-reply@keptrow.com>');
  });

  it('no scanned file names the old product, except the allow-list', () => {
    const found = hits(OLD_NAME);
    const outside = Object.keys(found).filter((f) => !(f in OLD_NAME_ALLOWED));
    expect(outside.map((f) => `${f}:${found[f]!.join(',')}`)).toEqual([]);
  });

  it('"klarert" is left only in wire names, stored keys and the redirect, each with a reason', () => {
    const found = hits(/klarert/i);
    const outside = Object.keys(found).filter((f) => !(f in KLARERT_ALLOWED));
    expect(outside.map((f) => `${f}:${found[f]!.join(',')}`)).toEqual([]);
  });

  it('the email sender is on the root domain, never a mail. subdomain', () => {
    const found = hits(/mail\.(keptrow|klarert)\.com/i);
    // the redirect's tests name the old mail subdomain as a host that is not redirected
    delete found['src/lib/site/legacy-domain.test.ts'];
    expect(found).toEqual({});
  });

  it('the allow-lists hold no stale entries', () => {
    const old = hits(OLD_NAME);
    const klarert = hits(/klarert/i);
    expect(Object.keys(OLD_NAME_ALLOWED).filter((f) => !(f in old))).toEqual([]);
    expect(Object.keys(KLARERT_ALLOWED).filter((f) => !(f in klarert))).toEqual([]);
  });
});
