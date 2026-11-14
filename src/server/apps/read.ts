import 'server-only';
import { cache } from 'react';
import { appScreens, resolveApps, type AppInstall, type ResolvedApp } from '@/engine/apps/resolve';
import type { PackManifest } from '@/engine/packs/types';
import type { Role } from '@/engine/types';
import { parsePack } from '@/lib/packs/manifest';
import { getSession } from '@/server/auth';

// The workspace's apps (docs/13): the apps of the live pack installs, from the installed version's manifest in the
// catalogue, resolved through each install's ref map for the person's role. Read under the person's session and RLS;
// an app only links to what the person could open anyway.

/** A version of a pack never changes (docs/11), so its parsed manifest is kept for the life of the server. */
const parsed = new Map<string, PackManifest | null>();
function manifestOf(key: string, version: string, raw: unknown): PackManifest | null {
  const id = `${key}@${version}`;
  if (!parsed.has(id)) {
    try {
      parsed.set(id, parsePack(raw));
    } catch {
      parsed.set(id, null);
    }
  }
  return parsed.get(id)!;
}

const hasApps = (raw: unknown) =>
  !!raw && typeof raw === 'object' && Array.isArray((raw as { apps?: unknown }).apps);

export const getApps = cache(async (orgId: string, role: Role): Promise<ResolvedApp[]> => {
  const session = await getSession();
  if (!session) return [];
  const db = session.supabase;
  const { data: installs, error } = await db
    .from('pack_installs')
    .select('id, pack_key, version, ref_map, installed_at')
    .eq('org_id', orgId)
    .eq('status', 'installed')
    .order('installed_at');
  if (error) throw new Error(`pack installs: ${error.message}`);
  if (!installs?.length) return [];
  const { data: packs, error: packsError } = await db
    .from('packs')
    .select('key, version, manifest')
    .in('key', [...new Set(installs.map((i) => i.pack_key))]);
  if (packsError) throw new Error(`packs: ${packsError.message}`);
  const refMaps = new Map(
    installs.map((i) => [i.pack_key, (i.ref_map ?? {}) as Record<string, string>]),
  );
  const list: AppInstall[] = installs.flatMap((i) => {
    const row = (packs ?? []).find((p) => p.key === i.pack_key && p.version === i.version);
    if (!row || !hasApps(row.manifest)) return [];
    const manifest = manifestOf(row.key, row.version, row.manifest);
    if (!manifest?.apps?.length) return [];
    return [
      {
        id: i.id,
        packKey: i.pack_key,
        refMap: (i.ref_map ?? {}) as Record<string, string>,
        apps: manifest.apps,
        pack: {
          sheets: [
            ...manifest.sheets.map((s) => ({ ref: s.ref, views: s.views })),
            // a required pack's sheet: the views this pack added to it (docs/13)
            ...(manifest.extends ?? []).map((e) => ({
              ref: `${e.pack}:${e.sheet}`,
              views: e.views ?? [],
            })),
          ],
        },
        required: Object.fromEntries(
          manifest.requires.flatMap((r) => {
            const map = refMaps.get(r.pack);
            return map ? [[r.pack, map]] : [];
          }),
        ),
      },
    ];
  });
  return resolveApps(list, role);
});

/** The apps for the side menu: never fails the shell (an error leaves the section out). */
export async function getAppsForMenu(orgId: string, role: Role) {
  try {
    return (await getApps(orgId, role)).map((a) => ({
      key: a.key,
      title: a.title,
      icon: a.icon,
      screen: appScreens(a)[0]!.key,
    }));
  } catch {
    return [];
  }
}
