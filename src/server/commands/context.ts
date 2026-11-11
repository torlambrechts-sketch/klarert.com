import 'server-only';
import { getSession, isAdminRole, isEditorRole, type Role } from '@/server/auth';
import { fail, type Result } from '@/server/result';

type Ctx = NonNullable<Awaited<ReturnType<typeof getSession>>> & { orgId: string; role: Role };

/** Authorise a command against a workspace by slug. RLS enforces the same rule again in the database. */
export async function withOrg<T>(
  slug: string,
  need: 'member' | 'editor' | 'admin',
  run: (ctx: Ctx) => Promise<Result<T>>,
  command: string,
): Promise<Result<T>> {
  const started = Date.now();
  const session = await getSession();
  if (!session) return fail('unauthenticated', 'Sign in again.');
  const { data: m } = await session.supabase
    .from('memberships')
    .select('role, orgs!inner(id, slug)')
    .eq('user_id', session.user.id)
    .eq('orgs.slug', slug)
    .maybeSingle();
  if (!m) return fail('not_found', 'Workspace not found.');
  if (need === 'admin' && !isAdminRole(m.role))
    return fail('forbidden', 'Only owners and admins can do that.');
  if (need === 'editor' && !isEditorRole(m.role))
    return fail('forbidden', 'Viewers cannot change sheets. Ask an editor or admin.');
  const result = await run({ ...session, orgId: m.orgs.id, role: m.role });
  log(command, { org: m.orgs.id, user: session.user.id, ms: Date.now() - started, ok: result.ok });
  return result;
}

export function log(command: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ level: 'info', source: 'command', command, ...fields }));
}
