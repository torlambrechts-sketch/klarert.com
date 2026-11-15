import 'server-only';
import { randomUUID } from 'node:crypto';
import { packDrift, type BaseRows, type LiveRows } from '@/engine/flow/drift';
import type { DriftState } from '@/engine/flow/types';
import { planInstalledBase } from '@/engine/packs/upgrade';
import { todayIn } from '@/engine/sheet-data';
import type { Db } from '@/lib/sheet-query';
import {
  loadRequirementItems,
  loadSnapshot,
  manifestRequirementKeys,
} from '@/server/packs/install';
import { readPackVersion } from '@/server/packs/upgrade';

// "Differs from pack" on the Design tab (docs/05 §3.8): each live install's installed version planned as install_pack
// wrote it (the upgrade's base, planInstalledBase) and compared with the rows as the workspace holds them now
// (packDrift). Reads configuration only: the catalogue manifest, the workspace snapshot the planner needs and the rows
// the caller already read. A base plan depends only on the install's version, level and ref map, so it is kept for the
// life of the server. An install that cannot be planned is left out: its steps then say only which pack they are from.

export interface LiveInstall {
  id: string;
  pack_key: string;
  version: string;
  level: string | null;
  ref_map: unknown;
}

const bases = new Map<string, BaseRows | null>();
const MAX_KEPT = 200;

async function baseOf(
  db: Db,
  orgId: string,
  install: LiveInstall,
  folderIds: string[],
  userId: string,
): Promise<BaseRows | null> {
  const refMap = (install.ref_map ?? {}) as Record<string, string>;
  const key = `${install.id}@${install.version}:${install.level ?? ''}:${Object.keys(refMap).length}`;
  if (bases.has(key)) return bases.get(key)!;
  const from = await readPackVersion(db, install.pack_key, install.version);
  if (!from) return null;
  const { snapshot, timeZone } = await loadSnapshot(db, orgId, from.manifest);
  snapshot.requirementItems = await loadRequirementItems(
    db,
    orgId,
    snapshot.libraries ?? [],
    manifestRequirementKeys(from.manifest),
  );
  const now = new Date();
  const planned = planInstalledBase(
    from.manifest,
    { installId: install.id, folderIds, refMap },
    snapshot,
    { today: todayIn(now, timeZone), now, timeZone, newId: randomUUID, userId },
    install.level,
    from.hash,
  );
  const base: BaseRows | null = planned.planned
    ? {
        installId: install.id,
        automations: planned.planned.automations,
        views: planned.planned.views,
        fields: planned.planned.fields,
        sheets: planned.planned.sheets,
        extensionWorkflows: planned.workflows,
      }
    : null;
  if (bases.size >= MAX_KEPT) bases.clear();
  bases.set(key, base);
  return base;
}

/** `automation:<id>`, `form:<id>`, `field:<id>`, `workflow:<sheet>:<id>` → unchanged or changed, for every install. */
export async function readDrift(
  db: Db,
  orgId: string,
  userId: string,
  installs: LiveInstall[],
  ownFolders: Map<string, string[]>,
  live: LiveRows,
): Promise<Record<string, DriftState>> {
  const out: Record<string, DriftState> = {};
  const results = await Promise.all(
    installs.map(async (i) => {
      try {
        return await baseOf(db, orgId, i, ownFolders.get(i.id) ?? [], userId);
      } catch (e) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            source: 'design',
            message: 'pack base could not be planned',
            install: i.id,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
        return null;
      }
    }),
  );
  for (const base of results) if (base) Object.assign(out, packDrift(base, live));
  return out;
}
