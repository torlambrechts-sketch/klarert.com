import { redirect } from 'next/navigation';
import { getMyWorkspaces, getSession, signInPath } from '@/server/auth';

export default async function Root() {
  const session = await getSession();
  if (!session) redirect(await signInPath());
  if (!session.profile) redirect('/onboarding');
  const [first] = await getMyWorkspaces();
  redirect(first ? `/${first.slug}/home` : '/onboarding');
}
