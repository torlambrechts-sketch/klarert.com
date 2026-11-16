import Link from 'next/link';
import { safeNext } from '@/lib/safe-next';
import { ForgotPasswordForm } from './forgot-password-form';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Reset your password · ${BRAND.product}` };

// Forgot password (docs/05 §1, docs/09 §12): asks for the email address and sends Supabase Auth's reset link. The
// answer never says whether an account uses the address.
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext) ?? undefined;
  const signIn = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1>{BRAND.product}</h1>
        <h2 className="text-heading-16">Reset your password</h2>
        <p className="text-muted-foreground">
          Enter the email address you sign in with. We email you a link to set a new password.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-crit text-copy-13">
          That reset link has expired, was already used or was opened in another browser. Ask for a
          new one.
        </p>
      ) : null}
      <ForgotPasswordForm next={next} />
      <p className="text-label-13">
        <Link className="text-info underline-offset-4 hover:underline" href={signIn}>
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
