// Copies Geist Mono's woff2 files from @fontsource into src/fonts (committed; run again after upgrading), and the
// two woff files the share image needs (src/app/opengraph-image.tsx: next/og reads woff, ttf and otf, not woff2).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const out = new URL('../src/fonts/', import.meta.url);
mkdirSync(out, { recursive: true });

const sets = [['@fontsource/geist-mono', 'geist-mono', [400, 500]]];
for (const [pkg, name, weights] of sets) {
  const dir = join(dirname(require.resolve(`${pkg}/package.json`)), 'files');
  for (const w of weights) {
    const file = `${name}-latin-${w}-normal.woff2`;
    copyFileSync(join(dir, file), new URL(file, out));
  }
}
const geistDir = join(dirname(require.resolve('@fontsource/geist/package.json')), 'files');
for (const w of [400, 600]) {
  const file = `geist-latin-${w}-normal.woff`;
  copyFileSync(join(geistDir, file), new URL(file, out));
}
// Figtree (the app's type, docs/18 §3) was copied by hand from `npm pack @fontsource/figtree` with its licence
// (src/fonts/figtree-OFL.txt); it is not a dependency.
console.log('fonts copied to src/fonts');
