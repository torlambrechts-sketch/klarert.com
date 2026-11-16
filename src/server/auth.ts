import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { openedByResetLink } from '@/lib/passwords';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/database.types';
import {
  aalOf,
  requiresTwoStep,
  signedInAt,
  tokenClaims,
  twoStepState,
  workspaceGate,
} from '@/lib/two-step';

export type Role = Database['public']['Enums']['member_role'];
export type Profile = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'display_name' | 'initials' | 'color'
>;
export type Workspace = Pick<
  Database['public']['Tables']['orgs']['Row'],
  'id' | 'name' | 'slug' | 'time_zone'
>;

/**
 * Who is signed in, and how far (two-step sign-in, docs/09 §8): also a person who entered their password or opened
 * an email link but still owes the code of their authenticator app. Only the two-step page and redirects use this.
 */
export const getSignIn = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  // getUser checked this session's access token with Supabase Auth; its claims say how it was signed in
  const { data: current } = await supabase.auth.getSession();
  const claims = tokenClaims(current.session?.access_token);
  return {
    supabase,
    user: data.user,
    twoStep: twoStepState(data.user.factors, aalOf(claims)),
    signedInAt: signedInAt(claims),
    /** Opened by a password reset link: may set a new password without the current one (docs/09 §12). */
    resetLink: openedByResetLink(claims),
  };
});

/** The signed-in person. Null until they finished signing in: a person with an authenticator app owes its code. */
export const getSession = cache(async () => {
  const signIn = await getSignIn();
  if (!signIn || signIn.twoStep.needsCode) return null;
  const { supabase, user, twoStep, resetLink } = signIn;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, initials, color')
    .eq('id', user.id)
    .maybeSingle();
  return { supabase, user, profile, twoStep, resetLink };
});

/** Where to send someone who is not (fully) signed in: the sign-in page, or the code page when only the code is owed. */
export async function signInPath(next?: string) {
  const owesCode = !!(await getSignIn())?.twoStep.needsCode;
  const path = owesCode ? '/login/two-step' : '/login';
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

export const getMyWorkspaces = cache(async () => {
  const session = await getSession();
  if (!session) return [];
  const { data } = await session.supabase
    .from('memberships')
    .select(
      'role, expires_at, orgs!inner(id, name, slug, time_zone, require_two_step:settings->requireTwoStep)',
    )
    .eq('user_id', session.user.id)
    .order('created_at');
  // RLS hides memberships that have ended (an auditor after their end date, docs/02 §16)
  return (data ?? []).map(({ role, expires_at, orgs: { require_two_step, ...org } }) => ({
    role,
    expiresAt: expires_at,
    ...org,
    requireTwoStep: requiresTwoStep({ requireTwoStep: require_two_step }),
  }));
});

/** For pages: signed in with a profile, else redirect. */
export async function requireProfile(next?: string) {
  const session = await getSession();
  if (!session) redirect(await signInPath(next));
  if (!session.profile)
    redirect(next ? `/onboarding?next=${encodeURIComponent(next)}` : '/onboarding');
  return { ...session, profile: session.profile };
}

/** For pages under /[org]: a member of that workspace, else 404-like redirect. */
export const requireMember = cache(async (slug: string) => {
  const session = await requireProfile(`/${slug}`);
  const workspace = (await getMyWorkspaces()).find((w) => w.slug === slug);
  if (!workspace) redirect('/');
  // a workspace that requires two-step sign-in opens only for a session that entered a code (docs/09 §8)
  if (workspaceGate(session.twoStep, workspace.requireTwoStep) === 'set_up')
    redirect(
      `/account?required=${encodeURIComponent(slug)}&next=${encodeURIComponent(`/${slug}`)}`,
    );
  return { ...session, workspace, role: workspace.role };
});

export const isAdminRole = (role: Role) => role === 'owner' || role === 'admin';
/** Roles that may change sheets (subject to sheet access, docs/02 §16): viewers and auditors read only. */
export const isEditorRole = (role: Role) =>
  role === 'owner' || role === 'admin' || role === 'editor';
