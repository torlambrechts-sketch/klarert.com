import 'server-only';
import { libraryKey, setupProgress, type SetupProgress, type SetupSource } from '@/engine/packs';
import { manifestForPeople, packTitle } from '@/engine/packs/words';
import type { SetupTarget } from '@/engine/packs/types';
import { sheetCtx } from '@/engine/sheet-data';
import { parsePack } from '@/lib/packs/manifest';
import { fetchSheetData, type Db } from '@/lib/sheet-query';
import { newId } from '@/server/sheet-context';

// A pack's guided setup (docs/11 Setup) for the workspace's live installs: the steps come from the installed
// version's manifest, the sheets they read from the install's ref map (and the adopted libraries), the progress from
// the engine (setupProgress). Read under the person's session and RLS: a sheet they cannot read counts as not started
// and links nowhere.

export interface InstalledSetup {
  installId: string;
  packKey: string;
  title: string;
  level: { key: string; name: string } | null;
  progress: SetupProgress;
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

export async function readSetups(
  db: Db,
  orgId: string,
  env: { timeZone: string; userId: string; isAdmin: boolean },
): Promise<InstalledSetup[]> {
  const installs = must(
    await db
      .from('pack_installs')
      .select('id, pack_key, version, level, ref_map, installed_at')
      .eq('org_id', orgId)
      .eq('status', 'installed')
      .order('installed_at'),
    'pack installs',
  );
  if (!installs.length) return [];
  const packs = must(
    await db
      .from('packs')
      .select('key, version, title, manifest')
      .in('key', [...new Set(installs.map((i) => i.pack_key))]),
    'packs',
  );
  const withSetup = installs.flatMap((i) => {
    const row = packs.find((p) => p.key === i.pack_key && p.version === i.version);
    if (!row) return [];
    try {
      // in the words people see (engine/packs/words.ts): "Shared registers", Basic / Recommended / Everything
      const manifest = manifestForPeople(parsePack(row.manifest));
      return manifest.setup ? [{ install: i, manifest, title: packTitle(row.title) }] : [];
    } catch {
      return [];
    }
  });
  if (!withSetup.length) return [];

  const libraries = must(
    await db
      .from('sheets')
      .select('id, settings')
      .eq('org_id', orgId)
      .eq('is_library', true)
      .is('archived_at', null)
      .is('parent_sheet_id', null),
    'libraries',
  ).flatMap((s) => {
    const fw = (s.settings as { framework?: { key?: unknown; version?: unknown } } | null)
      ?.framework;
    return typeof fw?.key === 'string' && typeof fw.version === 'string'
      ? [[libraryKey({ key: fw.key, version: fw.version }), s.id] as const]
      : [];
  });
  const libraryIds = new Map(libraries);

  // a required pack's sheet (`core:suppliers`) through that pack's live install
  const refMapOf = new Map(
    installs.map((i) => [i.pack_key, (i.ref_map ?? {}) as Record<string, string>]),
  );
  // every sheet any step reads, once
  const sheetIdOf = (refMap: Record<string, string>, t: SetupTarget) => {
    if (t.library) return libraryIds.get(t.library);
    if (!t.sheetRef) return undefined;
    const [pack, sheet] = t.sheetRef.split(':');
    return sheet ? refMapOf.get(pack!)?.[`sheet:${sheet}`] : refMap[`sheet:${t.sheetRef}`];
  };
  const wanted = new Set<string>();
  for (const { install, manifest } of withSetup) {
    const refMap = (install.ref_map ?? {}) as Record<string, string>;
    for (const step of manifest.setup!.steps)
      for (const variant of [step, ...Object.values(step.levels ?? {})])
        for (const t of [variant.target, ...(variant.rules ?? [])])
          if (t) {
            const id = sheetIdOf(refMap, t);
            if (id) wanted.add(id);
          }
  }
  const ids = [...wanted];
  const [data, views] = await Promise.all([
    Promise.all(ids.map((id) => fetchSheetData(db, id).catch(() => null))),
    ids.length
      ? db
          .from('views')
          .select('id, sheet_id, name, owner_id')
          .in('sheet_id', ids)
          .is('owner_id', null)
          .then((r) => must(r, 'views'))
      : Promise.resolve([]),
  ]);
  const now = new Date();
  const sources = new Map<string, SetupSource>();
  data.forEach((d) => {
    if (!d || d.sheet.orgId !== orgId) return;
    const ctx = sheetCtx(d, {
      now,
      timeZone: env.timeZone,
      userId: env.userId,
      newId,
      isAdmin: env.isAdmin,
    });
    sources.set(d.sheet.id, {
      sheet: d.sheet,
      items: d.items.filter((i) => !i.parentId),
      ctx,
      viewId: (name) => views.find((v) => v.sheet_id === d.sheet.id && v.name === name)?.id ?? null,
    });
  });

  return withSetup.map(({ install, manifest, title }) => {
    const refMap = (install.ref_map ?? {}) as Record<string, string>;
    const level = manifest.levels?.find((l) => l.key === install.level) ?? null;
    return {
      installId: install.id,
      packKey: install.pack_key,
      title,
      level: level ? { key: level.key, name: level.name } : null,
      progress: setupProgress(manifest.setup!, install.level ?? null, (t) => {
        const id = sheetIdOf(refMap, t);
        return id ? sources.get(id) : undefined;
      }),
    };
  });
}
