import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { FORGOT_PASSWORD_PATH } from '@/lib/auth-links';
import { safeNext } from '@/lib/safe-next';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata = { title: 'Reset your password · Compliance OS' };

/**
 * Why a reset link failed (`?error=`, from the email-link callback): `link`, a code link (Supabase's default email)
 * opened in another browser than the one that asked, or expired; `expired`, a link from our own email that expired or
 * was already used.
 */
const FAILED: Record<string, string> = {
  link: 'This link has to be opened in the same browser you asked from, or it has expired. Ask for a new link.',
  expired: 'This link has expired or was already used. Ask for a new link.',
};

// Forgot password (docs/05 §1, docs/09 §12): asks for the email address and sends Supabase Auth's reset link. The
// answer never says whether an account uses the address. A reset link that failed comes back here with the reason
// and a button to ask again.
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext) ?? undefined;
  const signIn = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const again = next
    ? `${FORGOT_PASSWORD_PATH}?next=${encodeURIComponent(next)}`
    : FORGOT_PASSWORD_PATH;
  const failed = error ? (FAILED[error] ?? FAILED.link) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1>Compliance OS</h1>
        <h2 className="text-card-title">Reset your password</h2>
        {failed ? null : (
          <p className="text-muted-foreground">
            Enter the email address you sign in with. We email you a link to set a new password.
          </p>
        )}
      </div>
      {failed ? (
        <div className="flex flex-col gap-4" data-testid="reset-link-failed">
          <p role="alert" className="text-crit text-13 m-0">
            {failed}
          </p>
          <Link href={again} autoFocus className={buttonVariants({ className: 'w-fit' })}>
            Ask for a new link
          </Link>
        </div>
      ) : (
        <ForgotPasswordForm next={next} />
      )}
      <p className="text-13">
        <Link className="text-info underline-offset-4 hover:underline" href={signIn}>
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
