import 'server-only';
import { readDesignInput } from '@/lib/schemas/design';
import { readDesignWorld, type DesignRead } from '@/server/design/read';
import { invalid, ok, type Result } from '@/server/result';
import { withOrg } from './context';

// The Design area's read (docs/05 §3.8, §4): the configuration a sheet's flow and the workspace's map are derived from,
// under the person's RLS, masked before it leaves the server. Members of every role may read it (viewers and auditors
// read only); every change goes through the existing commands of the editors it opens.

export async function readDesign(input: unknown): Promise<Result<DesignRead>> {
  const p = readDesignInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role, user }) =>
      ok(await readDesignWorld(supabase, orgId, { userId: user.id, role }, { sheetId: v.sheetId })),
    'readDesign',
  );
}
