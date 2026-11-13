import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planTemplateImport, templateSource, type PlanEnv } from './plan';
import { parseTemplate, sheetTemplateSchema } from './schema';

const raw = JSON.parse(readFileSync(new URL('../../../templates/first-sheet.json', import.meta.url), 'utf8'));
const template = parseTemplate(raw);

let n = 0;
const env = (): PlanEnv => {
  n = 0;
  return {
    orgId: 'org-1',
    folderId: 'folder-1',
    people: template.people.map((p) => ({
      ref: p.ref,
      id: `user-${p.ref}`,
      name: p.name,
      initials: p.initials,
      color: 'blue',
      email: p.email,
    })),
    today: '2026-11-11',
    now: new Date('2026-11-11T09:00:00Z'),
    timeZone: 'Europe/London',
    newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
    lastSheetPosition: null,
    jobRoles: [
      { id: 'role-cm', name: 'Compliance manager' },
      { id: 'role-hse', name: 'HSE manager' },
    ],
    teams: [],
  };
};

const plan = planTemplateImport(template, env());
const sheet = (ref: string) => plan.sheets.find((s) => s.ref === ref)!;
const field = (ref: string, key: string) => sheet(ref).fields.find((f) => f.key === key)!;
const item = (ref: string, name: string) => {
  for (const g of sheet(ref).items) {
    const r = g.rows.find((x) => x.name === name);
    if (r) return { ...r, groupId: g.groupId };
  }
  throw new Error(name);
};

describe('first-sheet template', () => {
  it('is valid against the template schema', () => {
    expect(template.sheets.map((s) => s.ref)).toEqual(['ca', 'act']);
  });

  it('plans the expected counts with no problems', () => {
    expect(plan.problems).toEqual([]);
    expect(plan.sheets).toHaveLength(2);
    // Corrective actions has sub-items: its column joins the 18 fields
    expect(plan.sheets.map((s) => s.fields.length)).toEqual([19, 7]);
    expect(plan.sheets[0]!.fields.find((f) => f.type === 'subitems')?.name).toBe('Steps');
    expect(plan.sheets[0]!.subitems?.fields.map((f) => f.key)).toEqual([
      'owner',
      'status',
      'due_date',
      'evidence',
    ]);
    expect(plan.sheets[0]!.subitems?.sheet.parent_sheet_id).toBe(plan.sheets[0]!.row.id);
    expect(plan.sheets[0]!.row.settings.subitems?.blockClose).toBe(true);
    expect(plan.sheets[1]!.subitems).toBeUndefined();
    expect(plan.sheets.map((s) => s.groups.length)).toEqual([2, 2]);
    expect(plan.sheets.map((s) => s.views.length)).toEqual([3, 2]);
    expect(plan.sheets.map((s) => s.items.reduce((a, g) => a + g.rows.length, 0))).toEqual([5, 2]);
    // two links in the template, each mirrored on the inverse field
    expect(plan.links).toHaveLength(4);
    expect(plan.automations).toHaveLength(9);
    expect(plan.automations.every((a) => a.enabled && a.source === templateSource(template.id))).toBe(
      true,
    );
  });

  it('keeps field keys and wires the two-way link fields to each other', () => {
    expect(sheet('ca').fields.map((f) => f.key)).toContain('priority_score');
    const actions = field('ca', 'actions').config as Record<string, unknown>;
    const back = field('act', 'corrective_action').config as Record<string, unknown>;
    expect(actions.targetSheetId).toBe(sheet('act').row.id);
    expect(actions.inverseFieldId).toBe(field('act', 'corrective_action').id);
    expect(back.targetSheetId).toBe(sheet('ca').row.id);
    expect(back.inverseFieldId).toBe(field('ca', 'actions').id);
    expect(actions).not.toHaveProperty('targetSheetRef');
  });

  it('turns default tokens into the words the default resolver reads', () => {
    expect((field('ca', 'found_on').config as { default: string }).default).toBe('today');
    expect((field('ca', 'due_date').config as { default: string }).default).toBe('in 30 days');
    expect((field('ca', 'status').config as { default: string }).default).toBe('opt_new');
  });

  it('resolves value tokens through the field types', () => {
    const burrs = item('ca', 'Burrs on bracket 44-210');
    expect(burrs.values[field('ca', 'owner').id]).toEqual(['user-tom']);
    expect(burrs.values[field('ca', 'severity').id]).toBe('opt_medium');
    expect(burrs.values[field('ca', 'found_on').id]).toBe('2026-11-02');
    expect(burrs.values[field('ca', 'due_date').id]).toBe('2026-11-16');
    expect(burrs.values[field('ca', 'risk').id]).toMatchObject({ l: 3, i: 3 });
    expect(burrs.groupId).toBe(sheet('ca').groups[0]!.id);
    const supplier = item('ca', 'Supplier evaluations overdue');
    expect(supplier.values[field('ca', 'effectiveness').id]).toMatchObject({
      answers: { l1: { a: 'yes' }, l2: { a: 'yes' }, l3: { a: 'na' } },
    });
    expect(item('act', 'Reprint CMM-2 calibration label').groupId).toBe(sheet('act').groups[1]!.id);
  });

  it('links both ways', () => {
    const forward = plan.links.filter((l) => l.fieldId === field('act', 'corrective_action').id);
    const inverse = plan.links.filter((l) => l.fieldId === field('ca', 'actions').id);
    expect(forward).toHaveLength(2);
    expect(inverse.map((l) => [l.from.name, l.to.name])).toContainEqual([
      'Burrs on bracket 44-210',
      'Deburr lot 2210 and re-inspect',
    ]);
  });

  it('resolves refs and option tokens in the automations', () => {
    const byName = (start: string) => plan.automations.find((a) => a.name.startsWith(start))!;
    expect(byName('Critical severity').trigger).toMatchObject({ value: 'opt_critical' });
    expect(byName('Critical severity').actions).toEqual([
      expect.objectContaining({ type: 'notify', to: ['jobRole:role-hse'] }),
    ]);
    expect(byName('Stuck').actions).toEqual([
      expect.objectContaining({ to: ['field:owner', 'jobRole:role-cm'] }),
    ]);
    expect(byName('Priority score above 15').conditions).toEqual([
      { fieldKey: 'severity', op: 'at_most', value: 'opt_medium' },
    ]);
    expect(byName('Raise action').actions).toContainEqual(
      expect.objectContaining({
        type: 'create_item',
        sheetId: sheet('act').row.id,
        groupId: sheet('act').groups[0]!.id,
        values: { due_date: '$in:14' },
      }),
    );
    expect(byName('Done → move').actions).toContainEqual({
      type: 'move_to_group',
      groupId: sheet('ca').groups[1]!.id,
    });
    expect(byName('Action done').sheet_id).toBe(sheet('act').row.id);
  });

  it('reports values that do not fit and automations the builder refuses', () => {
    const broken = structuredClone(raw);
    broken.sheets[0].items[0].values.due_date = 'not a date';
    broken.automations[0].trigger.fieldKey = 'source';
    broken.automations[0].trigger.value = '$option:Nope';
    broken.automations[1].actions[0].to = ['jobRole:Chief of nothing'];
    const p = planTemplateImport(parseTemplate(broken), env());
    expect(p.problems.some((x) => x.includes('Due date: not a valid date'))).toBe(true);
    expect(p.problems.some((x) => x.includes('no option "Nope"'))).toBe(true);
    expect(p.problems.some((x) => x.includes('no job role "Chief of nothing"'))).toBe(true);
  });

  it('refuses unknown refs', () => {
    const broken = structuredClone(raw);
    broken.sheets[1].items[0].links.corrective_action = ['$item:ca:No such item'];
    broken.sheets[0].items[0].group = 'nowhere';
    broken.automations[3].actions[0].groupRef = 'nowhere';
    const r = sheetTemplateSchema.safeParse(broken);
    expect(r.success).toBe(false);
    const messages = r.error!.issues.map((i) => i.message);
    expect(messages).toContain('Unknown linked item "$item:ca:No such item".');
    expect(messages).toContain('Unknown group "nowhere".');
  });

  it('stores the starting tabs on the sheet, as the tab set and the template default', () => {
    const settings = sheet('ca').row.settings;
    expect(settings.tabs).toEqual([
      { id: 'table' },
      { id: 'kanban' },
      { id: 'calendar' },
      { id: 'insights', hidden: true },
      { id: 'form', hidden: true },
    ]);
    expect(settings.tabsDefault).toEqual(settings.tabs);
    expect(settings.defaultViewId).toBeUndefined();
    // a sheet without starting tabs keeps today's order
    expect(sheet('act').row.settings.tabs).toBeUndefined();
  });

  it('resolves a tab named after a view to that view and opens the default tab first', () => {
    const t = structuredClone(raw);
    t.sheets[0].tabs = [{ ref: 'table' }, { ref: 'Due dates', label: 'Deadlines' }];
    t.sheets[0].defaultView = 'Due dates';
    const p = planTemplateImport(parseTemplate(t), env());
    const ca = p.sheets[0]!;
    const due = ca.views.find((v) => v.name === 'Due dates')!;
    expect(p.problems).toEqual([]);
    expect(ca.row.settings.tabs?.[1]).toEqual({ id: due.id, label: 'Deadlines' });
    expect(ca.row.settings.defaultViewId).toBe(due.id);
  });

  it('refuses unknown tab refs and a hidden view that opens first', () => {
    const broken = structuredClone(raw);
    broken.sheets[0].tabs = [{ ref: 'table' }, { ref: 'Nowhere' }, { ref: 'form', hidden: true }];
    broken.sheets[0].defaultView = 'form';
    const r = sheetTemplateSchema.safeParse(broken);
    expect(r.success).toBe(false);
    const messages = r.error!.issues.map((i) => i.message);
    expect(messages).toContain('Unknown view "Nowhere".');
    expect(messages).toContain('The view that opens first cannot be hidden.');
  });
});
