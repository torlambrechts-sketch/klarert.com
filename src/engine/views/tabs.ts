// A sheet's tab set (docs/02 sheets.settings.tabs, docs/05 §3): which views get a tab, in which order, which are
// hidden in the More menu and what a tab is called. Pure: the rules the command, the editor and templates share.
import { z } from 'zod';
import { HIDDEN_BY_DEFAULT, toViewType, VIEW_TYPES, type ViewType } from './config';

/** One tab: a built-in view type or a shared saved view's uuid of the sheet. The label is display only. */
export interface SheetTab {
  id: string;
  hidden?: boolean;
  label?: string;
}

export const MAX_TABS = 40;
export const MAX_TAB_LABEL = 40;

/** The built-in tabs in today's order (the order a sheet without a tab set shows). */
export const BUILTIN_TAB_ORDER: readonly ViewType[] = VIEW_TYPES;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isViewUuid = (id: string) => UUID.test(id);
export const isBuiltinTab = (id: string): id is ViewType =>
  (VIEW_TYPES as readonly string[]).includes(id);

export const tabLabelSchema = z
  .string()
  .trim()
  .min(1, 'A tab name is required.')
  .max(MAX_TAB_LABEL, `A tab name can be at most ${MAX_TAB_LABEL} characters.`);

export const sheetTabSchema = z.object({
  id: z.string().refine((id) => isBuiltinTab(id) || isViewUuid(id), 'Choose a view of this sheet.'),
  hidden: z.boolean().optional(),
  label: tabLabelSchema.optional(),
});

/** A built-in id as the default (former ids read as Table), else the id as given. */
export const normaliseViewId = (id: string): string => toViewType(id) ?? id;

/**
 * The tab set and the view that opens first. Rules: 1–40 tabs, each id once, Table present and never hidden, and the
 * default view (when given) one of the tabs and not hidden.
 */
export const sheetTabsSchema = z
  .object({
    tabs: z
      .array(sheetTabSchema)
      .min(1, 'Keep at least the Table tab.')
      .max(MAX_TABS, `A sheet can have at most ${MAX_TABS} tabs.`),
    defaultViewId: z.string().min(1).max(64).optional(),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const [i, t] of v.tabs.entries()) {
      if (seen.has(t.id))
        ctx.addIssue({ code: 'custom', path: ['tabs', i], message: 'Each view can have one tab.' });
      seen.add(t.id);
    }
    const table = v.tabs.find((t) => t.id === 'table');
    if (!table) ctx.addIssue({ code: 'custom', path: ['tabs'], message: 'Table is always shown.' });
    else if (table.hidden)
      ctx.addIssue({ code: 'custom', path: ['tabs'], message: 'Table is always shown.' });
    if (v.defaultViewId !== undefined) {
      const id = normaliseViewId(v.defaultViewId);
      const tab = v.tabs.find((t) => t.id === id);
      if (!tab)
        ctx.addIssue({
          code: 'custom',
          path: ['defaultViewId'],
          message: 'The tab that opens first must be one of the tabs.',
        });
      else if (tab.hidden)
        ctx.addIssue({
          code: 'custom',
          path: ['defaultViewId'],
          message: 'A hidden tab cannot open first. Show it, or choose another tab.',
        });
    }
  });
export type SheetTabs = z.infer<typeof sheetTabsSchema>;

/** Only the parts of a tab that are set (no `hidden: false`, no label equal to nothing). */
export function cleanTab(t: SheetTab): SheetTab {
  return {
    id: t.id,
    ...(t.hidden ? { hidden: true } : {}),
    ...(t.label?.trim() ? { label: t.label.trim() } : {}),
  };
}

/** A stored tab list (settings.tabs or settings.tabsDefault), or null when absent or broken (today's order). */
export function readSheetTabs(raw: unknown): SheetTab[] | null {
  const r = z.array(sheetTabSchema).min(1).max(MAX_TABS).safeParse(raw);
  return r.success ? r.data.map(cleanTab) : null;
}

/** The settings keys this feature reads. */
export function readTabSettings(settings: unknown): {
  tabs: SheetTab[] | null;
  tabsDefault: SheetTab[] | null;
  defaultViewId: string | null;
} {
  const s =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  return {
    tabs: readSheetTabs(s.tabs),
    tabsDefault: readSheetTabs(s.tabsDefault),
    defaultViewId: typeof s.defaultViewId === 'string' ? s.defaultViewId : null,
  };
}

/** The built-in tab set a sheet without one shows: today's order, shown except the ones that start under More. */
export const builtinTabs = (): SheetTab[] =>
  BUILTIN_TAB_ORDER.map((id) => (HIDDEN_BY_DEFAULT.includes(id) ? { id, hidden: true } : { id }));

/**
 * A tab set with the built-ins that start under More (Design) appended, hidden, when it does not list them: what the
 * bar shows for it. Stored sets (templates, packs) never need to name them.
 */
export function withDefaultHidden(tabs: readonly SheetTab[]): SheetTab[] {
  const out = tabs.map(cleanTab);
  for (const id of HIDDEN_BY_DEFAULT)
    if (!out.some((t) => t.id === id)) out.push({ id, hidden: true });
  return out;
}

/** Two tab sets are the same (order, shown, labels), a built-in that starts under More counting as hidden. */
export function sameTabs(a: readonly SheetTab[], b: readonly SheetTab[]): boolean {
  const norm = (l: readonly SheetTab[]) => JSON.stringify(withDefaultHidden(l));
  return norm(a) === norm(b);
}

/** Settings without a deleted (or no longer shared) view's tab; unchanged when it had none. */
export function dropTab<T extends Record<string, unknown>>(settings: T, viewId: string): T {
  let changed = false;
  const next: Record<string, unknown> = { ...settings };
  for (const key of ['tabs', 'tabsDefault'] as const) {
    const list = readSheetTabs(settings[key]);
    if (!list || !list.some((t) => t.id === viewId)) continue;
    changed = true;
    next[key] = list.filter((t) => t.id !== viewId);
  }
  if (settings.defaultViewId === viewId) {
    changed = true;
    delete next.defaultViewId;
  }
  return changed ? (next as T) : settings;
}

// ───────────────────────── templates ─────────────────────────

/** A template's tab: a built-in type (former ids too) or the name of a view in the same template sheet. */
export interface TemplateTab {
  ref: string;
  hidden?: boolean;
  label?: string;
}

/**
 * A template's tabs as stored on the sheet: refs resolved to built-in ids or the new views' ids, then the built-in
 * views the template leaves out, hidden (they stay in More). Unknown refs are reported, not stored.
 */
export function resolveTemplateTabs(
  tabs: readonly TemplateTab[],
  defaultRef: string | undefined,
  views: readonly { name: string; id: string }[],
): { tabs: SheetTab[]; defaultViewId?: string; problems: string[] } {
  const problems: string[] = [];
  const idOf = (ref: string) => toViewType(ref) ?? views.find((v) => v.name === ref)?.id ?? null;
  const out: SheetTab[] = [];
  for (const t of tabs) {
    const id = idOf(t.ref);
    if (!id) {
      problems.push(`Unknown tab "${t.ref}".`);
      continue;
    }
    if (out.some((x) => x.id === id)) continue;
    out.push(cleanTab({ id, hidden: t.hidden, label: t.label }));
  }
  if (!out.some((t) => t.id === 'table')) out.unshift({ id: 'table' });
  // the built-ins it leaves out stay in More; one that starts there anyway (Design) is not stored
  for (const id of BUILTIN_TAB_ORDER)
    if (!out.some((t) => t.id === id) && !HIDDEN_BY_DEFAULT.includes(id))
      out.push({ id, hidden: true });
  const defaultViewId = defaultRef ? (idOf(defaultRef) ?? undefined) : undefined;
  if (defaultRef && !defaultViewId) problems.push(`Unknown default view "${defaultRef}".`);
  const check = sheetTabsSchema.safeParse({ tabs: out, defaultViewId });
  if (!check.success) problems.push(...check.error.issues.map((i) => i.message));
  return { tabs: out, ...(defaultViewId ? { defaultViewId } : {}), problems };
}

// ───────────────────────── the change, in words ─────────────────────────

/**
 * One line for the toast and the sheet's activity log: "Tabs changed: hid Board, renamed Insights to Dashboard".
 * `name` gives a tab's name without a label (built-in name or the view's name).
 */
export function describeTabsChange(
  before: { tabs: readonly SheetTab[]; defaultViewId: string | null },
  after: { tabs: readonly SheetTab[]; defaultViewId: string | null },
  name: (id: string) => string,
): string | null {
  const shown = (t: SheetTab | undefined) => (t ? (t.label ?? name(t.id)) : '');
  // a set that does not name the Design tab shows it under More, as one that hides it
  before = { ...before, tabs: withDefaultHidden(before.tabs) };
  after = { ...after, tabs: withDefaultHidden(after.tabs) };
  const prev = new Map(before.tabs.map((t) => [t.id, t]));
  const parts: string[] = [];
  for (const t of after.tabs) {
    const was = prev.get(t.id);
    const label = shown(t);
    if (was && shown(was) !== label) parts.push(`renamed ${shown(was)} to ${label}`);
    if (!!was?.hidden !== !!t.hidden) parts.push(`${t.hidden ? 'hid' : 'showed'} ${label}`);
  }
  // the order of the tabs shown before and after (hiding or showing one is not a move)
  const order = (l: readonly SheetTab[], keep: Set<string>) =>
    l.filter((t) => keep.has(t.id)).map((t) => t.id);
  const both = new Set(
    before.tabs
      .filter((t) => !t.hidden && after.tabs.some((x) => x.id === t.id && !x.hidden))
      .map((t) => t.id),
  );
  if (order(before.tabs, both).join() !== order(after.tabs, both).join())
    parts.push('changed the order');
  const def = (id: string | null) => normaliseViewId(id ?? 'table');
  if (def(before.defaultViewId) !== def(after.defaultViewId)) {
    const tab = after.tabs.find((t) => t.id === def(after.defaultViewId));
    parts.push(`${tab ? shown(tab) : name(def(after.defaultViewId))} opens first`);
  }
  return parts.length ? `Tabs changed: ${parts.join(', ')}` : null;
}
