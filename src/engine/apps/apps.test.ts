import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { appRows } from './list';
import { appRoleOf, resolveApps, screenConditions, type AppInstall } from './resolve';
import type { AppManifest } from './types';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const app: AppManifest = {
  key: 'capa',
  title: 'CAPA',
  icon: 'wrench',
  sections: [
    {
      title: 'Work',
      screens: [
        {
          key: 'report',
          kind: 'form',
          title: 'Report a problem',
          sheet: 'capa',
          form: 'nonconformity',
          roles: ['owner', 'admin', 'member'],
        },
        {
          key: 'my-actions',
          kind: 'item',
          title: 'My actions',
          sheet: 'capa',
          subitems: true,
          filters: [{ fieldKey: 'owner', op: 'includes_any_of', value: ['{me}'] }],
        },
      ],
    },
    {
      title: 'Overview',
      screens: [
        { key: 'all', kind: 'view', title: 'All', sheet: 'capa', view: 'By status' },
        { key: 'overview', kind: 'dashboard', title: 'Overview', dashboard: 'capa_overview' },
        { key: 'risks', kind: 'view', title: 'Risks', sheet: 'risk' },
        { key: 'flow', kind: 'workflow', title: 'Workflow', sheet: 'capa', roles: ['owner'] },
      ],
    },
  ],
};

const install = (over: Partial<AppInstall> = {}): AppInstall => ({
  id: 'inst-1',
  packKey: 'start-capa',
  apps: [app],
  pack: { sheets: [{ ref: 'capa', views: [{ name: 'Open' }, { name: 'By status' }] }] },
  refMap: {
    'sheet:capa': 's-capa',
    'sheet:capa.subitems': 's-capa-sub',
    'view:capa.form.nonconformity': 'v-form',
    'view:capa.view.2': 'v-status',
    'dashboard:capa_overview': 'd-1',
  },
  ...over,
});

describe('resolveApps', () => {
  it('resolves every screen through the install ref map', () => {
    const [a] = resolveApps([install()], 'owner');
    expect(a!.installId).toBe('inst-1');
    expect(a!.sections.map((s) => s.screens.map((x) => x.key))).toEqual([
      ['report', 'my-actions'],
      ['all', 'overview', 'flow'],
    ]);
    const [report, mine] = a!.sections[0]!.screens;
    expect(report).toMatchObject({ kind: 'form', sheetId: 's-capa', viewId: 'v-form' });
    expect(mine).toMatchObject({
      kind: 'item',
      sheetId: 's-capa-sub',
      parentSheetId: 's-capa',
      subitems: true,
    });
    const [all, overview] = a!.sections[1]!.screens;
    expect(all).toMatchObject({ sheetId: 's-capa', viewId: 'v-status' });
    expect(overview).toMatchObject({ dashboardId: 'd-1' });
  });

  it('leaves out screens whose sheets the install lacks, and apps with nothing left', () => {
    const [a] = resolveApps([install()], 'owner');
    expect(a!.sections[1]!.screens.some((s) => s.key === 'risks')).toBe(false);
    expect(resolveApps([install({ refMap: {} })], 'owner')).toEqual([]);
  });

  it('shows apps and screens by role, never more', () => {
    expect(appRoleOf('editor')).toBe('member');
    expect(appRoleOf('viewer')).toBe('member');
    expect(appRoleOf('auditor')).toBe('auditor');
    const member = resolveApps([install()], 'editor')[0]!;
    expect(member.sections.flatMap((s) => s.screens.map((x) => x.key))).toEqual([
      'report',
      'my-actions',
      'all',
      'overview',
    ]);
    const auditor = resolveApps([install()], 'auditor')[0]!;
    expect(auditor.sections.flatMap((s) => s.screens.map((x) => x.key))).not.toContain('report');
    const adminsOnly = { ...app, roles: ['owner' as const, 'admin' as const] };
    expect(resolveApps([install({ apps: [adminsOnly] })], 'viewer')).toEqual([]);
  });

  it('the first install of an app key wins', () => {
    const two = resolveApps([install(), install({ id: 'inst-2' })], 'owner');
    expect(two.map((a) => a.installId)).toEqual(['inst-1']);
  });
});

describe('item screens', () => {
  const owner = makeField('people', { multiple: false }, { key: 'owner', position: 'a0' });
  const status = makeField('status', FIELD_TYPES.status.defaultConfig(), {
    key: 'status',
    position: 'a1',
  });
  const due = makeField('date', { relative: true }, { key: 'due_date', position: 'a2' });
  const fields = [owner, status, due];

  it('turns {me} into the reading person', () => {
    expect(
      screenConditions([
        { fieldKey: 'owner', op: 'includes_any_of', value: ['{me}', 'u-vic'] },
        { fieldKey: 'signoff', op: 'signed_by', value: '{me}' },
        { fieldKey: 'status', op: 'is_not_done' },
      ]),
    ).toEqual([
      { fieldKey: 'owner', op: 'includes_any_of', value: ['me', 'u-vic'] },
      { fieldKey: 'signoff', op: 'signed_by', value: 'me' },
      { fieldKey: 'status', op: 'is_not_done' },
    ]);
  });

  it('keeps my open items, soonest first, with the fields the screen shows', () => {
    const items = [
      makeItem({ [owner.id]: 'u-maria', [due.id]: '2026-12-01' }, { id: 'a', name: 'Later' }),
      makeItem({ [owner.id]: 'u-maria', [due.id]: '2026-11-01' }, { id: 'b', name: 'Late' }),
      makeItem({ [owner.id]: 'u-vic', [due.id]: '2026-11-02' }, { id: 'c', name: 'Not mine' }),
      makeItem(
        { [owner.id]: 'u-maria', [status.id]: 'opt_done', [due.id]: '2026-10-01' },
        { id: 'd', name: 'Done' },
      ),
      makeItem({ [owner.id]: 'u-maria' }, { id: 'e', name: 'No date' }),
    ];
    const ctx = makeCtx({ fields, items });
    const rows = appRows(items, ctx, {
      filters: [
        { fieldKey: 'owner', op: 'includes_any_of', value: ['{me}'] },
        { fieldKey: 'status', op: 'is_not_done' },
      ],
      sort: [{ fieldKey: 'due_date', direction: 'asc' }],
      show: ['due_date', 'gone'],
    });
    expect(rows.map((r) => r.name)).toEqual(['Late', 'Later', 'No date']);
    expect(rows[0]!.fields).toEqual([
      { key: 'due_date', name: due.name, text: '1 Nov 2026', overdue: true },
    ]);
    expect(rows[0]!.overdue).toBe(true);
    expect(rows[1]!.overdue).toBe(false);
  });
});
