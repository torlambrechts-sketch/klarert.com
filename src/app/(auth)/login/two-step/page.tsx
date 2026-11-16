import { redirect } from 'next/navigation';
import { formatDate } from '@/engine/fields/helpers';
import { safeNext } from '@/lib/safe-next';
import { verifiedApps } from '@/lib/two-step';
import { getSignIn } from '@/server/auth';
import { TwoStepForm } from './two-step-form';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Two-step sign-in · ${BRAND.product}` };

// The second step of signing in (docs/05 §1, docs/09 §8): after a password or an email link, a person with an
// authenticator app enters its code. Until then every page and command treats them as signed out.
export default async function TwoStepPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next) ?? undefined;
  const signIn = await getSignIn();
  if (!signIn) redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  if (!signIn.twoStep.needsCode) redirect(next ?? '/');
  const apps = verifiedApps(signIn.user.factors).map((f, i, all) => ({
    id: f.id,
    // no workspace yet, so no workspace time zone: the day in UTC is enough to tell two apps apart
    label: `${all.length > 1 ? `Authenticator app ${i + 1}` : 'Authenticator app'}, added ${formatDate(f.created_at.slice(0, 10))}`,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1>{BRAND.product}</h1>
        <h2 className="text-heading-16">Two-step sign-in</h2>
        <p className="text-muted-foreground">
          Enter the 6-digit code from your authenticator app for {signIn.user.email}.
        </p>
      </div>
      <TwoStepForm apps={apps} next={next} />
      <div className="text-label-13 border-line flex flex-col gap-2 border-t pt-4">
        <p className="text-muted-foreground m-0">
          Lost your phone? Use the spare app you added, or the key you saved. Otherwise ask your
          workspace owner to contact {BRAND.product} support.
        </p>
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-info rounded-sm underline-offset-4 hover:underline">
            Sign in as someone else
          </button>
        </form>
      </div>
    </div>
  );
}
