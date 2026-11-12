import localFont from 'next/font/local';

// Geist and Geist Mono, self-hosted from src/fonts (pnpm fonts:copy); no font requests leave the app.
export const geist = localFont({
  variable: '--font-geist',
  display: 'swap',
  src: [
    { path: '../fonts/geist-sans-latin-400-normal.woff2', weight: '400' },
    { path: '../fonts/geist-sans-latin-500-normal.woff2', weight: '500' },
    { path: '../fonts/geist-sans-latin-600-normal.woff2', weight: '600' },
    { path: '../fonts/geist-sans-latin-700-normal.woff2', weight: '700' },
  ],
});

export const geistMono = localFont({
  variable: '--font-geist-mono',
  display: 'swap',
  src: [
    { path: '../fonts/geist-mono-latin-400-normal.woff2', weight: '400' },
    { path: '../fonts/geist-mono-latin-500-normal.woff2', weight: '500' },
  ],
});
