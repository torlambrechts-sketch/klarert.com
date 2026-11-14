// An installed pack's apps, resolved for one workspace and one person (docs/13). Pure: the server passes the live
// installs with their ref maps and the manifests of the installed versions; this returns the apps the person's role
// may see, with every screen's sheet, view, form and dashboard as ids. A screen whose objects the install does not
// have (a lower level, an archived pack) is left out, and an app with no screen left is not shown. Role visibility
// only hides: what a screen shows is still read with the person's own session (RLS, sheet access).
import type { Condition, Json, Role } from '../types';
import type { AppFilter, AppManifest, AppRole, AppScreen, AppSort, ScreenKind } from './types';
import { ME } from './types';

/** The app role of a workspace role: editors and viewers are members. */
export function appRoleOf(role: Role): AppRole {
  return role === 'owner' || role === 'admin' || role === 'auditor' ? role : 'member';
}

export const visibleTo = (roles: readonly AppRole[] | undefined, role: Role) =>
  !roles || roles.length === 0 || roles.includes(appRoleOf(role));

/**
 * The manifest bits resolution needs: each sheet's saved view names, in order. A required pack's sheet is listed as
 * `<pack>:<sheet>` with the views this pack's extends adds to it (refs `<pack>:<sheet>.view.<n>`).
 */
export interface AppPackView {
  sheets: { ref: string; views: { name: string }[] }[];
}

export interface ResolvedScreen {
  key: string;
  title: string;
  description?: string;
  kind: ScreenKind;
  section: string;
  /** The sheet the screen reads (the child sheet for sub-items). */
  sheetId?: string;
  /** The parent sheet when the screen reads sub-items (their items open there). */
  parentSheetId?: string;
  subitems?: boolean;
  /** view: a saved view's id; form: the form's view id. */
  viewId?: string;
  dashboardId?: string;
  fieldKey?: string;
  filters?: AppFilter[];
  sort?: AppSort[];
  show?: string[];
  empty?: string;
}

export interface ResolvedApp {
  key: string;
  title: string;
  description: string;
  icon: AppManifest['icon'];
  installId: string;
  packKey: string;
  sections: { title: string; screens: ResolvedScreen[] }[];
}

export interface AppInstall {
  id: string;
  packKey: string;
  refMap: Record<string, string>;
  apps: AppManifest[];
  pack: AppPackView;
  /** The ref maps of the live installs of the packs this one requires, by pack key (screens on `core:nc`). */
  required?: Record<string, Record<string, string>>;
}

/** One screen's ids through the install's ref map, or null when something it names is not installed. */
export function resolveScreen(
  screen: AppScreen,
  section: string,
  refMap: Record<string, string>,
  pack: AppPackView,
  required: Record<string, Record<string, string>> = {},
): ResolvedScreen | null {
  const base = {
    key: screen.key,
    title: screen.title,
    ...(screen.description ? { description: screen.description } : {}),
    kind: screen.kind,
    section,
  };
  // a required pack's sheet lives in that pack's install; what this pack added to it (views, forms) in its own
  const sheet = (ref: string) => {
    const colon = ref.indexOf(':');
    return colon > 0
      ? required[ref.slice(0, colon)]?.[`sheet:${ref.slice(colon + 1)}`]
      : refMap[`sheet:${ref}`];
  };
  switch (screen.kind) {
    case 'view':
    case 'item': {
      const parent = sheet(screen.sheet);
      const id = screen.subitems ? sheet(`${screen.sheet}.subitems`) : parent;
      if (!id || !parent) return null;
      const where = screen.subitems ? { subitems: true, parentSheetId: parent } : {};
      if (screen.kind === 'view') {
        let viewId: string | undefined;
        if (screen.view) {
          const views = pack.sheets.find((s) => s.ref === screen.sheet)?.views ?? [];
          const i = views.findIndex((v) => v.name === screen.view);
          viewId = i >= 0 ? refMap[`view:${screen.sheet}.view.${i + 1}`] : undefined;
          if (!viewId) return null;
        }
        return { ...base, sheetId: id, ...where, ...(viewId ? { viewId } : {}) };
      }
      return {
        ...base,
        sheetId: id,
        ...where,
        filters: screen.filters,
        ...(screen.sort ? { sort: screen.sort } : {}),
        ...(screen.show ? { show: screen.show } : {}),
        ...(screen.empty ? { empty: screen.empty } : {}),
      };
    }
    case 'form': {
      const id = sheet(screen.sheet);
      const viewId = refMap[`view:${screen.sheet}.form.${screen.form}`];
      return id && viewId ? { ...base, sheetId: id, viewId } : null;
    }
    case 'dashboard': {
      const id = refMap[`dashboard:${screen.dashboard}`];
      return id ? { ...base, dashboardId: id } : null;
    }
    case 'workflow': {
      const id = sheet(screen.sheet);
      return id
        ? { ...base, sheetId: id, ...(screen.fieldKey ? { fieldKey: screen.fieldKey } : {}) }
        : null;
    }
  }
}

/** The apps of the workspace's live installs (oldest install first) that this role may see. */
export function resolveApps(installs: readonly AppInstall[], role: Role): ResolvedApp[] {
  const out: ResolvedApp[] = [];
  const seen = new Set<string>();
  for (const install of installs)
    for (const app of install.apps) {
      if (seen.has(app.key) || !visibleTo(app.roles, role)) continue;
      const sections = app.sections
        .map((s) => ({
          title: s.title,
          screens: s.screens
            .filter((sc) => visibleTo(sc.roles, role))
            .map((sc) => resolveScreen(sc, s.title, install.refMap, install.pack, install.required))
            .filter((sc): sc is ResolvedScreen => sc !== null),
        }))
        .filter((s) => s.screens.length > 0);
      if (sections.length === 0) continue;
      seen.add(app.key);
      out.push({
        key: app.key,
        title: app.title,
        description: app.description ?? '',
        icon: app.icon,
        installId: install.id,
        packKey: install.packKey,
        sections,
      });
    }
  return out;
}

export const appScreens = (app: ResolvedApp) => app.sections.flatMap((s) => s.screens);

/** `{me}` in a filter value becomes the condition engine's `me` (the reading person). */
function meToken(v: Json | undefined): Json | undefined {
  if (v === ME) return 'me';
  if (Array.isArray(v)) return v.map((x) => (x === ME ? 'me' : x));
  return v;
}

/** An item screen's filters as conditions for the engine. */
export function screenConditions(filters: readonly AppFilter[]): Condition[] {
  return filters.map((f) => {
    const value = meToken(f.value);
    return value === undefined
      ? { fieldKey: f.fieldKey, op: f.op }
      : { fieldKey: f.fieldKey, op: f.op, value };
  });
}
