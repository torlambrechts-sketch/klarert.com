import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import allowlist from './quality-allowlist.json';
import { parsePack } from './manifest';
import { MIN_ADVANCED_AUTOMATIONS, packQualityProblems } from './quality';

// The pack quality bar (docs/11) over every native pack in templates/packs (framework libraries and wizard starts are
// not native packs). A pack on the allowlist has not been upgraded yet: it must still fail, so that the rewrite that
// makes it pass also takes it off the list.

const DIR = join(process.cwd(), 'templates/packs');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const packs = files.map((f) => parsePack(JSON.parse(readFileSync(join(DIR, f), 'utf8'))));
const allowed = new Set<string>(allowlist.packs as string[]);

describe('pack quality bar', () => {
  it('lists only packs that exist', () => {
    const keys = new Set(packs.map((p) => p.key));
    for (const k of allowed) expect(keys.has(k), k).toBe(true);
  });

  for (const pack of packs)
    it(`${pack.key} ${allowed.has(pack.key) ? 'is on the allowlist and still fails' : 'meets the bar'}`, () => {
      const problems = packQualityProblems(pack).map((p) => `${p.rule} · ${p.path}: ${p.message}`);
      if (allowed.has(pack.key))
        expect(
          problems.length,
          `${pack.key} passes: take it off quality-allowlist.json`,
        ).toBeGreaterThan(0);
      else expect(problems).toEqual([]);
    });
});

// a small pack that meets every rule, and what each rule says when it is broken
type Raw = Record<string, unknown>;
const sheet = (over: Raw): Raw => ({
  itemLabel: 'Item',
  groups: [{ ref: 'open', name: 'Open', color: 'blue' }],
  isLibrary: false,
  items: [],
  forms: [],
  ...over,
});
const status = { key: 'status', name: 'Status', type: 'status' };
const form = (ref: string, name: string): Raw => ({
  ref,
  name,
  access: 'internal',
  layout: { title: name, fields: [{ key: 'status', label: 'Status' }] },
});
const owner = { key: 'owner', name: 'Owner', type: 'people' };
const advanced = (ref: string): Raw => ({
  ref,
  sheet: 'actions',
  name: `Escalate ${ref}`,
  trigger: { type: 'item_created' },
  actions: [{ type: 'notify', to: ['field:owner'], message: '{name}' }],
  advanced: true,
  description: 'Escalates an overdue action to its owner.',
});
const good = () => {
  const risk: Raw = sheet({
    ref: 'risk',
    name: 'Risk register',
    idPrefix: 'R-',
    kind: 'register',
    fields: [status, owner, { key: 'next_review', name: 'Next review', type: 'date' }],
    views: [{ name: 'By status', type: 'kanban', config: { labelFieldKey: 'status' } }],
    tabs: [{ ref: 'table' }, { ref: 'By status' }, { ref: 'calendar' }],
    workflows: [
      {
        id: 'acceptance',
        name: 'Risk acceptance',
        enabled: true,
        steps: [
          {
            id: 'owner',
            name: 'Owner',
            approvers: { kind: 'field', fieldKey: 'owner' },
            mode: 'any',
            onReject: { to: 'draft' },
          },
        ],
      },
    ],
    forms: [form('report', 'Report a risk')],
  });
  const actions: Raw = sheet({
    ref: 'actions',
    name: 'Actions',
    idPrefix: 'A-',
    kind: 'actions',
    fields: [status, owner, { key: 'due_date', name: 'Due date', type: 'date' }],
    views: [{ name: 'Due', type: 'calendar', config: { dateFieldKey: 'due_date' } }],
    tabs: [{ ref: 'table' }, { ref: 'kanban' }, { ref: 'Due' }],
    forms: [form('ask', 'Ask for an action')],
  });
  return {
    key: 'quality-demo',
    version: '1.0.0',
    title: 'Quality demo',
    sheets: [risk, actions],
    automations: ['a1', 'a2', 'a3', 'a4'].map(advanced),
    dashboards: [{ ref: 'overview', name: 'Overview', headline: true, widgets: [] }],
  };
};

const rules = (raw: unknown) => packQualityProblems(parsePack(raw)).map((p) => p.rule);

describe('packQualityProblems', () => {
  it('passes a pack that meets the bar', () => {
    expect(packQualityProblems(parsePack(good()))).toEqual([]);
  });

  it('needs a kind on every sheet and at most 4 visible tabs', () => {
    const m = good();
    delete m.sheets[0]!.kind;
    delete m.sheets[1]!.tabs;
    expect(rules(m)).toEqual(expect.arrayContaining(['sheet-kind', 'tabs']));
  });

  it('needs a Board by status and a Calendar on a register with a review date', () => {
    const m = good();
    m.sheets[0]!.tabs = [{ ref: 'table' }, { ref: 'kanban' }];
    const out = packQualityProblems(parsePack(m)).filter((p) => p.rule === 'views');
    expect(out.map((p) => p.message)).toEqual([
      'register: Show a Board by status (a saved kanban view with labelFieldKey = the status field).',
      'register: Show a Calendar: the sheet has a review or expiry date.',
    ]);
  });

  it('needs a Calendar on the due date of an actions sheet', () => {
    const m = good();
    m.sheets[1]!.fields = [
      status,
      owner,
      { key: 'due_date', name: 'Due date', type: 'date' },
      { key: 'started', name: 'Started', type: 'date' },
    ];
    m.sheets[1]!.views = [{ name: 'Due', type: 'calendar', config: { dateFieldKey: 'started' } }];
    expect(rules(m)).toContain('views');
  });

  it(`needs ${MIN_ADVANCED_AUTOMATIONS} advanced automations, one headline dashboard and two forms`, () => {
    const m = good();
    m.automations[0]!.advanced = false;
    m.dashboards[0]!.headline = false;
    m.sheets[1]!.forms = [];
    expect(rules(m)).toEqual(
      expect.arrayContaining(['advanced-automations', 'headline-dashboard', 'intake-forms']),
    );
    expect(rules({ ...m, formsNotApplicable: 'A library of requirements.' })).not.toContain(
      'intake-forms',
    );
  });

  it('needs risk acceptance as an approval workflow', () => {
    const m = good();
    delete m.sheets[0]!.workflows;
    expect(rules(m)).toContain('approvals');
  });

  it('keeps Starter to 5 sheets and 1 dashboard', () => {
    const m = good();
    for (const n of [1, 2, 3, 4])
      m.sheets.push(
        sheet({
          ref: `lib${n}`,
          name: `Library ${n}`,
          idPrefix: `L${n}-`,
          isLibrary: true,
          fields: [],
          tabs: [{ ref: 'table' }],
        }),
      );
    m.dashboards.push({ ref: 'second', name: 'Second', headline: false, widgets: [] });
    const out = packQualityProblems(parsePack(m)).filter((p) => p.rule === 'starter-size');
    expect(out.map((p) => p.message)).toEqual([
      'The pack installs 6 sheets: at most 5.',
      'The pack installs 2 dashboards: at most 1.',
    ]);
  });

  it("refuses a standard's requirement wording", () => {
    const m = good();
    m.sheets[1]!.description = 'The organization shall keep a list of actions.';
    expect(rules(m)).toContain('standard-text');
  });
});
