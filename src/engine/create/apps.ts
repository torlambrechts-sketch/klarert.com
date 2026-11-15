// The Create wizard's App card (docs/05 §4 Create, docs/13; owner decision 14 Nov 2026): the apps a person can start
// and the shortest valid path to each. An app is always part of a pack version (docs/13), so starting one is either
// opening it (a live install already carries it), creating the set that brings it (the same preview, planner and
// create_bundle as Solve a problem), or a pointer to Workspace admin › Packs when its pack is set up here without it.
// Pure: the server passes the catalogue, the live installs and the apps already resolved for the person.
import { visibleTo } from '../apps/resolve';
import type { AppIcon, AppManifest, AppRole, AppScreen, ScreenKind } from '../apps/types';
import type { PackManifest } from '../packs/types';
import type { Role } from '../types';

/**
 * - `ready`: a live install carries it and the person may see it: open it.
 * - `new`: its pack is not set up here: creating the set brings it.
 * - `update`: its pack is set up here at another version (without it, or without its screens): update it in Packs.
 * - `incomplete`: its pack is set up at this version but without the parts its screens need (left out, a lower level).
 * - `not_for_you`: set up here, but the app is for other roles.
 */
export type AppStartState = 'ready' | 'new' | 'update' | 'incomplete' | 'not_for_you';

export interface AppStartScreen {
  title: string;
  kind: ScreenKind;
  /** What it reads: the sheet's or the dashboard's name ("Nonconformities and CAPA"), when known. */
  reads: string | null;
  /** Roles it is narrowed to, in words ("owners and admins"); null = everyone who sees the app. */
  for: string | null;
}

export interface AppStart {
  key: string;
  title: string;
  description: string;
  icon: AppIcon;
  /** The catalogue pack that brings it: the ready-made set created for it. */
  packKey: string;
  packTitle: string;
  packVersion: string;
  /** The version set up here, when its pack is live. */
  installedVersion: string | null;
  state: AppStartState;
  /** Who sees the app, in words; null = everyone in the workspace. */
  for: string | null;
  /** The person's role sees the app once it is set up (docs/13: roles only hide). */
  forYou: boolean;
  sections: { title: string; screens: AppStartScreen[] }[];
  /**
   * Sheets the workspace already has that its screens read (a required pack's live install, docs/13 "Screens over a
   * pack it requires"): "Nonconformities and CAPA (Core registers)".
   */
  uses: string[];
}

export interface AppStartInput {
  /** The catalogue's newest version of each pack (frameworks excepted). */
  catalogue: { key: string; version: string; title: string; manifest: PackManifest }[];
  /** The workspace's live pack installs. */
  installs: { packKey: string; version: string }[];
  /** The apps resolved for this person from the live installs (src/server/apps/read.ts getApps). */
  resolved: {
    key: string;
    title: string;
    description: string;
    icon: AppIcon;
    packKey: string;
    sections: { title: string; screens: { title: string; kind: ScreenKind }[] }[];
  }[];
  role: Role;
}

const ROLE_WORDS: Record<AppRole, string> = {
  owner: 'owners',
  admin: 'admins',
  member: 'members',
  auditor: 'auditors',
};

/** "owners and admins"; null for no roles (everyone). */
export function rolesInWords(roles: readonly AppRole[] | undefined): string | null {
  if (!roles?.length) return null;
  const w = roles.map((r) => ROLE_WORDS[r]);
  return w.length === 1 ? w[0]! : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
}

type Cat = AppStartInput['catalogue'][number];

/** The name of what a screen reads: a sheet of the pack, a required pack's sheet or a dashboard. */
function readsOf(screen: AppScreen, pack: Cat, catalogue: Cat[]): string | null {
  if (screen.kind === 'dashboard')
    return pack.manifest.dashboards.find((d) => d.ref === screen.dashboard)?.name ?? null;
  const [other, ref] = screen.sheet.includes(':') ? screen.sheet.split(':') : [null, screen.sheet];
  const from = other ? catalogue.find((c) => c.key === other) : pack;
  return from?.manifest.sheets.find((s) => s.ref === ref)?.name ?? null;
}

/** The sheets of required packs the app reads that the workspace already has: "<sheet> (<pack>)". */
function usesOf(app: AppManifest, catalogue: Cat[], live: Set<string>): string[] {
  const out: string[] = [];
  for (const sec of app.sections)
    for (const sc of sec.screens) {
      if (sc.kind === 'dashboard' || !sc.sheet.includes(':')) continue;
      const [other, ref] = sc.sheet.split(':') as [string, string];
      if (!live.has(other)) continue;
      const dep = catalogue.find((c) => c.key === other);
      const name = dep?.manifest.sheets.find((s) => s.ref === ref)?.name;
      const line = name ? `${name} (${dep!.title})` : null;
      if (line && !out.includes(line)) out.push(line);
    }
  return out;
}

/**
 * Every app a person could start here: the apps of the catalogue's packs, then the apps of live installs the
 * catalogue's newest versions no longer carry. One entry per app key (the first wins, as in a workspace, docs/13).
 */
export function appStarts(input: AppStartInput): AppStart[] {
  const live = new Map(input.installs.map((i) => [i.packKey, i.version]));
  const liveKeys = new Set(live.keys());
  const out: AppStart[] = [];
  const seen = new Set<string>();
  for (const pack of input.catalogue)
    for (const app of pack.manifest.apps ?? []) {
      if (seen.has(app.key)) continue;
      seen.add(app.key);
      const installed = live.get(pack.key) ?? null;
      const resolved = input.resolved.find((r) => r.key === app.key);
      const state: AppStartState = resolved
        ? 'ready'
        : installed === null
          ? 'new'
          : !visibleTo(app.roles, input.role)
            ? 'not_for_you'
            : installed !== pack.version
              ? 'update'
              : 'incomplete';
      out.push({
        key: app.key,
        title: app.title,
        description: app.description ?? '',
        icon: app.icon,
        packKey: pack.key,
        packTitle: pack.title,
        packVersion: pack.version,
        installedVersion: installed,
        state,
        for: rolesInWords(app.roles),
        forYou: visibleTo(app.roles, input.role),
        sections: app.sections.map((sec) => ({
          title: sec.title,
          screens: sec.screens.map((sc) => ({
            title: sc.title,
            kind: sc.kind,
            reads: readsOf(sc, pack, input.catalogue),
            for: rolesInWords(sc.roles),
          })),
        })),
        uses: usesOf(app, input.catalogue, liveKeys),
      });
    }
  // an app a live install carries that the catalogue's newest version no longer ships: it still opens
  for (const r of input.resolved) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    const pack = input.catalogue.find((c) => c.key === r.packKey);
    out.push({
      key: r.key,
      title: r.title,
      description: r.description,
      icon: r.icon,
      packKey: r.packKey,
      packTitle: pack?.title ?? r.packKey,
      packVersion: pack?.version ?? live.get(r.packKey) ?? '',
      installedVersion: live.get(r.packKey) ?? null,
      state: 'ready',
      for: null,
      forYou: true,
      sections: r.sections.map((sec) => ({
        title: sec.title,
        screens: sec.screens.map((sc) => ({
          title: sc.title,
          kind: sc.kind,
          reads: null,
          for: null,
        })),
      })),
      uses: [],
    });
  }
  return out;
}
