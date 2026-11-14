import 'server-only';
import { getSession } from '@/server/auth';

// The set a sheet was created with by the Create wizard (docs/11 Bundles): its name, owner and review state, read
// with the person's client (RLS: members read their workspace's installs). Sheets installed from Workspace admin ›
// Packs or made by hand have none.

export interface SheetBundle {
  installId: string;
  name: string;
  /** "Supplier management 1.0.0" */
  source: string;
  ownerId: string | null;
  ownerName: string;
  reviewBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** Live sheets of the set (for "Archive the whole set"). */
  sheets: number;
}

export async function getSheetBundle(orgId: string, sheetId: string): Promise<SheetBundle | null> {
  const session = await getSession();
  if (!session) return null;
  const db = session.supabase;
  const { data: sheet } = await db
    .from('sheets')
    .select('pack_install_id')
    .eq('org_id', orgId)
    .eq('id', sheetId)
    .maybeSingle();
  if (!sheet?.pack_install_id) return null;
  const { data: inst } = await db
    .from('pack_installs')
    .select(
      'id, pack_key, version, status, bundle_name, owner_id, review_by, reviewed_at, reviewed_by, origin',
    )
    .eq('id', sheet.pack_install_id)
    .maybeSingle();
  if (!inst || inst.origin !== 'create' || inst.status !== 'installed') return null;
  const people = [inst.owner_id, inst.reviewed_by].filter((x): x is string => !!x);
  const [{ data: pack }, { data: profiles }, { count }] = await Promise.all([
    db
      .from('packs')
      .select('title')
      .eq('key', inst.pack_key)
      .eq('version', inst.version)
      .maybeSingle(),
    people.length
      ? db.from('profiles').select('id, display_name').in('id', people)
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    db
      .from('sheets')
      .select('id', { count: 'exact', head: true })
      .eq('pack_install_id', inst.id)
      .is('parent_sheet_id', null)
      .is('archived_at', null),
  ]);
  const name = (id: string | null) =>
    (id && profiles?.find((p) => p.id === id)?.display_name) || 'Former member';
  return {
    installId: inst.id,
    name: inst.bundle_name ?? pack?.title ?? inst.pack_key,
    source: `${pack?.title ?? inst.pack_key} ${inst.version}`,
    ownerId: inst.owner_id,
    ownerName: name(inst.owner_id),
    reviewBy: inst.review_by,
    reviewedAt: inst.reviewed_at,
    reviewedBy: inst.reviewed_at ? name(inst.reviewed_by) : null,
    sheets: count ?? 0,
  };
}
