import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND, HERO, SITE } from '@/components/landing/content';

// The share image of the public pages (owner decision, 16 Nov 2026): static, made once at build time, 1200×630.
// Geist is read from src/fonts (the woff copies made by `pnpm fonts:copy`; next/og cannot read woff2), so nothing is
// fetched from another host.

export const alt = `${SITE.title}: ${HERO.title}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-static';

// ImageResponse cannot read CSS variables, so these are the hex values of the Geist tokens in src/app/globals.css.
// Change them together with the tokens.
const TOKENS = {
  background: '#ffffff', // --background-100 (bg-background)
  ink: '#171717', // --gray-1000 (--ink, --brand)
  muted: '#666666', // --gray-900 (--muted)
  line: '#eaeaea', // --gray-400 (the opaque step of --line, gray-alpha-400 on white)
  good: '#297a3a', // --green-900 (--good)
  goodSoft: '#e5f9eb', // --green-200 (--good-soft)
} as const;

/**
 * Text set glyph by glyph. next/og measures text one character at a time but draws a word with the font's kerning,
 * so Geist's kerning would leave wider gaps after long words; one span per character keeps the spacing even.
 * `gap` is the space between words, in px.
 */
function Words({ text, gap }: { text: string; gap: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: gap }}>
      {text.split(' ').map((word, i) => (
        <div key={i} style={{ display: 'flex' }}>
          {[...word].map((ch, j) => (
            <span key={j}>{ch}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

const font = (weight: 400 | 600) =>
  readFile(join(process.cwd(), `src/fonts/geist-latin-${weight}-normal.woff`));

export default async function OpengraphImage() {
  const [regular, semibold] = await Promise.all([font(400), font(600)]);
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: TOKENS.background,
        color: TOKENS.ink,
        fontFamily: 'Geist',
        borderBottom: `16px solid ${TOKENS.ink}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{ display: 'flex', fontSize: 40, fontWeight: 600, letterSpacing: -1 }}>
          <Words text={BRAND.product} gap={10} />
        </span>
        <span style={{ display: 'flex', fontSize: 26, color: TOKENS.muted }}>
          <Words text={`by ${BRAND.company}`} gap={7} />
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 76,
          fontWeight: 600,
          lineHeight: 1.08,
          letterSpacing: -2,
          maxWidth: 1000,
        }}
      >
        <Words text={HERO.title} gap={20} />
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: `2px solid ${TOKENS.line}`,
          paddingTop: 28,
          fontSize: 26,
          color: TOKENS.muted,
        }}
      >
        <Words text="Registers, automations and an activity log you can verify" gap={7} />
        <span
          style={{
            display: 'flex',
            padding: '6px 16px',
            borderRadius: 999,
            background: TOKENS.goodSoft,
            color: TOKENS.good,
            fontWeight: 600,
          }}
        >
          <Words text="Hosted in the EU" gap={7} />
        </span>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: 'Geist', data: regular, weight: 400, style: 'normal' },
        { name: 'Geist', data: semibold, weight: 600, style: 'normal' },
      ],
    },
  );
}
