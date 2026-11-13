// Apps as data (docs/13): an app is navigation over a pack's sheets, forms and dashboards, shipped inside a pack
// manifest (`apps`) or as templates/apps/*.json that names the pack it needs. Screens name sheets, forms and
// dashboards by the pack's refs; a workspace's install resolves them through its ref map. Pure types.
import type { Json } from '../types';

/** Who may see an app or a screen. `member` is an editor or a viewer of the workspace. */
export const APP_ROLES = ['owner', 'admin', 'member', 'auditor'] as const;
export type AppRole = (typeof APP_ROLES)[number];

/** The icons an app may show in the side menu (lucide names, mapped in the shell). */
export const APP_ICONS = [
  'shield-alert',
  'clipboard-check',
  'wrench',
  'triangle-alert',
  'list-checks',
  'folder-kanban',
  'shield-check',
  'file-text',
] as const;
export type AppIcon = (typeof APP_ICONS)[number];

export const SCREEN_KINDS = ['view', 'item', 'form', 'dashboard', 'workflow'] as const;
export type ScreenKind = (typeof SCREEN_KINDS)[number];

/** The person reading the screen: a filter value `{me}` (or a list holding it) is their user id. */
export const ME = '{me}';

/** One filter of an item screen, by field key: `{ fieldKey: "owner", op: "includes_any_of", value: ["{me}"] }`. */
export interface AppFilter {
  fieldKey: string;
  op: string;
  value?: Json;
}

export interface AppSort {
  fieldKey: string;
  direction?: 'asc' | 'desc';
}

interface ScreenBase {
  /** Stable, in the URL: `/[org]/apps/[app]/[screen]`. */
  key: string;
  title: string;
  description?: string;
  /** Narrows the app's roles for this screen. Never widens access: RLS and sheet access still decide. */
  roles?: AppRole[];
}

/** A sheet of the pack by ref; `subitems: true` reads its sub-items (the hidden child sheet). */
interface OnSheet {
  sheet: string;
  subitems?: boolean;
}

/** The sheet itself (its Table and other views), opened on a saved view of the pack by name when given. */
export interface ViewScreen extends ScreenBase, OnSheet {
  kind: 'view';
  view?: string;
}

/** A list of items to act on: the sheet's (or its sub-items') items that match every filter, sorted. */
export interface ItemScreen extends ScreenBase, OnSheet {
  kind: 'item';
  filters: AppFilter[];
  sort?: AppSort[];
  /** Field keys shown on each row besides the name (status, due date …). */
  show?: string[];
  /** What the empty list says. */
  empty?: string;
}

/** A form of the sheet, by the pack's form ref. */
export interface FormScreen extends ScreenBase {
  kind: 'form';
  sheet: string;
  form: string;
}

/** A dashboard of the pack, by ref. */
export interface DashboardScreen extends ScreenBase {
  kind: 'dashboard';
  dashboard: string;
}

/** The sheet's lifecycle on Workflow, by a status or label field. */
export interface WorkflowScreen extends ScreenBase {
  kind: 'workflow';
  sheet: string;
  fieldKey?: string;
}

export type AppScreen = ViewScreen | ItemScreen | FormScreen | DashboardScreen | WorkflowScreen;

export interface AppSection {
  title: string;
  screens: AppScreen[];
}

export interface AppManifest {
  /** `^[a-z0-9][a-z0-9-]{0,39}$`, unique in a workspace (the first install wins). */
  key: string;
  title: string;
  description?: string;
  icon: AppIcon;
  /** Who sees the app; none = everyone in the workspace. */
  roles?: AppRole[];
  sections: AppSection[];
}

/** templates/apps/*.json: an app for a pack it does not ship in. */
export interface AppFile {
  requires: { pack: string; range: string };
  app: AppManifest;
}
