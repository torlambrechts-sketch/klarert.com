import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth';
import { LoginForm, PasswordForm } from './login-form';

export const metadata = { title: 'Sign in · Compliance OS' };

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
  const safeNext = next && /^\/(?!\/)/.test(next) ? next : undefined;
  if (await getSession()) redirect(safeNext ?? '/');
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
        <h1>Compliance OS</h1>
        <h2 className="text-lg font-bold">{MODES[mode].title}</h2>
        <p className="text-muted-foreground">{MODES[mode].intro}</p>
      </div>
      {error ? (
        <p role="alert" className="text-crit text-sm">
          That sign-in link has expired or was already used. Sign in again.
        </p>
      ) : null}
      {mode === 'link' ? (
        <LoginForm next={safeNext} />
      ) : (
        <PasswordForm key={mode} next={safeNext} mode={mode} />
      )}
      <nav aria-label="Other ways to sign in" className="flex flex-col gap-1 text-sm">
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
