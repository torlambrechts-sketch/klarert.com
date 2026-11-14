import 'server-only';
import { getSession } from '@/server/auth';

// A system board (docs/11 Core registers, docs/05 §3): a shared register a system pack installed. The sheet header
// says "System board · installed by Core registers 1.1.0". Read with the person's client.

export interface SheetSystem {
  /** "Core registers 1.1.0" */
  source: string;
}

export const isSystemSheet = (settings: unknown): boolean =>
  !!settings && typeof settings === 'object' && (settings as { system?: unknown }).system === true;

export async function getSheetSystem(
  orgId: string,
  sheetId: string,
  settings: unknown,
): Promise<SheetSystem | null> {
  if (!isSystemSheet(settings)) return null;
  const session = await getSession();
  if (!session) return null;
  const db = session.supabase;
  const { data: sheet } = await db
    .from('sheets')
    .select('pack_install_id')
    .eq('org_id', orgId)
    .eq('id', sheetId)
    .maybeSingle();
  if (!sheet?.pack_install_id) return { source: 'a system pack' };
  const { data: inst } = await db
    .from('pack_installs')
    .select('pack_key, version')
    .eq('id', sheet.pack_install_id)
    .maybeSingle();
  if (!inst) return { source: 'a system pack' };
  const { data: pack } = await db
    .from('packs')
    .select('title')
    .eq('key', inst.pack_key)
    .eq('version', inst.version)
    .maybeSingle();
  return { source: `${pack?.title ?? inst.pack_key} ${inst.version}` };
}
