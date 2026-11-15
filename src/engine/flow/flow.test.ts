import { describe, expect, it } from 'vitest';
import { makeField, NOW, people } from '../testing/fixtures';
import type { Field, Json } from '../types';
import {
  connectionRows,
  deriveSheetFlow,
  filterChoices,
  filterGraph,
  flowSteps,
  layoutSheetMap,
  layoutWorkspace,
  leavesRows,
  maskUrl,
  maskWorld,
  packDrift,
  RESTRICTED_FIELD,
  scrub,
  sideOf,
  UNREADABLE_SHEET,
  workspaceGraph,
  type FlowAutomation,
  type FlowField,
  type FlowForm,
  type FlowSheet,
  type FlowViewer,
  type FlowWorld,
} from './index';

// The Design area's derivation (docs/05 §3.8): every kind of step and edge from configuration only, health in words,
// pack provenance, data that leaves the workspace, and restricted fields that never show their names.

const viewer: FlowViewer = { userId: 'u-maria', role: 'owner', now: NOW, timeZone: 'Europe/Oslo' };
const CORE = { installId: 'i-core', ref: '' };
const core = (ref: string) => ({ ...CORE, ref });

const sheet = (id: string, name: string, over: Partial<FlowSheet> = {}): FlowSheet => ({
  id,
  orgId: 'o-1',
  name,
  itemLabel: 'Item',
  idPrefix: `${id.toUpperCase()}-`,
  isLibrary: false,
  folderId: 'fo-ops',
  folderName: 'Operations',
  domain: 'Operations',
  pack: null,
  ...over,
});

const field = (
  sheetId: string,
  key: string,
  name: string,
  type: string,
  config: Record<string, unknown> = {},
  over: Partial<FlowField> = {},
): FlowField => ({
  ...(makeField(type, config, { key, name, id: `${sheetId}.${key}` }) as Field),
  sheetId,
  ...over,
});

const STAGES = {
  options: [
    { id: 'opt_open', label: 'Open', color: 'orange' },
    { id: 'opt_done', label: 'Closed', color: 'green', done: true },
  ],
};
const GRADES = {
  options: [
    { id: 'opt_minor', label: 'Minor', color: 'yellow' },
    { id: 'opt_major', label: 'Major', color: 'red' },
  ],
};

const auto = (
  id: string,
  sheetId: string,
  name: string,
  trigger: FlowAutomation['trigger'],
  actions: FlowAutomation['actions'],
  over: Partial<FlowAutomation> = {},
): FlowAutomation => ({
  id,
  sheetId,
  name,
  enabled: true,
  mode: 'live',
  trigger,
  conditions: [],
  actions,
  locked: false,
  lastRunAt: null,
  runCount: 0,
  createdAt: '2026-11-01T00:00:00Z',
  pack: null,
  ...over,
});

const form = (
  id: string,
  name: string,
  layout: FlowForm['layout'],
  over: Partial<FlowForm> = {},
): FlowForm => ({
  id,
  sheetId: 'nc',
  name,
  layout,
  position: id,
  pack: null,
  ...over,
});

const step = (id: string, approvers: Json = { kind: 'field', fieldKey: 'owner' }) => ({
  id,
  name: 'Review',
  approvers,
  mode: 'any',
  sla: null,
  onReject: { to: 'draft' },
  optionId: 'opt_open',
});

function world(): FlowWorld {
  const sheets: FlowSheet[] = [
    sheet('nc', 'Nonconformities and CAPA', {
      pack: core('nc'),
      folderId: 'fo-ms',
      folderName: 'Management system',
      domain: 'Management system',
      workflows: [
        {
          id: 'capa-closure',
          name: 'CAPA closure',
          enabled: true,
          steps: [step('s1') as never],
          requiredFields: [],
          allowSelfApproval: false,
          lockOnApproval: false,
        },
        {
          id: 'local-sign-off',
          name: 'Local sign-off',
          enabled: false,
          steps: [step('s1') as never],
          requiredFields: [],
          allowSelfApproval: false,
          lockOnApproval: false,
        },
      ],
    }),
    sheet('incidents', 'Incidents', { pack: core('incidents') }),
    sheet('actions', 'Actions', { pack: core('actions') }),
    sheet('risks', 'Risk register', { folderId: null, folderName: null, domain: null }),
  ];
  const fields: FlowField[] = [
    field('nc', 'details', 'Details', 'longtext', {}, { pack: core('nc.details') }),
    field('nc', 'grade', 'Grade', 'dropdown', GRADES, { required: true, pack: core('nc.grade') }),
    field('nc', 'owner', 'Owner', 'people', {}, { pack: core('nc.owner') }),
    field('nc', 'stage', 'Stage', 'status', STAGES, { pack: core('nc.stage') }),
    field('nc', 'due_date', 'Due date', 'date', {}, { pack: core('nc.due_date') }),
    field('nc', 'reporter_email', 'Reporter email', 'email', { personalData: true }),
    field(
      'nc',
      'supplier_fee',
      'Supplier fee',
      'number',
      {},
      { hidden: true, restrictedTo: { userIds: [], roles: ['admin'] } },
    ),
    field(
      'nc',
      'incident',
      'Incident',
      'link',
      { targetSheetId: 'incidents', multiple: false, inverseFieldId: 'incidents.nonconformity' },
      { pack: core('nc.incident') },
    ),
    field(
      'nc',
      'actions',
      'Actions',
      'link',
      { targetSheetId: 'actions', multiple: true, inverseFieldId: null },
      { pack: core('nc.actions') },
    ),
    field('nc', 'secret_link', 'Secret audit', 'link', {
      targetSheetId: 'unreadable',
      multiple: true,
      inverseFieldId: null,
    }),
    field(
      'incidents',
      'nonconformity',
      'Nonconformity',
      'link',
      { targetSheetId: 'nc', multiple: false, inverseFieldId: 'nc.incident' },
      { pack: core('incidents.nonconformity') },
    ),
    field('incidents', 'raise_capa', 'Raise CAPA', 'button', {
      label: 'Raise CAPA',
      confirm: null,
    }),
    field('risks', 'nc', 'Nonconformities', 'link', {
      targetSheetId: 'nc',
      multiple: true,
      inverseFieldId: null,
    }),
    field('actions', 'status', 'Status', 'status', STAGES),
  ];
  const forms: FlowForm[] = [
    form(
      'f-report',
      'Report a nonconformity',
      {
        status: 'open',
        access: 'internal',
        fields: [{ key: 'details' }, { key: 'grade' }],
      },
      { pack: core('nc.form.report'), responses: 12, lastAt: '2026-11-03T09:15:00Z' },
    ),
    form(
      'f-intake',
      'New nonconformity',
      {
        status: 'open',
        access: 'internal',
        intake: true,
        fields: [{ key: 'details' }, { key: 'grade', step: 'How serious' }],
      },
      { pack: core('nc.form.intake') },
    ),
    form('f-public', 'Supplier complaint', {
      status: 'open',
      access: 'public',
      fields: [{ key: 'details' }, { key: 'supplier_fee', label: 'Supplier fee charged' }],
    }),
  ];
  const automations: FlowAutomation[] = [
    auto(
      'a-overdue',
      'nc',
      'Nonconformity overdue → tell the owner',
      { type: 'date_arrives', fieldKey: 'due_date', offsetDays: 1 },
      [{ type: 'notify', to: ['field:owner'], message: '{id} is overdue' }],
      {
        pack: core('nc_overdue'),
        lastRunAt: '2026-11-10T08:00:00Z',
        createdAt: '2026-11-01T00:00:00Z',
      },
    ),
    auto(
      'a-raise',
      'incidents',
      'Raise CAPA',
      { type: 'button_clicked', fieldKey: 'raise_capa' },
      [{ type: 'create_item', sheetId: 'nc', groupId: null, name: 'CAPA: {name}', link: true }],
      { pack: core('raise_capa') },
    ),
    auto(
      'a-slack',
      'nc',
      'Major → Slack',
      { type: 'field_becomes', fieldKey: 'grade', value: 'opt_major' },
      [
        {
          type: 'webhook',
          url: 'https://hooks.slack.com/services/T00/B00/SECRETTOKEN',
          preset: 'slack',
        },
      ],
      { mode: 'test', createdAt: '2026-11-02T00:00:00Z' },
    ),
    auto(
      'a-action',
      'nc',
      'Add an action',
      { type: 'item_created' },
      [{ type: 'create_item', sheetId: 'actions', groupId: null, name: 'Fix {name}', link: true }],
      { enabled: false, createdAt: '2026-11-03T00:00:00Z' },
    ),
    auto(
      'a-fee',
      'nc',
      'When Supplier fee changes → notify Owner',
      { type: 'field_changed', fieldKey: 'supplier_fee' },
      [{ type: 'notify', to: ['field:owner'], message: 'Fee changed' }],
      { createdAt: '2026-11-04T00:00:00Z' },
    ),
    auto(
      'a-update',
      'actions',
      'Close the nonconformity',
      { type: 'field_becomes', fieldKey: 'status', value: 'opt_done' },
      [
        {
          type: 'update_linked',
          path: { direction: 'in', sheetId: 'nc', linkFieldKey: 'actions' },
          fieldKey: 'stage',
          value: 'opt_done',
        },
      ],
    ),
  ];
  return {
    folders: [
      { id: 'fo-ms', name: 'Management system', domain: 'Management system', position: 'a0' },
      { id: 'fo-ops', name: 'Operations', domain: 'Operations', position: 'a1' },
    ],
    sheets,
    fields,
    forms,
    automations,
    packs: [{ installId: 'i-core', key: 'core', title: 'Core registers', version: '1.3.0' }],
    apps: [{ key: 'capa', title: 'CAPA', sheetIds: ['nc', 'actions'] }],
    people,
    teams: [],
    jobRoles: [],
    health: {
      available: true,
      automations: {
        'a-slack': { failed: 0, partial: 0, lastFailedAt: null, deadLetters: 2, retrying: 1 },
        'a-raise': {
          failed: 1,
          partial: 0,
          lastFailedAt: '2026-11-09T10:00:00Z',
          deadLetters: 0,
          retrying: 0,
        },
      },
    },
    drift: {
      'automation:a-overdue': 'unchanged',
      'automation:a-raise': 'changed',
      'form:f-report': 'unchanged',
      'form:f-intake': 'changed',
      'field:nc.incident': 'unchanged',
      'workflow:nc:capa-closure': 'unchanged',
    },
  };
}

const flowOf = (w = world()) => deriveSheetFlow(w, 'nc', viewer)!;
const byId = (id: string) => flowSteps(flowOf()).find((s) => s.id === id)!;

describe('deriveSheetFlow', () => {
  it('groups steps in the order data moves, numbered 01 to 04', () => {
    const flow = flowOf();
    expect(flow.groups.map((g) => `${g.number} ${g.title}`)).toEqual([
      '01 Inputs',
      '02 Sheet',
      '03 Logic',
      '04 Outputs',
    ]);
  });

  it('lists every kind of input: manual entry, forms, a button on another sheet, an incoming link, the API later', () => {
    const inputs = flowOf().groups[0]!.steps;
    expect(inputs.map((s) => s.kind)).toEqual([
      'manual',
      'form',
      'form',
      'form',
      'button_in',
      'link_in',
      'api',
    ]);
    expect(inputs[0]).toMatchObject({
      name: 'Manual entry',
      subline:
        'New item dialog asks the form “New nonconformity” in 2 steps · editors of this sheet',
      edit: { editor: 'new_item', id: 'nc', sheetId: 'nc' },
    });
    expect(byId('form:f-report')).toMatchObject({
      subline: 'Internal form · editors of the workspace',
      health: { tone: 'ok', words: 'Open · 12 answers, last 3 Nov 2026, 10:15' },
    });
    expect(byId('form:f-intake').subline).toBe(
      'Internal form · editors of the workspace · asked by + New',
    );
    expect(byId('button_in:a-raise:0')).toMatchObject({
      name: 'Incidents',
      subline: 'Sheet · Raise CAPA button (Raise CAPA)',
      edit: { editor: 'automation', id: 'a-raise', sheetId: 'incidents' },
      other: { sheetId: 'incidents', name: 'Incidents' },
    });
    // the Incidents side of the two-way Incident link is a relation of this sheet, not another input
    expect(byId('link_in:risks.nc')).toMatchObject({
      name: 'Risk register',
      subline: 'Sheet · links here through Nonconformities',
      edit: { editor: 'field', id: 'risks.nc', sheetId: 'risks' },
    });
    expect(inputs.some((s) => s.id === 'link_in:incidents.nonconformity')).toBe(false);
    expect(byId('api:nc')).toMatchObject({ comingLater: true, edit: null, name: 'API / webhook' });
  });

  it('says a public form lacks a required field and an unreviewed notice, in words', () => {
    const s = byId('form:f-public');
    expect(s.subline).toBe('Public form · anyone with the link');
    expect(s.health).toMatchObject({
      tone: 'warn',
      words: '1 required field not on the form',
    });
    expect(s.health!.problems).toContain('Privacy notice not reviewed: the form takes no answers');
    expect(s.health!.problems).toContain('Required and not on the form: Grade');
  });

  it('counts the sheet’s columns and relations', () => {
    const s = flowOf().groups[1]!.steps[0]!;
    expect(s).toMatchObject({
      kind: 'sheet',
      name: 'Nonconformities and CAPA',
      subline: '10 columns · 4 relations',
      pack: { state: 'from', words: 'From Core registers' },
      edit: { editor: 'sheet', id: 'nc' },
    });
  });

  it('lists the logic: automations, approval workflows and the lifecycle field', () => {
    const logic = flowOf().groups[2]!.steps;
    expect(logic.map((s) => s.kind)).toEqual([
      'automation',
      'automation',
      'automation',
      'automation',
      'approval',
      'approval',
      'lifecycle',
    ]);
    expect(byId('automation:a-overdue')).toMatchObject({
      subline: 'When Due date is 1 day past',
      health: { tone: 'ok', words: 'Last run 10 Nov 2026, 09:00' },
      pack: { state: 'unchanged', words: 'From Core registers · unchanged' },
    });
    expect(byId('approval:nc:capa-closure')).toMatchObject({
      subline: 'Approval workflow · 1 step',
      pack: { state: 'unchanged' },
      health: { tone: 'ok', words: 'On' },
    });
    expect(byId('approval:nc:local-sign-off')).toMatchObject({
      pack: { state: 'added', words: 'Added here' },
      health: { tone: 'off', words: 'Off' },
    });
    expect(byId('lifecycle:nc.stage')).toMatchObject({
      name: 'Stage lifecycle',
      subline: 'Workflow · 2 stages',
      edit: { editor: 'lifecycle', id: 'nc.stage' },
    });
  });

  it('puts health problems first: dead letters, failures, paused, test mode, not run yet', () => {
    expect(byId('automation:a-slack').health).toEqual({
      tone: 'crit',
      words: 'Dead letter: 2 webhooks failed',
      problems: ['Dead letter: 2 webhooks failed', '1 webhook waiting to retry', 'In test mode'],
    });
    expect(byId('automation:a-action').health).toMatchObject({ tone: 'off', words: 'Paused' });
    expect(byId('automation:a-fee').health).toMatchObject({ tone: 'idle', words: 'Not run yet' });
    expect(byId('button_in:a-raise:0').health).toMatchObject({
      tone: 'crit',
      words: '1 run failed in 30 days',
    });
  });

  it('lists every kind of output: links, items created, notifications and a webhook that leaves the system', () => {
    const outputs = flowOf().groups[3]!.steps;
    expect(outputs.map((s) => s.kind)).toEqual([
      'link_out',
      'link_out',
      'link_out',
      'notify',
      'webhook',
      'create_out',
      'notify',
    ]);
    expect(byId('link_out:nc.incident')).toMatchObject({
      name: 'Incidents',
      subline: 'Link · Incident, both ways',
      pack: { state: 'unchanged' },
    });
    expect(byId('link_out:nc.secret_link')).toMatchObject({
      name: UNREADABLE_SHEET,
      other: { sheetId: null },
      pack: { state: 'added' },
    });
    expect(byId('create_out:a-action:0')).toMatchObject({
      name: 'Actions',
      subline: 'Creates items · Add an action',
      pack: { state: 'added', words: 'Added here' },
    });
    expect(byId('notify:a-overdue:0').subline).toBe(
      'Notify Owner · Nonconformity overdue → tell the owner',
    );
    const hook = byId('webhook:a-slack:0');
    expect(hook).toMatchObject({
      name: 'Slack',
      subline: 'Leaves the system · hooks.slack.com/… · Major → Slack',
    });
    expect(hook.leaves).toMatchObject({
      destination: 'slack',
      host: 'hooks.slack.com/…',
      personal: 1,
    });
    expect(hook.leaves!.fields).toContainEqual({
      name: 'Reporter email',
      personal: true,
      restricted: false,
    });
  });

  it('shows the update on another sheet as an output there and as nothing here', () => {
    const actions = deriveSheetFlow(world(), 'actions', viewer)!;
    expect(flowSteps(actions).find((s) => s.kind === 'update_out')).toMatchObject({
      name: 'Nonconformities and CAPA',
      subline: 'Updates linked items · Close the nonconformity',
    });
  });

  it('never reveals a restricted field’s name, nor a webhook’s full address', () => {
    const flow = flowOf();
    const json = JSON.stringify(flow);
    expect(json).not.toContain('Supplier fee');
    expect(json).not.toContain('SECRETTOKEN');
    expect(json).not.toContain('services/T00');
    expect(byId('automation:a-fee')).toMatchObject({
      name: `When ${RESTRICTED_FIELD} changes → notify Owner`,
      subline: `When ${RESTRICTED_FIELD} changes`,
    });
    expect(byId('webhook:a-slack:0').leaves!.fields).toContainEqual({
      name: RESTRICTED_FIELD,
      personal: false,
      restricted: true,
    });
    // a viewer who may see the field sees its name
    const w = world();
    const open = {
      ...w,
      fields: w.fields.map((f) => (f.key === 'supplier_fee' ? { ...f, hidden: false } : f)),
    };
    expect(JSON.stringify(deriveSheetFlow(open, 'nc', viewer))).toContain('Supplier fee');
  });

  it('is null for a sheet the person cannot read', () => {
    expect(deriveSheetFlow(world(), 'unreadable', viewer)).toBeNull();
  });

  it('marks a flow that differs from its pack', () => {
    expect(flowOf().differs).toBe(true);
    const w = world();
    const plain = deriveSheetFlow(w, 'risks', viewer)!;
    expect(plain.differs).toBe(false);
    expect(flowSteps(plain).every((s) => s.pack === null || s.kind === 'link_in')).toBe(true);
  });

  it('falls back to the standard dialog when the chosen form is gone', () => {
    const w = world();
    w.sheets[0] = { ...w.sheets[0]!, newItemForm: 'f-gone' };
    expect(flowSteps(deriveSheetFlow(w, 'nc', viewer)!)[0]!.health).toMatchObject({
      tone: 'warn',
      words: 'The chosen form no longer exists: the standard dialog asks',
    });
  });
});

describe('workspaceGraph', () => {
  const graph = workspaceGraph(world(), viewer);

  it('has a node per readable sheet with counts, pack, apps and outside destinations', () => {
    expect(graph.nodes.map((n) => n.id)).toEqual(['nc', 'incidents', 'actions', 'risks']);
    expect(graph.nodes[0]).toMatchObject({
      name: 'Nonconformities and CAPA',
      packKeys: ['core'],
      packTitle: 'Core registers',
      inputs: 6,
      logic: 7,
      outputs: 7,
      outside: [{ destination: 'slack', label: 'Slack', count: 1 }],
      differs: true,
      tone: 'crit',
      apps: ['capa'],
    });
  });

  it('draws one line per two-way link, and lines for buttons, created and updated items', () => {
    expect(graph.edges.map((e) => [e.kind, e.from, e.to, e.via, !!e.twoWay])).toEqual([
      ['link', 'nc', 'incidents', 'Incident', true],
      ['link', 'nc', 'actions', 'Actions', false],
      ['link', 'risks', 'nc', 'Nonconformities', false],
      ['button', 'incidents', 'nc', 'Raise CAPA', false],
      ['create', 'nc', 'actions', 'Add an action', false],
      ['update', 'actions', 'nc', 'Close the nonconformity', false],
    ]);
    // a sheet the person cannot open has no line and no name
    expect(JSON.stringify(graph)).not.toContain('unreadable');
  });

  it('filters by app, pack, folder, domain and "differs from pack", keeping neighbours as context', () => {
    const w = world();
    const app = filterGraph(graph, { app: 'capa' }, w);
    expect(app.nodes.map((n) => [n.id, !!n.context])).toEqual([
      ['nc', false],
      ['incidents', true],
      ['actions', false],
      ['risks', true],
    ]);
    expect(
      filterGraph(graph, { pack: 'core' }, w)
        .nodes.filter((n) => !n.context)
        .map((n) => n.id),
    ).toEqual(['nc', 'incidents', 'actions']);
    expect(
      filterGraph(graph, { group: 'none' }, w)
        .nodes.filter((n) => !n.context)
        .map((n) => n.id),
    ).toEqual(['risks']);
    expect(
      filterGraph(graph, { domain: 'Management system' }, w)
        .nodes.filter((n) => !n.context)
        .map((n) => n.id),
    ).toEqual(['nc']);
    // the button on Incidents and the Status field of Actions were added here, on pack sheets
    expect(
      filterGraph(graph, { differs: true }, w)
        .nodes.filter((n) => !n.context)
        .map((n) => n.id),
    ).toEqual(['nc', 'incidents', 'actions']);
    expect(filterGraph(graph, {}, w)).toBe(graph);
  });

  it('gives the Connections table the same content in words', () => {
    const rows = connectionRows(graph);
    expect(rows[0]).toMatchObject({
      from: { name: 'Actions' },
      to: { name: 'Nonconformities and CAPA' },
      kindWords: 'Updates linked items',
      via: 'Close the nonconformity',
    });
    expect(rows.find((r) => r.kind === 'link' && r.via === 'Incident')!.kindWords).toBe(
      'Link field, both ways',
    );
    expect(rows).toHaveLength(graph.edges.length);
  });

  it('offers only the filter choices that exist', () => {
    expect(filterChoices(world(), graph)).toEqual({
      apps: [{ key: 'capa', title: 'CAPA' }],
      packs: [{ key: 'core', title: 'Core registers' }],
      groups: [
        { id: 'fo-ms', name: 'Management system' },
        { id: 'fo-ops', name: 'Operations' },
        { id: 'none', name: 'No folder' },
      ],
      domains: ['Management system', 'Operations'],
    });
  });
});

describe('leaves the system', () => {
  it('lists every outside destination with the fields sent and personal-data flags, masked', () => {
    const rows = leavesRows(world(), viewer);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sheetName: 'Nonconformities and CAPA',
      automationName: 'Major → Slack',
      destination: 'slack',
      host: 'hooks.slack.com/…',
      mode: 'test',
      personal: 1,
    });
    expect(JSON.stringify(rows)).not.toMatch(/SECRETTOKEN|Supplier fee/);
    expect(leavesRows(world(), viewer, ['actions'])).toEqual([]);
  });

  it('masks addresses to their host', () => {
    expect(maskUrl('https://example.org/hook?key=abc')).toBe('example.org/…');
    expect(maskUrl('')).toBe('No address yet');
    expect(maskUrl('not a url')).toBe('An address that is not valid');
    expect(maskUrl(undefined)).toBe('No address yet');
  });
});

describe('masking', () => {
  it('replaces a hidden field’s name in names and labels, once', () => {
    const w = world();
    const m = maskWorld(w);
    expect(maskWorld(m)).toBe(m);
    expect(maskWorld(w)).toBe(m);
    expect(m.fields.find((f) => f.key === 'supplier_fee')!.name).toBe(RESTRICTED_FIELD);
    expect(m.forms.find((f) => f.id === 'f-public')!.layout.fields[1]!.label).toBe(
      RESTRICTED_FIELD,
    );
    expect(JSON.stringify(m)).not.toContain('Supplier fee');
  });

  it('scrubs whole words only', () => {
    expect(scrub('When Fee changes, Feedback', ['Fee'])).toBe(
      `When ${RESTRICTED_FIELD} changes, Feedback`,
    );
  });
});

describe('layout', () => {
  it('lays the workspace out in columns by folder, domain folders first, "No folder" last', () => {
    const w = world();
    const g = workspaceGraph(w, viewer);
    const l = layoutWorkspace(g.nodes, g.edges, w.folders);
    expect(l.columns.map((c) => c.title)).toEqual(['Management system', 'Operations', 'No folder']);
    expect(l.boxes).toHaveLength(4);
    expect(l.paths).toHaveLength(g.edges.length);
    expect(l.width).toBeGreaterThan(3 * 232);
    for (const p of l.paths) expect(p.d).toMatch(/^M [\d.]+ [\d.]+ C /);
  });

  it('lays a sheet out as a hub: inputs left, outputs right, relations above, logic below', () => {
    const flow = flowOf();
    const l = layoutSheetMap(flow);
    const side = (id: string) => l.nodes.find((n) => n.id === id)!.side;
    expect(side('form:f-report')).toBe('left');
    expect(side('link_in:risks.nc')).toBe('top');
    expect(side('link_out:nc.incident')).toBe('top');
    expect(side('automation:a-overdue')).toBe('bottom');
    expect(side('webhook:a-slack:0')).toBe('right');
    expect(l.nodes.some((n) => n.step.comingLater || n.step.kind === 'sheet')).toBe(false);
    expect(sideOf(flowSteps(flow).find((s) => s.kind === 'api')!)).toBeNull();
    const left = l.nodes.filter((n) => n.side === 'left');
    expect(Math.max(...left.map((n) => n.x + n.w))).toBeLessThan(l.hub.x);
    expect(l.paths).toHaveLength(l.nodes.length);
  });
});

describe('packDrift', () => {
  const base = {
    installId: 'i-core',
    automations: new Map<string, Record<string, Json>>([
      [
        'nc_overdue',
        { name: 'Overdue', trigger: { type: 'item_created' }, conditions: [], actions: [] },
      ],
    ]),
    views: new Map<string, Record<string, Json>>([
      ['nc.form.report', { name: 'Report', config: { form: { fields: [{ key: 'details' }] } } }],
    ]),
    fields: new Map<string, Record<string, Json>>([
      [
        'nc.grade',
        {
          name: 'Grade',
          description: null,
          required: true,
          locked: false,
          config: { options: [] },
        },
      ],
    ]),
    sheets: new Map<string, Record<string, Json>>([
      ['nc', { settings: { workflows: [{ id: 'capa-closure', name: 'CAPA closure' }] } }],
    ]),
    extensionWorkflows: [{ sheetId: 'nc', workflow: { id: 'iso27001_review', name: 'Review' } }],
  };

  it('says unchanged or changed per row, comparing what the upgrade compares', () => {
    const d = packDrift(base, {
      automations: [
        {
          id: 'a1',
          pack: core('nc_overdue'),
          name: 'Overdue',
          trigger: { type: 'item_created' },
          conditions: [],
          actions: [],
        },
        // another install's row is not compared with this one
        {
          id: 'a2',
          pack: { installId: 'i-other', ref: 'nc_overdue' },
          name: 'x',
          trigger: {},
          conditions: [],
          actions: [],
        },
      ],
      forms: [
        {
          id: 'v1',
          pack: core('nc.form.report'),
          name: 'Report',
          config: { form: { fields: [] } },
        },
      ],
      fields: [
        {
          id: 'fd1',
          pack: core('nc.grade'),
          name: 'Grade',
          description: null,
          required: true,
          locked: false,
          // a setting the pack does not ship is the workspace's own and does not count
          config: { options: [], askWhenAdding: true },
        },
      ],
      sheets: [
        {
          id: 'nc',
          pack: core('nc'),
          workflows: [
            { id: 'capa-closure', name: 'CAPA closure' },
            { id: 'iso27001_review', name: 'Renamed review' },
            { id: 'mine', name: 'Mine' },
          ],
        },
      ],
    });
    expect(d).toEqual({
      'automation:a1': 'unchanged',
      'form:v1': 'changed',
      'field:fd1': 'unchanged',
      'workflow:nc:capa-closure': 'unchanged',
      'workflow:nc:iso27001_review': 'changed',
    });
  });
});

describe('the world that leaves the server', () => {
  it('carries a webhook’s host only, and still derives the same destination', () => {
    const m = maskWorld(world());
    const json = JSON.stringify(m);
    expect(json).not.toContain('SECRETTOKEN');
    expect(json).toContain('hooks.slack.com/…');
    expect(maskUrl('hooks.slack.com/…')).toBe('hooks.slack.com/…');
    expect(leavesRows(m, viewer)[0]!.host).toBe('hooks.slack.com/…');
  });
});
