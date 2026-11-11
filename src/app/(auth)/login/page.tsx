import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in · Compliance OS' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const safeNext = next && /^\/(?!\/)/.test(next) ? next : undefined;
  if (await getSession()) redirect(safeNext ?? '/');
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1>Compliance OS</h1>
        <p className="text-muted-foreground">
          Sign in with a link sent to your email. No password needed.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-crit text-sm">
          That sign-in link has expired or was already used. Send a new one.
        </p>
      ) : null}
      <LoginForm next={safeNext} />
    </div>
  );
}
