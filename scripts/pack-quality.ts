// The pack quality bar (docs/11) for every native pack in templates/packs, or the ones named:
// `pnpm exec tsx scripts/pack-quality.ts [key …]`. Prints each problem; exits 1 when a named pack fails.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePack } from '../src/lib/packs/manifest';
import { packQualityProblems } from '../src/lib/packs/quality';

const dir = join(process.cwd(), 'templates/packs');
const only = process.argv.slice(2);
let failed = false;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const m = parsePack(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  if (only.length && !only.includes(m.key)) continue;
  const problems = packQualityProblems(m);
  console.log(
    `${m.key} ${m.version}: ${problems.length ? `${problems.length} problems` : 'meets the bar'}`,
  );
  for (const p of problems) console.log(`  ${p.rule} · ${p.path}: ${p.message}`);
  if (only.length && problems.length) failed = true;
}
process.exit(failed ? 1 : 0);
