import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Page not found · Compliance OS' };

// The app's own 404 (an unknown dashboard, app, screen or path): plain words and a way back, in the Geist styles,
// instead of the framework's unstyled page. A sheet keeps its own page (s/[sheetId]/not-found.tsx).
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-3 px-4 py-12">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-label-12-mono m-0">404</p>
        <h1 className="text-heading-20">Page not found</h1>
        <p className="text-muted-foreground m-0">
          It may have been deleted or moved, or the link is wrong.
        </p>
      </div>
      <Button asChild>
        <Link href="/">Go to your workspace</Link>
      </Button>
    </main>
  );
}
