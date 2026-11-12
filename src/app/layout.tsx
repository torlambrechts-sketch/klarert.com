import type { Metadata } from 'next';
import { OfflineBanner } from '@/components/states/offline-banner';
import { Toaster } from '@/components/ui/sonner';
import { jakarta, plexMono } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: 'Compliance OS',
  description: 'Spreadsheets for compliance and operations work',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${jakarta.variable} ${plexMono.variable}`}>
      <body>
        <OfflineBanner />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
