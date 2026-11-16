import { redirect } from 'next/navigation';
import { FORGOT_PASSWORD_PATH, NEW_PASSWORD_PATH } from '@/lib/auth-links';
import { safeNext } from '@/lib/safe-next';
import { getSignIn } from '@/server/auth';
import { NewPasswordForm } from './new-password-form';

export const metadata = { title: 'Set a new password · Compliance OS' };

// Set a new password (docs/05 §1, docs/09 §12): where a reset link lands, through the callback. Only a session the
// reset link opened may set a password here; a person with an authenticator app enters its code first (Supabase Auth
// needs a two-step session to change the password), on the two-step page, which sends them back here.
export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next) ?? undefined;
  const here = next ? `${NEW_PASSWORD_PATH}?next=${encodeURIComponent(next)}` : NEW_PASSWORD_PATH;
  const signIn = await getSignIn();
  if (!signIn || !signIn.resetLink) {
    // signed in some other way: the password changes in Your account, with the current one
    if (signIn && !signIn.twoStep.needsCode) redirect('/account');
    redirect(`${FORGOT_PASSWORD_PATH}?error=link`);
  }
  if (signIn.twoStep.needsCode) redirect(`/login/two-step?next=${encodeURIComponent(here)}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1>Compliance OS</h1>
        <h2 className="text-heading-16">Set a new password</h2>
        <p className="text-muted-foreground">For {signIn.user.email}.</p>
      </div>
      <NewPasswordForm next={next} />
    </div>
  );
}
