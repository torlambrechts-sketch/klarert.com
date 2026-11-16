import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // the share image, robots.txt and the sitemap are static and public: no session to refresh
    '/((?!_next/static|_next/image|favicon.ico|opengraph-image|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)',
  ],
};
