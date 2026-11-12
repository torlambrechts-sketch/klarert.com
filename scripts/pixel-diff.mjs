// Compares two screenshots of the same size region by region (design reference vs the app) and writes a diff image.
// Dev-only, for measured comparisons of a page with its design (docs/05 §6): the share of pixels that differ per
// region, with pixelmatch's anti-aliasing detection on.
// Usage: node scripts/pixel-diff.mjs <design.png> <ours.png> <diff.png> [regions.json] [scale]
//   regions.json: [{ "name": "toolbar", "x": 256, "y": 212, "w": 1184, "h": 116 }, …] in CSS pixels;
//   scale: the screenshots' device pixel ratio (default 1). Prints one line per region and the whole image.
import { readFileSync, writeFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const [designPath, oursPath, diffPath, regionsPath, scaleArg] = process.argv.slice(2);
if (!designPath || !oursPath || !diffPath) {
  console.error(
    'Usage: node scripts/pixel-diff.mjs <design.png> <ours.png> <diff.png> [regions.json] [scale]',
  );
  process.exit(1);
}
const scale = Number(scaleArg ?? 1);
const a = PNG.sync.read(readFileSync(designPath));
const b = PNG.sync.read(readFileSync(oursPath));
const width = Math.min(a.width, b.width);
const height = Math.min(a.height, b.height);

/** The pixels of a rectangle of an image, as a tightly packed RGBA buffer. */
function crop(img, x, y, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * img.width + x) * 4;
    img.data.copy(out, row * w * 4, from, from + w * 4);
  }
  return out;
}

function compare(x, y, w, h, diffOut) {
  const cw = Math.max(0, Math.min(w, width - x));
  const ch = Math.max(0, Math.min(h, height - y));
  if (cw === 0 || ch === 0) return { diff: 0, total: 0 };
  const diff = diffOut ? new PNG({ width: cw, height: ch }) : null;
  const n = pixelmatch(crop(a, x, y, cw, ch), crop(b, x, y, cw, ch), diff?.data ?? null, cw, ch, {
    threshold: 0.1,
    includeAA: false,
  });
  if (diff && diffOut) writeFileSync(diffOut, PNG.sync.write(diff));
  return { diff: n, total: cw * ch };
}

const whole = compare(0, 0, width, height, diffPath);
const pct = (r) => (r.total ? ((100 * r.diff) / r.total).toFixed(2) : '0.00');
const regions = regionsPath ? JSON.parse(readFileSync(regionsPath, 'utf8')) : [];
for (const r of regions) {
  const res = compare(
    Math.round(r.x * scale),
    Math.round(r.y * scale),
    Math.round(r.w * scale),
    Math.round(r.h * scale),
  );
  console.log(`${r.name.padEnd(24)} ${pct(res).padStart(6)} %  (${res.diff} of ${res.total} px)`);
}
console.log(
  `${'whole image'.padEnd(24)} ${pct(whole).padStart(6)} %  (${whole.diff} of ${whole.total} px)`,
);
