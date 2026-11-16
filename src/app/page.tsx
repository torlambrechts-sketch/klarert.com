import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Landing } from '@/components/landing/landing';
import { SITE } from '@/components/landing/content';
import { getMyWorkspaces, getSession, getSignIn } from '@/server/auth';

// `/` is indexed: the public product site (owner decision, 16 Nov 2026). Only it, `/privacy` and `/terms` override
// the root layout's noindex. The share image is src/app/opengraph-image.tsx.
export const metadata: Metadata = {
  title: SITE.title,
  description: SITE.description,
  alternates: { canonical: SITE.url },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    url: SITE.url,
    siteName: SITE.title,
    title: SITE.title,
    description: SITE.description,
  },
  twitter: { card: 'summary_large_image', title: SITE.title, description: SITE.description },
};

export default async function Root() {
  // half signed in (the authenticator app's code still owed): on to the code page, as before
  if ((await getSignIn())?.twoStep.needsCode) redirect('/login/two-step');
  const session = await getSession();
  // signed out: the product site
  if (!session) return <Landing />;
  if (!session.profile) redirect('/onboarding');
  const [first] = await getMyWorkspaces();
  redirect(first ? `/${first.slug}` : '/onboarding');
}
