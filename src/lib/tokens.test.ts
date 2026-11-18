import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// White words on the brand navy and on every solid option colour stay at 4.5:1 or more (docs/05 §6.1, docs/18 C1
// and C3). Reads the tokens from globals.css, so a changed value fails here.

const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
const tokens = new Map<string, string>();
for (const m of root.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) tokens.set(m[1]!, m[2]!.trim());

function resolve(value: string, depth = 0): string {
  const v = value.match(/^var\(--([a-z0-9-]+)(?:,\s*[^)]+)?\)$/);
  if (!v) return value;
  if (depth > 8) throw new Error(`var() loop at ${value}`);
  const next = tokens.get(v[1]!);
  if (!next) throw new Error(`unknown token --${v[1]}`);
  return resolve(next, depth + 1);
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const onWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

describe('colour tokens', () => {
  it('defines navy and points the brand at it', () => {
    expect(tokens.get('navy-900')?.toLowerCase()).toBe('#0000a0');
    expect(tokens.get('navy-1000')?.toLowerCase()).toBe('#00005e');
    expect(resolve(tokens.get('brand')!).toLowerCase()).toBe('#0000a0');
    expect(resolve(tokens.get('brand-hover')!).toLowerCase()).toBe('#00005e');
  });

  const solids = [...tokens.keys()].filter((k) => k.startsWith('solid-'));
  it('has solid colours to check', () => expect(solids.length).toBeGreaterThanOrEqual(10));

  it.each(['brand', 'brand-hover', ...solids])('white text on --%s is at least 4.5:1', (name) => {
    const hex = resolve(tokens.get(name)!);
    expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(onWhite(hex)).toBeGreaterThanOrEqual(4.5);
  });
});
