import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem, sheet } from '../testing/fixtures';
import type { Json } from '../types';
import {
  ACTION_IDS,
  ACTIONS,
  draftProblems,
  describeAction,
  dropNotice,
  metShare,
  planActions,
  planRequirementSync,
  requirementRule,
  ruleMatch,
  shareDrop,
  subjectFacts,
  SYNC_DEFAULTS,
  syncConfig,
  syncMessage,
  type ExistingCheck,
  type RequirementRule,
  type SubjectFacts,
} from '.';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const cfg = SYNC_DEFAULTS;
const LIB = 's-lib';
const CATEGORIES: Json[] = [
  { id: 'opt_it', label: 'IT and cloud', color: 'blue' },
  { id: 'opt_parts', label: 'Parts and materials', color: 'teal' },
  { id: 'opt_services', label: 'Services', color: 'purple' },
];

// the supplier register (the fixture sheet) and the requirement library
const sup = {
  category: makeField('dropdown', { options: CATEGORIES }, { key: 'category' }),
  criticality: makeField('severity', FIELD_TYPES.severity.defaultConfig(), { key: 'criticality' }),
  pd: makeField('check', {}, { key: 'processes_personal_data' }),
  manual: makeField(
    'requirement',
    { targetSheetId: LIB, multiple: true, inverseFieldId: null },
    { key: 'requirements' },
  ),
};
const lib = {
  applies: makeField(
    'dropdown',
    {
      options: [
        { id: 'opt_all', label: 'Every supplier', color: 'grey' },
        { id: 'opt_rules', label: 'By category and criticality', color: 'blue' },
        { id: 'opt_processors', label: 'Suppliers that process personal data', color: 'purple' },
        { id: 'opt_manual_only', label: 'Only when added by hand', color: 'grey' },
      ],
    },
    { key: 'applies_when', sheetId: LIB },
  ),
  categories: makeField(
    'multiselect',
    {
      options: [
        { id: 'opt_it', label: 'IT and cloud', color: 'blue' },
        // a workspace's own option id, matched by label
        { id: 'opt_x9', label: 'Services', color: 'purple' },
      ],
    },
    { key: 'applies_categories', sheetId: LIB },
  ),
  min: makeField('severity', FIELD_TYPES.severity.defaultConfig(), {
    key: 'min_criticality',
    sheetId: LIB,
  }),
};
const req = (id: string, values: Record<string, Json>) =>
  makeItem(
    Object.fromEntries(Object.entries(values).map(([k, v]) => [lib[k as keyof typeof lib].id, v])),
    { id, sheetId: LIB, name: `Requirement ${id}` },
  );
const reqs = [
  req('r-contract', { applies: 'opt_all' }),
  req('r-dpa', { applies: 'opt_processors' }),
  req('r-iso27001', { categories: ['opt_it'], min: 'opt_high' }),
  req('r-services', { applies: 'opt_rules', categories: ['opt_x9'] }),
  req('r-nda', { applies: 'opt_manual_only' }),
  // a requirement a client added before 1.1.0: no rules → only by hand
  req('r-legacy', {}),
];
const supplier = makeItem(
  {
    [sup.category.id]: 'opt_it',
    [sup.criticality.id]: 'opt_critical',
    [sup.pd.id]: true,
  },
  { id: 'i-sup', name: 'Northwind Cloud', displayId: 'SUP-001' },
);
const ctx = makeCtx({
  fields: Object.values(sup),
  items: [supplier, ...reqs],
  otherFields: { [LIB]: Object.values(lib) },
  links: { [`i-sup:${sup.manual.id}`]: ['r-nda'] },
});
const libCtx = makeCtx(
  { fields: Object.values(lib), items: reqs },
  {
    sheet: { ...sheet, id: LIB, isLibrary: true },
    fieldsOf: (id) => (id === LIB ? Object.values(lib) : []),
  },
);
const rules = reqs.map((r) => requirementRule(r, libCtx, cfg));
const facts = subjectFacts(supplier, ctx, cfg);

const check = (id: string, requirementId: string, status: string | null, source: string | null) =>
  ({ id, requirementId, status, source }) satisfies ExistingCheck;

describe('reading the rules', () => {
  it('reads the supplier: category, criticality rank, personal data and requirements added by hand', () => {
    expect(facts).toEqual({
      category: { id: 'opt_it', label: 'IT and cloud' },
      criticality: 3,
      personalData: true,
      manual: ['r-nda'],
    });
  });

  it('reads each requirement’s mode; without one, rules make it rule-based and nothing makes it manual', () => {
    expect(rules.map((r) => [r.id, r.mode])).toEqual([
      ['r-contract', 'all'],
      ['r-dpa', 'processors'],
      ['r-iso27001', 'rules'],
      ['r-services', 'rules'],
      ['r-nda', 'manual'],
      ['r-legacy', 'manual'],
    ]);
    expect(rules[2]!.minCriticality).toBe(2);
  });
});

describe('ruleMatch', () => {
  const base: SubjectFacts = {
    category: { id: 'opt_it', label: 'IT and cloud' },
    criticality: 1,
    personalData: false,
    manual: [],
  };
  const r = (over: Partial<RequirementRule>): RequirementRule => ({
    id: 'r',
    name: 'R',
    mode: 'rules',
    categories: [],
    minCriticality: null,
    ...over,
  });

  it('matches category and minimum criticality', () => {
    expect(ruleMatch(r({ categories: [{ id: 'opt_it', label: 'x' }] }), base)).toBe('rule');
    expect(ruleMatch(r({ categories: [{ id: 'opt_parts', label: 'Parts' }] }), base)).toBeNull();
    expect(ruleMatch(r({ minCriticality: 2 }), base)).toBeNull();
    expect(ruleMatch(r({ minCriticality: 1 }), base)).toBe('rule');
  });

  it('matches a category by label when the ids differ', () => {
    expect(ruleMatch(r({ categories: [{ id: 'opt_9', label: 'it AND cloud' }] }), base)).toBe(
      'rule',
    );
  });

  it('waits for both category and criticality, but not for the Art. 28 set', () => {
    const blank = { ...base, category: null, personalData: true };
    expect(ruleMatch(r({ mode: 'all' }), blank)).toBeNull();
    expect(ruleMatch(r({ mode: 'processors' }), blank)).toBe('art28');
    expect(ruleMatch(r({ mode: 'processors' }), base)).toBeNull();
    expect(ruleMatch(r({ mode: 'manual' }), base)).toBeNull();
  });
});

describe('planRequirementSync', () => {
  it('creates the checks the rules, the Art. 28 set and the manual list ask for', () => {
    const plan = planRequirementSync({ facts, rules, checks: [], cfg });
    expect(plan.create).toEqual([
      { requirementId: 'r-contract', name: 'Requirement r-contract', source: 'rule' },
      { requirementId: 'r-dpa', name: 'Requirement r-dpa', source: 'art28' },
      { requirementId: 'r-iso27001', name: 'Requirement r-iso27001', source: 'rule' },
      { requirementId: 'r-nda', name: 'Requirement r-nda', source: 'manual' },
    ]);
    expect(plan.flag).toEqual([]);
  });

  it('creates only what is missing and flags what no longer applies, never what a person decided', () => {
    const checks = [
      check('c-1', 'r-contract', 'opt_met', 'opt_rule'),
      // services no longer matches: flagged, its status was Met
      check('c-2', 'r-services', 'opt_met', 'opt_rule'),
      // added by hand on the checks sheet: never flagged
      check('c-3', 'r-legacy', 'opt_not_checked', 'opt_manual'),
      // Not applicable is a person's decision: never touched
      check('c-4', 'r-iso27001', 'opt_na', 'opt_rule'),
    ];
    const plan = planRequirementSync({ facts, rules, checks, cfg });
    expect(plan.create.map((c) => c.requirementId)).toEqual(['r-dpa', 'r-nda']);
    expect(plan.flag).toEqual([
      {
        checkId: 'c-2',
        requirementId: 'r-services',
        reason: 'The category or criticality no longer matches the requirement.',
      },
    ]);
    expect(plan.reopen).toEqual([]);
  });

  it('flags the Art. 28 set when the supplier stops processing personal data', () => {
    const plan = planRequirementSync({
      facts: { ...facts, personalData: false },
      rules,
      checks: [check('c-dpa', 'r-dpa', 'opt_not_met', 'opt_art28')],
      cfg,
    });
    expect(plan.flag[0]!.reason).toBe('The supplier no longer processes personal data.');
  });

  it('reopens a check it had flagged when the requirement applies again', () => {
    const plan = planRequirementSync({
      facts,
      rules,
      checks: [check('c-1', 'r-contract', 'opt_no_longer', 'opt_rule')],
      cfg,
    });
    expect(plan.reopen).toEqual([{ checkId: 'c-1', requirementId: 'r-contract' }]);
    expect(plan.create.map((c) => c.requirementId)).not.toContain('r-contract');
  });

  it('says why when a requirement left the library', () => {
    const plan = planRequirementSync({
      facts,
      rules: rules.filter((r) => r.id !== 'r-contract'),
      checks: [check('c-1', 'r-contract', 'opt_not_checked', 'opt_rule')],
      cfg,
    });
    expect(plan.flag[0]!.reason).toBe('The requirement is no longer in the library.');
  });

  it('limits a library re-sync to one requirement and caps creates per run', () => {
    const only = planRequirementSync({ facts, rules, checks: [], cfg, only: new Set(['r-dpa']) });
    expect(only.create.map((c) => c.requirementId)).toEqual(['r-dpa']);
    const capped = planRequirementSync({ facts, rules, checks: [], cfg, limit: 1 });
    expect(capped.create).toHaveLength(1);
    expect(capped.deferred).toBe(3);
  });

  it('is idempotent: a second plan after the first is written does nothing', () => {
    const first = planRequirementSync({ facts, rules, checks: [], cfg });
    const written = first.create.map((c, i) =>
      check(`c-${i}`, c.requirementId, 'opt_not_checked', cfg.source[c.source]),
    );
    const again = planRequirementSync({ facts, rules, checks: written, cfg });
    expect(again).toEqual({ create: [], flag: [], reopen: [], deferred: 0 });
  });
});

describe('share met', () => {
  it('leaves out Not applicable and No longer applies', () => {
    expect(metShare(['opt_met', 'opt_na', 'opt_not_met', 'opt_no_longer'], cfg)).toEqual({
      met: 1,
      total: 2,
      pct: 50,
    });
    expect(metShare([], cfg).pct).toBeNull();
  });

  it('drops when new checks are added to a supplier that had some met', () => {
    const checks = [check('c-1', 'r-contract', 'opt_met', 'opt_rule')];
    const plan = planRequirementSync({ facts, rules, checks, cfg });
    const drop = shareDrop(checks, plan, cfg);
    expect(drop.dropped).toBe(true);
    expect(drop.before.pct).toBe(100);
    expect(drop.after.pct).toBe(25);
    expect(dropNotice(supplier, drop, 3)).toBe(
      'SUP-001 Northwind Cloud: 3 new requirements to check. Requirements met went from 100% to 25%.',
    );
    // a new supplier (nothing met yet) is not news
    expect(shareDrop([], planRequirementSync({ facts, rules, checks: [], cfg }), cfg).dropped).toBe(
      false,
    );
  });
});

describe('the action', () => {
  it('is in the registry', () => {
    expect(ACTION_IDS).toContain('sync_requirement_checks');
    expect(ACTIONS.sync_requirement_checks).toBeTypeOf('function');
  });

  const env = {
    appUrl: 'https://app.test',
    workspace: 'meridian',
    actor: { kind: 'user' as const, id: 'u-maria' },
    automation: { id: 'a-1', name: 'Sync', trigger: { type: 'button_clicked' as const } },
    roleHolders: () => [],
  };

  it('plans one effect with the settings over the defaults', () => {
    const [step] = planActions(
      [
        {
          type: 'sync_requirement_checks',
          sheetId: 's-checks',
          notifyFieldKey: 'owner',
          limit: 20,
        },
      ],
      supplier,
      null,
      ctx,
      env,
    );
    expect(step!.summary).toBe('Sync requirement checks');
    const effect = step!.effects[0]!;
    expect(effect).toMatchObject({
      kind: 'sync_requirement_checks',
      itemId: 'i-sup',
      checksSheetId: 's-checks',
      mode: 'subject',
    });
    const c = (effect as { config: Json }).config as unknown as typeof cfg;
    expect(c.notifyFieldKey).toBe('owner');
    expect(c.limit).toBe(20);
    expect(c.status.met).toBe('opt_met');
  });

  it('re-syncs across suppliers from a library item', () => {
    const [step] = planActions(
      [{ type: 'sync_requirement_checks', sheetId: 's-checks' }],
      reqs[0]!,
      null,
      libCtx,
      env,
    );
    expect(step!.effects[0]).toMatchObject({ mode: 'requirement', itemId: 'r-contract' });
  });

  it('fails without the checks sheet, and the builder says so', () => {
    const [step] = planActions([{ type: 'sync_requirement_checks' }], supplier, null, ctx, env);
    expect(step!.outcome).toBe('failed');
    const problems = draftProblems(
      {
        name: '',
        trigger: { type: 'item_created' },
        conditions: [],
        actions: [{ type: 'sync_requirement_checks', sheetId: null }],
      },
      ctx,
    );
    expect(Object.values(problems)).toContain('Choose the sheet that holds the checks.');
    expect(
      describeAction({ type: 'sync_requirement_checks', sheetId: 's-checks' }, ctx, () => 'Checks'),
    ).toBe('sync the requirement checks on Checks');
  });

  it('reads malformed settings as the defaults', () => {
    const c = syncConfig({ type: 'sync_requirement_checks', status: 'x', limit: -1, statusKey: 3 });
    expect(c.status).toEqual(cfg.status);
    expect(c.limit).toBe(cfg.limit);
    expect(c.statusKey).toBe('status');
  });

  it('words the toast', () => {
    expect(syncMessage({ added: 4, flagged: 1 })).toBe('Added 4, flagged 1');
    expect(syncMessage({ added: 200, flagged: 0, reopened: 2, deferred: 37, subjects: 12 })).toBe(
      'Added 200, flagged 0, reopened 2 across 12 suppliers; 37 more on the next sync',
    );
  });
});
