import Link from 'next/link';
import { redirect } from 'next/navigation';
import { demoLogin } from '@/lib/demo-login';
import { safeNext as safePath } from '@/lib/safe-next';
import { getSession, getSignIn } from '@/server/auth';
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
  searchParams: Promise<{ next?: string; error?: string; mode?: string; demo?: string }>;
}) {
  const { next, error, mode: rawMode, demo: rawDemo } = await searchParams;
  const safeNext = safePath(next) ?? undefined;
  if (await getSession()) redirect(safeNext ?? '/');
  // signed in with the first step, the authenticator app's code still owed
  if ((await getSignIn())?.twoStep.needsCode)
    redirect(safeNext ? `/login/two-step?next=${encodeURIComponent(safeNext)}` : '/login/two-step');
  const mode: Mode = rawMode === 'signup' || rawMode === 'link' ? rawMode : 'signin';
  // the read-only demo login (docs/17): off unless NEXT_PUBLIC_DEMO_EMAIL is set
  const demo = demoLogin();
  const showDemo = !!demo && mode === 'signin' && rawDemo === '1';
  const href = (m: Mode, withDemo = false) => {
    const p = new URLSearchParams();
    if (m !== 'signin') p.set('mode', m);
    if (withDemo) p.set('demo', '1');
    if (safeNext) p.set('next', safeNext);
    const q = p.toString();
    return q ? `/login?${q}` : '/login';
  };
  const linkClass = 'text-info underline-offset-4 hover:underline';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1>Compliance OS</h1>
        <h2 className="text-card-title">{MODES[mode].title}</h2>
        <p className="text-muted-foreground">{MODES[mode].intro}</p>
      </div>
      {error ? (
        <p role="alert" className="text-crit text-13">
          That sign-in link has expired or was already used. Sign in again.
        </p>
      ) : null}
      {showDemo && demo ? (
        <section
          aria-labelledby="demo-login-heading"
          className="border-line text-13 flex flex-col gap-2 rounded-lg border p-4"
        >
          <h3 id="demo-login-heading" className="text-14 m-0 font-medium">
            Demo workspace
          </h3>
          <p className="text-muted-foreground m-0">
            Meridian Components Ltd is a fictional example workspace. You can look around but not
            change anything.
          </p>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="m-0 break-all" data-testid="demo-email">
              {demo.email}
            </dd>
            <dt className="text-muted-foreground">Password</dt>
            <dd className="m-0 break-all" data-testid="demo-password">
              {demo.password ?? 'Ask us for the demo password'}
            </dd>
          </dl>
        </section>
      ) : null}
      {mode === 'link' ? (
        <LoginForm next={safeNext} />
      ) : (
        <PasswordForm
          key={`${mode}${showDemo ? '-demo' : ''}`}
          next={safeNext}
          mode={mode}
          initialEmail={showDemo ? demo?.email : undefined}
          initialPassword={showDemo ? (demo?.password ?? undefined) : undefined}
        />
      )}
      {mode === 'signin' ? (
        <p className="text-13 -mt-2">
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
      <nav aria-label="Other ways to sign in" className="text-13 flex flex-col gap-1">
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
        {demo && !showDemo ? (
          <Link
            className="text-muted-foreground underline-offset-4 hover:underline"
            href={href('signin', true)}
          >
            Try the demo workspace
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
