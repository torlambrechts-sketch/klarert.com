import type { Metadata } from 'next';
import { OfflineBanner } from '@/components/states/offline-banner';
import { SITE } from '@/components/landing/content';
import { Toaster } from '@/components/ui/sonner';
import { geist, geistMono } from './fonts';
import './globals.css';
import { BRAND } from '@/lib/brand';

// Every page is kept out of search engines unless it says otherwise: only `/`, `/privacy` and `/terms` override this
// with `index` (owner decision, 16 Nov 2026). metadataBase makes the share image's address absolute.
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: BRAND.product,
  description: 'Spreadsheets for compliance and operations work',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <body>
        <OfflineBanner />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
