// Fails when a client bundle contains the service-role key or mentions it (M10 security review, docs/09).
// Run after `pnpm build`:  node scripts/security/check-client-bundle.mjs
// Looks in .next/static (everything the browser can download). The key value comes from SUPABASE_SERVICE_ROLE_KEY or
// .env.local; the names SUPABASE_SERVICE_ROLE_KEY and service_role must not appear either.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = '.next/static';
if (!existsSync(root)) {
  console.error(`${root} not found. Run pnpm build first.`);
  process.exit(2);
}

function envKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const line = readFileSync('.env.local', 'utf8')
      .split('\n')
      .find((l) => l.startsWith('SUPABASE_SERVICE_ROLE_KEY='));
    return line?.slice('SUPABASE_SERVICE_ROLE_KEY='.length).trim().replace(/^"|"$/g, '') || '';
  } catch {
    return '';
  }
}

const key = envKey();
if (key.length < 20) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set: cannot look for its value.');
  process.exit(2);
}
// the key, and the payload and signature of a JWT key separately (a bundler could split a string). The JWT header
// is the same for every key of the project (the public anon key has it too), so it is not a secret.
const parts = key.split('.');
const needles = [
  { label: 'the service-role key value', text: key },
  ...(parts.length === 3
    ? [
        { label: 'the service-role key payload', text: parts[1] },
        { label: 'the service-role key signature', text: parts[2] },
      ]
    : []),
  { label: 'SUPABASE_SERVICE_ROLE_KEY', text: 'SUPABASE_SERVICE_ROLE_KEY' },
  { label: 'service_role', text: 'service_role' },
];

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(root);

const hits = [];
for (const f of files) {
  const text = readFileSync(f, 'latin1');
  for (const n of needles) if (text.includes(n.text)) hits.push(`${f}: ${n.label}`);
}
if (hits.length) {
  console.error(`Client bundles must not contain the service role:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log(`Checked ${files.length} files in ${root}: no service-role key or name.`);
