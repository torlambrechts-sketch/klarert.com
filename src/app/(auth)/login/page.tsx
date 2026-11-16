import Link from 'next/link';
import { redirect } from 'next/navigation';
import { safeNext as safePath } from '@/lib/safe-next';
import { getSession, getSignIn } from '@/server/auth';
import { LoginForm, PasswordForm } from './login-form';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `Sign in · ${BRAND.product}` };

type Mode = 'signin' | 'signup' | 'link';
const MODES: Record<Mode, { title: string; intro: string }> = {
  signin: { title: 'Sign in', intro: 'Sign in with your email and password.' },
  signup: { title: 'Create an account', intro: 'Choose a password to create your account.' },
  link: {
    title: 'Sign in with a link',
    intro: 'We email you a link to sign in. No password needed.',
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; mode?: string }>;
}) {
  const { next, error, mode: rawMode } = await searchParams;
  const safeNext = safePath(next) ?? undefined;
  if (await getSession()) redirect(safeNext ?? '/');
  // signed in with the first step, the authenticator app's code still owed
  if ((await getSignIn())?.twoStep.needsCode)
    redirect(safeNext ? `/login/two-step?next=${encodeURIComponent(safeNext)}` : '/login/two-step');
  const mode: Mode = rawMode === 'signup' || rawMode === 'link' ? rawMode : 'signin';
  const href = (m: Mode) => {
    const p = new URLSearchParams();
    if (m !== 'signin') p.set('mode', m);
    if (safeNext) p.set('next', safeNext);
    const q = p.toString();
    return q ? `/login?${q}` : '/login';
  };
  const linkClass = 'text-info underline-offset-4 hover:underline';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1>{BRAND.product}</h1>
        <h2 className="text-heading-16">{MODES[mode].title}</h2>
        <p className="text-muted-foreground">{MODES[mode].intro}</p>
      </div>
      {error ? (
        <p role="alert" className="text-crit text-copy-13">
          That sign-in link has expired or was already used. Sign in again.
        </p>
      ) : null}
      {mode === 'link' ? (
        <LoginForm next={safeNext} />
      ) : (
        <PasswordForm key={mode} next={safeNext} mode={mode} />
      )}
      {mode === 'signin' ? (
        <p className="text-label-13 -mt-2">
          <Link
            className={linkClass}
            href={
              safeNext
                ? `/login/forgot-password?next=${encodeURIComponent(safeNext)}`
                : '/login/forgot-password'
            }
          >
            Forgot password
          </Link>
        </p>
      ) : null}
      <nav aria-label="Other ways to sign in" className="text-label-13 flex flex-col gap-1">
        {mode !== 'signin' ? (
          <Link className={linkClass} href={href('signin')}>
            Sign in with a password
          </Link>
        ) : null}
        {mode !== 'signup' ? (
          <Link className={linkClass} href={href('signup')}>
            Create an account
          </Link>
        ) : null}
        {mode !== 'link' ? (
          <Link className={linkClass} href={href('link')}>
            Email me a sign-in link instead
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
