import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/database.types';

export type Role = Database['public']['Enums']['member_role'];
export type Profile = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'display_name' | 'initials' | 'color'
>;
export type Workspace = Pick<
  Database['public']['Tables']['orgs']['Row'],
  'id' | 'name' | 'slug' | 'time_zone'
>;

export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, initials, color')
    .eq('id', data.user.id)
    .maybeSingle();
  return { supabase, user: data.user, profile };
});

export const getMyWorkspaces = cache(async () => {
  const session = await getSession();
  if (!session) return [];
  const { data } = await session.supabase
    .from('memberships')
    .select('role, orgs!inner(id, name, slug, time_zone)')
    .eq('user_id', session.user.id)
    .order('created_at');
  return (data ?? []).map((m) => ({ role: m.role, ...m.orgs }));
});

/** For pages: signed in with a profile, else redirect. */
export async function requireProfile(next?: string) {
  const session = await getSession();
  if (!session) redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  if (!session.profile)
    redirect(next ? `/onboarding?next=${encodeURIComponent(next)}` : '/onboarding');
  return { ...session, profile: session.profile };
}

/** For pages under /[org]: a member of that workspace, else 404-like redirect. */
export const requireMember = cache(async (slug: string) => {
  const session = await requireProfile(`/${slug}`);
  const workspace = (await getMyWorkspaces()).find((w) => w.slug === slug);
  if (!workspace) redirect('/');
  return { ...session, workspace, role: workspace.role };
});

export const isAdminRole = (role: Role) => role === 'owner' || role === 'admin';
