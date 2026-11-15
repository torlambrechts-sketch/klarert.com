import { describe, expect, it } from 'vitest';
import {
  builtinTabs,
  describeTabsChange,
  dropTab,
  readSheetTabs,
  readTabSettings,
  resolveTemplateTabs,
  sameTabs,
  sheetTabsSchema,
  type SheetTab,
} from './tabs';

const V1 = '8b1c2d3e-0000-4000-8000-000000000001';
const V2 = '8b1c2d3e-0000-4000-8000-000000000002';
const messages = (r: ReturnType<typeof sheetTabsSchema.safeParse>) =>
  r.success ? [] : r.error.issues.map((i) => i.message);

describe('sheetTabsSchema', () => {
  it('accepts built-in ids and view uuids with labels, trimmed', () => {
    const r = sheetTabsSchema.safeParse({
      tabs: [
        { id: 'kanban' },
        { id: 'table' },
        { id: V1, label: '  Overdue  ' },
        { id: 'form', hidden: true },
      ],
      defaultViewId: 'kanban',
    });
    expect(r.success).toBe(true);
    expect(r.data?.tabs[2]).toEqual({ id: V1, label: 'Overdue' });
  });

  it('refuses a hidden Table and a missing Table', () => {
    expect(
      messages(sheetTabsSchema.safeParse({ tabs: [{ id: 'table', hidden: true }] })),
    ).toContain('Table is always shown.');
    expect(messages(sheetTabsSchema.safeParse({ tabs: [{ id: 'kanban' }] }))).toContain(
      'Table is always shown.',
    );
  });

  it('refuses duplicates, unknown ids, empty and long labels, and more than 40 tabs', () => {
    expect(
      messages(
        sheetTabsSchema.safeParse({ tabs: [{ id: 'table' }, { id: 'kanban' }, { id: 'kanban' }] }),
      ),
    ).toContain('Each view can have one tab.');
    expect(sheetTabsSchema.safeParse({ tabs: [{ id: 'table' }, { id: 'list' }] }).success).toBe(
      false,
    );
    expect(sheetTabsSchema.safeParse({ tabs: [{ id: 'table' }, { id: 'nope' }] }).success).toBe(
      false,
    );
    expect(
      messages(sheetTabsSchema.safeParse({ tabs: [{ id: 'table', label: '   ' }] })),
    ).toContain('A tab name is required.');
    expect(
      sheetTabsSchema.safeParse({ tabs: [{ id: 'table', label: 'x'.repeat(41) }] }).success,
    ).toBe(false);
    expect(sheetTabsSchema.safeParse({ tabs: [] }).success).toBe(false);
    const many = Array.from({ length: 41 }, (_, i) => ({
      id: i === 0 ? 'table' : `8b1c2d3e-0000-4000-8000-${String(i).padStart(12, '0')}`,
    }));
    expect(sheetTabsSchema.safeParse({ tabs: many }).success).toBe(false);
    expect(sheetTabsSchema.safeParse({ tabs: many.slice(0, 40) }).success).toBe(true);
  });

  it('refuses an unknown default and a hidden default; former ids read as Table', () => {
    const tabs = [{ id: 'table' }, { id: 'calendar', hidden: true }];
    expect(messages(sheetTabsSchema.safeParse({ tabs, defaultViewId: V1 }))).toContain(
      'The tab that opens first must be one of the tabs.',
    );
    expect(messages(sheetTabsSchema.safeParse({ tabs, defaultViewId: 'calendar' }))).toContain(
      'A hidden tab cannot open first. Show it, or choose another tab.',
    );
    expect(sheetTabsSchema.safeParse({ tabs, defaultViewId: 'list' }).success).toBe(true);
  });
});

describe('stored tab sets', () => {
  it('reads absent or broken settings as no tab set', () => {
    expect(readSheetTabs(undefined)).toBeNull();
    expect(readSheetTabs([{ id: 'nope' }])).toBeNull();
    expect(
      readTabSettings({ tabs: [{ id: 'table', hidden: false }], defaultViewId: 'kanban' }),
    ).toEqual({
      tabs: [{ id: 'table' }],
      tabsDefault: null,
      defaultViewId: 'kanban',
    });
    expect(readTabSettings(null).tabs).toBeNull();
  });

  it('compares tab sets by order, shown and label', () => {
    expect(sameTabs(builtinTabs(), [...builtinTabs()])).toBe(true);
    expect(sameTabs([{ id: 'table' }, { id: 'kanban' }], [{ id: 'kanban' }, { id: 'table' }])).toBe(
      false,
    );
    expect(sameTabs([{ id: 'table', hidden: false }], [{ id: 'table' }])).toBe(true);
  });

  it('drops a deleted view from the tabs, the template default and the default view', () => {
    const settings = {
      holdAutomations: true,
      tabs: [{ id: 'table' }, { id: V1 }, { id: V2, hidden: true }],
      tabsDefault: [{ id: 'table' }, { id: V1 }],
      defaultViewId: V1,
    };
    expect(dropTab(settings, V1)).toEqual({
      holdAutomations: true,
      tabs: [{ id: 'table' }, { id: V2, hidden: true }],
      tabsDefault: [{ id: 'table' }],
    });
    const untouched = { tabs: [{ id: 'table' }] };
    expect(dropTab(untouched, V1)).toBe(untouched);
  });
});

describe('template tabs', () => {
  const views = [
    { name: 'By status', id: V1 },
    { name: 'Due dates', id: V2 },
  ];

  it('resolves built-in refs and view names, then adds the left-out built-ins hidden', () => {
    const r = resolveTemplateTabs(
      [{ ref: 'table' }, { ref: 'By status', label: 'Board' }, { ref: 'calendar' }],
      undefined,
      views,
    );
    expect(r.problems).toEqual([]);
    expect(r.tabs).toEqual([
      { id: 'table' },
      { id: V1, label: 'Board' },
      { id: 'calendar' },
      { id: 'insights', hidden: true },
      { id: 'kanban', hidden: true },
      { id: 'form', hidden: true },
    ]);
  });

  it('counts a set without the Design tab the same as one with it hidden (it starts under More)', () => {
    expect(sameTabs([{ id: 'table' }], [{ id: 'table' }, { id: 'design', hidden: true }])).toBe(
      true,
    );
    expect(sameTabs([{ id: 'table' }], [{ id: 'table' }, { id: 'design' }])).toBe(false);
  });

  it('puts the Table first when a template leaves it out and resolves the default view', () => {
    const r = resolveTemplateTabs([{ ref: 'kanban' }], 'kanban', []);
    expect(r.tabs.slice(0, 2)).toEqual([{ id: 'table' }, { id: 'kanban' }]);
    expect(r.defaultViewId).toBe('kanban');
  });

  it('reports unknown refs and a hidden default', () => {
    expect(resolveTemplateTabs([{ ref: 'Nowhere' }], undefined, views).problems).toEqual([
      'Unknown tab "Nowhere".',
    ]);
    expect(
      resolveTemplateTabs(
        [{ ref: 'table' }, { ref: 'Due dates', hidden: true }],
        'Due dates',
        views,
      ).problems,
    ).toEqual(['A hidden tab cannot open first. Show it, or choose another tab.']);
  });
});

describe('describeTabsChange', () => {
  const name = (id: string) =>
    ({ table: 'Table', insights: 'Insights', kanban: 'Board', calendar: 'Calendar', form: 'Form' })[
      id
    ] ?? 'Saved view';
  const before: SheetTab[] = builtinTabs();

  it('names hidden, shown, renamed and moved tabs', () => {
    const after: SheetTab[] = [
      { id: 'kanban' },
      { id: 'table' },
      { id: 'insights', label: 'Dashboard' },
      { id: 'calendar', hidden: true },
      { id: 'form' },
    ];
    expect(
      describeTabsChange(
        { tabs: before, defaultViewId: null },
        { tabs: after, defaultViewId: null },
        name,
      ),
    ).toBe('Tabs changed: renamed Insights to Dashboard, hid Calendar, changed the order');
  });

  it('is not a move when a tab is only hidden; names the tab that opens first', () => {
    const after = before.map((t) => (t.id === 'kanban' ? { ...t, hidden: true } : t));
    expect(
      describeTabsChange(
        { tabs: before, defaultViewId: 'table' },
        { tabs: after, defaultViewId: 'calendar' },
        name,
      ),
    ).toBe('Tabs changed: hid Board, Calendar opens first');
    expect(
      describeTabsChange(
        { tabs: before, defaultViewId: null },
        { tabs: before, defaultViewId: 'table' },
        name,
      ),
    ).toBeNull();
  });
});
