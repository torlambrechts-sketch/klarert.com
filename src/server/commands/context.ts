import 'server-only';
import { requiresTwoStep, TWO_STEP_REQUIRED, workspaceGate } from '@/lib/two-step';
import { getSession, getSignIn, isAdminRole, isEditorRole, type Role } from '@/server/auth';
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
  if (!session)
    return (await getSignIn())?.twoStep.needsCode
      ? fail('unauthenticated', 'Enter the code from your authenticator app to finish signing in.')
      : fail('unauthenticated', 'Sign in again.');
  const { data: m } = await session.supabase
    .from('memberships')
    .select('role, orgs!inner(id, slug, require_two_step:settings->requireTwoStep)')
    .eq('user_id', session.user.id)
    .eq('orgs.slug', slug)
    .maybeSingle();
  if (!m) return fail('not_found', 'Workspace not found.');
  // the workspace setting "Require two-step sign-in" (docs/09 §8): the same rule as its pages (requireMember)
  const required = requiresTwoStep({ requireTwoStep: m.orgs.require_two_step });
  if (workspaceGate(session.twoStep, required) !== 'open')
    return fail('forbidden', TWO_STEP_REQUIRED);
  if (need === 'admin' && !isAdminRole(m.role))
    return fail('forbidden', 'Only owners and admins can do that.');
  if (need === 'editor' && !isEditorRole(m.role))
    return fail(
      'forbidden',
      m.role === 'auditor'
        ? 'Auditors have read-only access.'
        : 'Viewers cannot change sheets. Ask an editor or admin.',
    );
  const result = await run({ ...session, orgId: m.orgs.id, role: m.role });
  log(command, { org: m.orgs.id, user: session.user.id, ms: Date.now() - started, ok: result.ok });
  return result;
}

export function log(command: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ level: 'info', source: 'command', command, ...fields }));
}
