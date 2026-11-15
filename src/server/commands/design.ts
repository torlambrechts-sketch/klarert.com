import 'server-only';
import { canSeeLeaves } from '@/components/design/params';
import { dataFlowExportInput, readDesignInput } from '@/lib/schemas/design';
import { readDesignWorld, type DesignRead } from '@/server/design/read';
import { fail, fromDbError, invalid, ok, type Result } from '@/server/result';
import { logExport } from './audit';
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

/**
 * Log an export of the data-flow record ("Leaves the system", owner decision 15 Nov 2026) as the other audit exports
 * are logged: `audit.exported` on the workspace chain with who, when and the filters used (log_audit_export, 0049).
 * Only those who see the record (owners, admins and auditors). The plain flow print and the workspace print are not
 * logged.
 */
export async function logDataFlowExport(input: unknown): Promise<Result<null>> {
  const p = dataFlowExportInput.safeParse(input);
  if (!p.success) return invalid(p.error);
  const v = p.data;
  return withOrg(
    v.org,
    'member',
    async ({ supabase, orgId, role }) => {
      if (!canSeeLeaves(role))
        return fail(
          'forbidden',
          'Owners, admins and auditors see where data leaves the workspace.',
        );
      try {
        await logExport(supabase, orgId, 'data_flow_record', {
          app: v.app ?? null,
          pack: v.pack ?? null,
          folder_id: v.group ?? null,
          domain: v.domain ?? null,
          differs: v.differs ?? false,
          sheets: v.sheets,
          destinations: v.destinations,
        });
        return ok(null);
      } catch (e) {
        return fromDbError(e as Error);
      }
    },
    'logDataFlowExport',
  );
}
