import type { Metadata } from 'next';
import { OfflineBanner } from '@/components/states/offline-banner';
import { Toaster } from '@/components/ui/sonner';
import { geist, geistMono } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Compliance OS',
  description: 'Spreadsheets for compliance and operations work',
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
