import localFont from 'next/font/local';

// Figtree (the app's type, docs/18 §3; OFL, src/fonts/figtree-OFL.txt) and Geist Mono (ids, hashes and codes),
// self-hosted from src/fonts; no font requests leave the app.
export const figtree = localFont({
  variable: '--font-figtree',
  display: 'swap',
  src: [
    { path: '../fonts/figtree-latin-400-normal.woff2', weight: '400' },
    { path: '../fonts/figtree-latin-500-normal.woff2', weight: '500' },
    { path: '../fonts/figtree-latin-600-normal.woff2', weight: '600' },
    { path: '../fonts/figtree-latin-700-normal.woff2', weight: '700' },
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
