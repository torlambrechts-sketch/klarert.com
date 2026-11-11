import 'server-only';
import { getSession } from '@/server/auth';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { log } from './context';
import { acceptInviteInput, createWorkspaceInput, profileInput } from '@/lib/schemas/workspace';

export async function saveProfile(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = profileInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const session = await getSession();
  if (!session) return fail('unauthenticated', 'Sign in again.');
  const row = {
    id: session.user.id,
    display_name: parsed.data.displayName,
    initials: parsed.data.initials,
    color: parsed.data.color,
  };
  const { error } = session.profile
    ? await session.supabase.from('profiles').update(row).eq('id', row.id)
    : await session.supabase.from('profiles').insert(row);
  log('saveProfile', { user: row.id, ok: !error });
  return error ? fromDbError(error) : ok({ id: row.id });
}

export async function createWorkspace(input: unknown): Promise<Result<{ slug: string }>> {
  const parsed = createWorkspaceInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const session = await getSession();
  if (!session) return fail('unauthenticated', 'Sign in again.');
  const { data, error } = await session.supabase.rpc('create_workspace', {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_time_zone: parsed.data.timeZone,
  });
  log('createWorkspace', { user: session.user.id, ok: !error });
  if (error) {
    const r = fromDbError(error);
    if (!r.ok && r.error.code === 'conflict')
      return fail('invalid', r.error.message, { slug: r.error.message });
    return r;
  }
  return ok({ slug: data.slug });
}

export async function acceptInvite(input: unknown): Promise<Result<{ slug: string }>> {
  const parsed = acceptInviteInput.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const session = await getSession();
  if (!session) return fail('unauthenticated', 'Sign in again.');
  const { data, error } = await session.supabase.rpc('accept_invite', {
    p_token: parsed.data.token,
  });
  log('acceptInvite', { user: session.user.id, ok: !error });
  return error ? fromDbError(error) : ok({ slug: data.slug });
}
