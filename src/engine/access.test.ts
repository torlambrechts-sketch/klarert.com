import { beforeAll, describe, expect, it } from 'vitest';
import {
  auditorBanner,
  canComment,
  canEdit,
  canRead,
  canSeeRestricted,
  effectiveRestriction,
  endDateOk,
  endOfDayIn,
  isMaskedValue,
  modeOf,
  parseRestriction,
  resolveLevel,
  whoCanSee,
} from './access';
import { accessText, activityText } from './activity';
import { renderTemplate, restrictedInMessages } from './automations/template';
import { genericPayload } from './automations/webhook';
import { computeWidget } from './insights/registry';
import { FIELD_TYPES } from './fields/registry';
import { installFieldTypes } from './fields/resolve';
import { sheetCtx, type SheetData } from './sheet-data';
import { summarise } from './summaries';
import { makeCtx, makeField, makeItem } from './testing/fixtures';
import type { Ctx, Field } from './types';
import { hiddenFor, visibleTextOf } from './values';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

describe('sheet access (docs/02 §16)', () => {
  it('owners always have access, whatever the restriction', () => {
    expect(resolveLevel({ role: 'owner', restricted: true, grant: null })).toBe('owner');
    expect(resolveLevel({ role: 'owner', restricted: false, grant: null })).toBe('owner');
  });

  it('an open sheet follows the workspace role (viewers and auditors read only)', () => {
    expect(resolveLevel({ role: 'admin', restricted: false, grant: null })).toBe('editor');
    expect(resolveLevel({ role: 'editor', restricted: false, grant: null })).toBe('editor');
    expect(resolveLevel({ role: 'viewer', restricted: false, grant: null })).toBe('viewer');
    expect(resolveLevel({ role: 'auditor', restricted: false, grant: null })).toBe('viewer');
  });

  it('a restricted sheet needs a grant, capped by the role; admins are not let in by their role', () => {
    expect(resolveLevel({ role: 'admin', restricted: true, grant: null })).toBe('none');
    expect(resolveLevel({ role: 'admin', restricted: true, grant: 'editor' })).toBe('editor');
    expect(resolveLevel({ role: 'editor', restricted: true, grant: 'commenter' })).toBe(
      'commenter',
    );
    expect(resolveLevel({ role: 'viewer', restricted: true, grant: 'editor' })).toBe('viewer');
    expect(resolveLevel({ role: 'auditor', restricted: true, grant: 'editor' })).toBe('viewer');
    expect(resolveLevel({ role: null, restricted: false, grant: null })).toBe('none');
  });

  it('a sheet inherits its folder unless it has its own setting, which replaces the folder', () => {
    expect(
      effectiveRestriction({ inherit: true, restricted: false, folderRestricted: true }),
    ).toEqual({
      restricted: true,
      source: 'folder',
    });
    expect(
      effectiveRestriction({ inherit: false, restricted: false, folderRestricted: true }),
    ).toEqual({
      restricted: false,
      source: 'sheet',
    });
    expect(
      effectiveRestriction({ inherit: false, restricted: true, folderRestricted: false }),
    ).toEqual({
      restricted: true,
      source: 'sheet',
    });
    expect(modeOf(true, true)).toBe('inherit');
    expect(modeOf(false, true)).toBe('restricted');
    expect(modeOf(false, false)).toBe('open');
  });

  it('levels order read < comment < edit', () => {
    expect([canRead('viewer'), canComment('viewer'), canEdit('viewer')]).toEqual([
      true,
      false,
      false,
    ]);
    expect([canComment('commenter'), canEdit('commenter')]).toEqual([true, false]);
    expect([canEdit('editor'), canEdit('owner'), canRead('none')]).toEqual([true, true, false]);
  });

  it('says who can see a sheet', () => {
    expect(whoCanSee({ restricted: false, listed: 0, owners: 1, source: 'sheet' })).toBe(
      'Everyone in the workspace, by their workspace role.',
    );
    expect(
      whoCanSee({ restricted: true, listed: 3, owners: 1, source: 'folder', folderName: 'HR' }),
    ).toBe('Only the 3 people listed on HR, and the workspace owners.');
  });
});

describe('auditors', () => {
  it('end at the end of the chosen day in the workspace time zone', () => {
    expect(endOfDayIn('2026-12-31', 'Europe/London')).toBe('2026-12-31T23:59:59.999Z');
    expect(endOfDayIn('2026-07-01', 'Europe/London')).toBe('2026-07-01T22:59:59.999Z');
    expect(endOfDayIn('2026-12-31', 'Europe/Oslo')).toBe('2026-12-31T22:59:59.999Z');
  });

  it('need a day from today on', () => {
    expect(endDateOk('2026-11-13', '2026-11-13')).toBe(true);
    expect(endDateOk('2026-11-12', '2026-11-13')).toBe(false);
    expect(endDateOk('31/12/2026', '2026-11-13')).toBe(false);
  });

  it('see a read-only banner with the end date', () => {
    expect(auditorBanner('2026-12-31T23:59:59.999Z', 'Europe/London')).toBe(
      'Read-only auditor access until 31 Dec 2026',
    );
  });
});

describe('restricted fields', () => {
  it('are read leniently', () => {
    expect(parseRestriction(null)).toBeNull();
    expect(parseRestriction({ userIds: ['u1', 3], roles: ['admin', 'boss'] })).toEqual({
      userIds: ['u1'],
      roles: ['admin'],
    });
  });

  it('are seen by owners, the people listed and the roles listed', () => {
    const r = { userIds: ['u-eve'], roles: ['auditor' as const] };
    expect(canSeeRestricted(r, { userId: 'u-x', role: 'owner' })).toBe(true);
    expect(canSeeRestricted(r, { userId: 'u-eve', role: 'editor' })).toBe(true);
    expect(canSeeRestricted(r, { userId: 'u-aud', role: 'auditor' })).toBe(true);
    expect(canSeeRestricted(r, { userId: 'u-adm', role: 'admin' })).toBe(false);
    expect(canSeeRestricted(null, { userId: 'u-adm', role: 'viewer' })).toBe(true);
  });

  const salary = makeField(
    'number',
    { decimals: 0 },
    {
      key: 'salary',
      name: 'Salary',
      restrictedTo: { userIds: ['u-eve'], roles: [] },
      hidden: true,
    },
  ) as Field;
  const grade = makeField('text', {}, { key: 'grade', name: 'Grade' }) as Field;
  const bonus = makeField(
    'formula',
    { expr: '{salary} * 0.1', result: 'number' },
    { key: 'bonus', name: 'Bonus' },
  ) as Field;
  const nested = makeField(
    'formula',
    { expr: '{bonus} + 1', result: 'number' },
    { key: 'nested', name: 'Nested' },
  ) as Field;
  const plain = makeField('formula', { expr: 'LEN({grade})', result: 'number' }, { key: 'plain' });
  // what the database sends a person who may not see Salary: no value, and the field marked hidden
  const item = makeItem({ [grade.id]: 'B' }, { id: 'i-1', name: 'Sam' });
  const ctx = makeCtx(
    { fields: [salary, grade, bonus, nested, plain as Field], items: [item] },
    { canSee: (f) => !f.hidden },
  );

  it('say "Restricted" for the field and for formulas reading it, however deep', () => {
    expect(hiddenFor(salary, ctx)).toBe(true);
    expect(hiddenFor(bonus, ctx)).toBe(true);
    expect(hiddenFor(nested, ctx)).toBe(true);
    expect(hiddenFor(plain as Field, ctx)).toBe(false);
    expect(hiddenFor(grade, ctx)).toBe(false);
    expect(visibleTextOf(item, salary, ctx)).toBe('Restricted');
    expect(visibleTextOf(item, grade, ctx)).toBe('B');
  });

  it('give no summary made from values that never arrived', () => {
    expect(summarise(salary, [item], ctx, 'sum').text).toBe('Restricted');
    expect(summarise(grade, [item], ctx, 'count_filled').text).toBe('1 of 1 filled');
  });

  it('leave Insights widgets that read them saying Restricted', () => {
    const source = {
      sheet: ctx.sheet,
      fields: [salary, grade],
      items: [item],
      allItems: [item],
      ctx,
      current: true,
    };
    const w = {
      id: 'w',
      type: 'kpi' as const,
      span: 3 as const,
      filter: 'all' as const,
      agg: 'sum' as const,
      num: 'salary',
    };
    expect(computeWidget(w, { current: source, sheet: () => null })).toEqual({
      kind: 'message',
      message: 'Restricted: this widget reads a field you cannot see.',
    });
    expect(
      computeWidget(
        { ...w, src: '00000000-0000-4000-8000-000000000001' },
        {
          current: source,
          sheet: () => null,
        },
      ),
    ).toEqual({ kind: 'unavailable' });
  });

  it('render "Restricted" in automation messages and webhooks for everyone, even when the runner sees the value', () => {
    const visible = makeField(
      'number',
      {},
      {
        key: 'pay',
        name: 'Pay',
        restrictedTo: { userIds: [], roles: ['admin'] },
      },
    ) as Field;
    const it2 = makeItem(
      { [visible.id]: 50000, [grade.id]: 'C' },
      { id: 'i-2', displayId: 'ST-002' },
    );
    const system = makeCtx({ fields: [visible, grade], items: [it2] });
    expect(restrictedInMessages(visible, system)).toBe(true);
    expect(restrictedInMessages(grade, system)).toBe(false);
    const env = {
      appUrl: 'https://x.test',
      workspace: 'w',
      actor: { kind: 'system' as const, id: null },
    };
    expect(renderTemplate('{id}: {pay} {grade}', it2, system, env)).toBe('ST-002: Restricted C');
    const payload = genericPayload(
      { id: 'a', name: 'A', trigger: { type: 'item_created' } },
      it2,
      system,
      { appUrl: 'https://x.test', workspace: 'w' },
    );
    expect((payload.item as { values: Record<string, string> }).values).toMatchObject({
      pay: 'Restricted',
      grade: 'C',
    });
  });
});

describe('lookups and roll-ups across a restricted link', () => {
  const target = 's-hr';
  const link = makeField(
    'link',
    { targetSheetId: target, multiple: true, inverseFieldId: null },
    {
      key: 'case',
    },
  ) as Field;
  const look = makeField(
    'lookup',
    { linkFieldKey: 'case', targetFieldKey: 'finding' },
    {
      key: 'case_finding',
    },
  ) as Field;
  const roll = makeField(
    'rollup',
    { linkFieldKey: 'case', targetFieldKey: null, fn: 'count' },
    { key: 'case_count' },
  ) as Field;
  const finding = makeField('text', {}, { key: 'finding', sheetId: target }) as Field;
  const secret = makeField(
    'text',
    {},
    {
      key: 'finding',
      sheetId: target,
      restrictedTo: { userIds: [], roles: [] },
      hidden: true,
    },
  ) as Field;

  it('read "Restricted" when the target sheet cannot be read', () => {
    const ctx = makeCtx({ fields: [link, look, roll] }, { noAccess: (id) => id === target });
    expect(hiddenFor(look, ctx)).toBe(true);
    expect(hiddenFor(roll, ctx)).toBe(true);
  });

  it('read "Restricted" when the target field is restricted for the caller', () => {
    const ctx = makeCtx(
      { fields: [link, look], otherFields: { [target]: [secret] } },
      { canSee: (f) => !f.hidden },
    );
    expect(hiddenFor(look, ctx)).toBe(true);
  });

  it('read normally otherwise', () => {
    const ctx = makeCtx(
      { fields: [link, look], otherFields: { [target]: [finding] } },
      { canSee: (f) => !f.hidden, noAccess: () => false },
    );
    expect(hiddenFor(look, ctx)).toBe(false);
  });
});

describe('the Ctx of a sheet', () => {
  it('takes the hidden marks and the sheets without access from the data', () => {
    const f = makeField(
      'text',
      {},
      { key: 'x', hidden: true, restrictedTo: { userIds: [], roles: [] } },
    ) as Field;
    const base = makeCtx();
    const data: SheetData = {
      sheet: base.sheet,
      fields: [f],
      groups: [],
      items: [],
      links: [],
      files: [],
      protectedValues: [],
      people: [],
      teams: [],
      jobRoles: [],
      entities: [],
      sites: [],
      related: { sheets: [], fields: [], items: [] },
      noAccessSheetIds: ['s-hidden'],
    };
    const ctx: Ctx = sheetCtx(data, {
      now: new Date('2026-11-13T10:00:00Z'),
      timeZone: 'Europe/London',
      userId: 'u-1',
      newId: (p) => p,
    });
    expect(ctx.canSee?.(f)).toBe(false);
    expect(ctx.noAccess?.('s-hidden')).toBe(true);
    expect(ctx.noAccess?.('s-other')).toBe(false);
  });
});

describe('the activity log', () => {
  const look = {
    personName: (id: string) => ({ 'u-eve': 'Eve In', 'u-ed': 'Ed Out' })[id],
  };

  it('shows a masked value as Restricted', () => {
    expect(isMaskedValue({ $restricted: 'abc' })).toBe(true);
    expect(isMaskedValue('41000')).toBe(false);
    const salary = makeField('number', {}, { name: 'Salary' }) as Field;
    const text = activityText(
      {
        id: 1,
        at: '2026-11-13T10:00:00Z',
        actorKind: 'user',
        actorId: 'u-eve',
        action: 'value.changed',
        fieldId: salary.id,
        oldValue: { $restricted: 'a' },
        newValue: { $restricted: 'b' },
        note: null,
        hash: 'h',
      },
      {
        ctx: makeCtx({ fields: [salary] }),
        field: () => salary,
        groupName: () => undefined,
        displayId: () => undefined,
        personName: () => undefined,
      },
    );
    expect(text).toBe('Salary: Restricted → Restricted');
  });

  it('words grants, revokes and restrictions', () => {
    const e = (action: string, o: unknown, n: unknown, note: string | null = null) =>
      accessText({ action, oldValue: o as never, newValue: n as never, note }, look);
    expect(e('access.changed', { mode: 'open' }, { mode: 'restricted' })).toBe(
      'Restricted the sheet to the people listed',
    );
    expect(e('access.granted', null, { user_id: 'u-eve', level: 'editor' })).toBe(
      'Eve In can edit',
    );
    expect(
      e(
        'access.level_changed',
        { user_id: 'u-eve', level: 'editor' },
        { user_id: 'u-eve', level: 'viewer' },
      ),
    ).toBe('Eve In: can edit → can view');
    expect(e('access.revoked', { user_id: 'u-ed', level: 'viewer' }, null)).toBe(
      'Ed Out no longer has access',
    );
    expect(
      e('folder.access.granted', null, { user_id: 'u-eve', level: 'viewer', folder_id: 'f' }),
    ).toBe('Eve In can view on the folder');
    expect(e('field.restricted', null, {}, 'Salary')).toBe('Restricted the field “Salary”');
    expect(e('restricted.accessed', null, null)).toBe(
      'Opened this restricted sheet as an owner who is not on the list',
    );
    expect(e('invite.created', null, { invite_id: 'i', role: 'editor' })).toBe(
      'Invited someone as an editor',
    );
    expect(e('invite.resent', null, { invite_id: 'i', role: 'viewer', resend: 2 })).toBe(
      'Sent an invite again (2 of 5)',
    );
    expect(e('invite.revoked', { invite_id: 'i', role: 'viewer' }, null)).toBe(
      'Revoked an invite to join as a viewer',
    );
    expect(e('member.removed', { user_id: 'u-ed', role: 'editor' }, null)).toBe('Removed a member');
    // delete my account (0071): the membership ends with the account
    expect(
      e('member.removed', { user_id: 'u-ed', role: 'editor' }, { how: 'account deleted' }),
    ).toBe('A member deleted their account');
    expect(e('item.renamed', null, null)).toBeNull();
  });
});
