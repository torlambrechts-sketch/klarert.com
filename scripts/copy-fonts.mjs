// Copies the self-hosted woff2 files from @fontsource into src/fonts (committed; run again after upgrading).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const out = new URL('../src/fonts/', import.meta.url);
mkdirSync(out, { recursive: true });

const sets = [
  ['@fontsource/plus-jakarta-sans', 'plus-jakarta-sans', [400, 500, 600, 700, 800]],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono', [400, 500]],
];
for (const [pkg, name, weights] of sets) {
  const dir = join(dirname(require.resolve(`${pkg}/package.json`)), 'files');
  for (const w of weights) {
    const file = `${name}-latin-${w}-normal.woff2`;
    copyFileSync(join(dir, file), new URL(file, out));
  }
}
console.log('fonts copied to src/fonts');
