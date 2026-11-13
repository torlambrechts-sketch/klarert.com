// The heart of setSheetTabs (docs/02 sheets.settings.tabs): who may change a sheet's tabs, which views may be tabs,
// the view that opens first and the stored settings. Kept free of `server-only` and of Supabase so the rules are
// unit-tested; the command in ./views.ts supplies the real dependencies (withOrg 'admin', the person's client).
import type { Json } from '@/engine/types';
import { toViewType, VIEW_TYPE_LABEL } from '@/engine/views/config';
import {
  builtinTabs,
  cleanTab,
  describeTabsChange,
  isBuiltinTab,
  normaliseViewId,
  readTabSettings,
  sheetTabsSchema,
  type SheetTab,
} from '@/engine/views/tabs';
import { fail, ok, type Result } from '@/server/result';

export const ONLY_ADMINS_TABS = 'Only owners and admins can change tabs.';

export interface TabView {
  id: string;
  name: string;
  /** As stored (list, grid, kanban …). */
  type: string;
  ownerId: string | null;
  position: string;
}

export interface SheetTabsDeps {
  role: string;
  /** The sheet's settings, or null when it is not in the workspace. */
  loadSettings(): Promise<Record<string, Json> | null>;
  /** The sheet's views the person can see (shared ones and their own). */
  views(): Promise<TabView[]>;
  saveSettings(settings: Record<string, Json>): Promise<Result<null>>;
}

export interface SheetTabsResult {
  tabs: SheetTab[];
  defaultViewId: string;
  /** Said to the person when the view that opened first was hidden and the Table opens first now. */
  notice: string | null;
  /** "Tabs changed: hid Board, …", or null when nothing changed. */
  summary: string | null;
}

const isAdmin = (role: string) => role === 'owner' || role === 'admin';

export async function setSheetTabsWith(
  deps: SheetTabsDeps,
  input: { tabs: SheetTab[]; defaultViewId?: string },
): Promise<Result<SheetTabsResult>> {
  // withOrg('admin') checks this first; checked again so the rule holds wherever this runs
  if (!isAdmin(deps.role)) return fail('forbidden', ONLY_ADMINS_TABS);
  const settings = await deps.loadSettings();
  if (!settings) return fail('not_found', 'This sheet no longer exists.');
  const views = await deps.views();
  const byId = new Map(views.map((v) => [v.id, v]));
  for (const t of input.tabs) {
    if (isBuiltinTab(t.id)) continue;
    const view = byId.get(t.id);
    if (!view) return fail('invalid', 'A tab points at a view that no longer exists.');
    if (view.ownerId !== null)
      return fail('invalid', 'A personal view cannot be a tab for everyone. Share it first.');
  }

  // the shared view behind a built-in tab (the first shared view of that type), as the editor lists it
  const shared = views
    .filter((v) => v.ownerId === null)
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const backing = (type: string) => shared.find((v) => toViewType(v.type) === type);
  const asTab = (id: string) => {
    if (input.tabs.some((t) => t.id === id)) return id;
    const view = byId.get(id);
    const type = view && toViewType(view.type);
    return type && backing(type)?.id === id ? type : id;
  };
  const name = (id: string) => {
    if (id === 'table') return 'Table';
    // the Forms tab lists every form of the sheet (docs/05 §3.3); it is not named after one of them
    if (id === 'form') return 'Forms';
    if (isBuiltinTab(id))
      return backing(id)?.name ?? (id === 'kanban' ? 'Board' : VIEW_TYPE_LABEL[id]);
    return byId.get(id)?.name ?? 'A view';
  };

  const before = readTabSettings(settings);
  let defaultViewId = asTab(
    normaliseViewId(input.defaultViewId ?? before.defaultViewId ?? 'table'),
  );
  let notice: string | null = null;
  if (input.defaultViewId === undefined) {
    // the view that opened first is hidden now (or no longer a tab): the Table opens first, and the person is told
    const tab = input.tabs.find((t) => t.id === defaultViewId);
    if (!tab || tab.hidden) {
      if (tab) notice = `${tab.label ?? name(tab.id)} is hidden, so Table opens first now.`;
      defaultViewId = 'table';
    }
  }
  const tabs = input.tabs.map(cleanTab);
  const checked = sheetTabsSchema.safeParse({ tabs, defaultViewId });
  if (!checked.success)
    return fail('invalid', checked.error.issues[0]?.message ?? 'Check the tabs.');

  const saved = await deps.saveSettings({
    ...settings,
    tabs: tabs as unknown as Json,
    defaultViewId,
  });
  if (!saved.ok) return saved;
  const summary = describeTabsChange(
    { tabs: before.tabs ?? builtinTabs(), defaultViewId: before.defaultViewId },
    { tabs, defaultViewId },
    name,
  );
  return ok({ tabs, defaultViewId, notice, summary });
}
