import { describe, expect, it } from 'vitest';
import {
  captureManifest,
  isMajorStep,
  leftOutReport,
  privatePackKey,
  shortHash,
  stableRef,
  suggestVersion,
  versionProblem,
  type WorkspaceSnapshot,
} from './capture';
import type { PackManifest } from './types';

const ORG = '0f1e2d3c-0000-4000-8000-000000000000';

const empty = (over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot => ({
  org: { id: ORG, name: 'Practice' },
  installs: [],
  folders: [],
  sheets: [],
  fields: [],
  groups: [],
  views: [],
  automations: [],
  dashboards: [],
  jobRoles: [],
  teams: [],
  memberIds: [],
  ownFrameworks: [],
  ...over,
});

const sheet = (
  id: string,
  name: string,
  over: Partial<WorkspaceSnapshot['sheets'][number]> = {},
) => ({
  id,
  name,
  description: null,
  itemLabel: 'Item',
  idPrefix: 'ITM-',
  folderId: null,
  restricted: false,
  isLibrary: false,
  parentSheetId: null,
  packInstallId: null,
  packRef: null,
  settings: {},
  ...over,
});

const field = (id: string, sheetId: string, key: string, type = 'text', config = {}) => ({
  id,
  sheetId,
  key,
  name: key,
  type,
  description: null,
  required: false,
  locked: false,
  config,
  rules: [],
  visibility: null,
  restrictedTo: null,
  position: key,
  packInstallId: null,
});

const opts = {
  key: 'w0f1e2d3c-method',
  version: '1.0.0',
  title: 'Method',
  description: '',
  excluded: [],
};

describe('private pack keys and refs', () => {
  it('names a new pack with the workspace prefix and a short slug, never one taken', () => {
    expect(privatePackKey(ORG, 'Our ISO method for clients')).toBe('w0f1e2d3c-our-iso-method-f');
    expect(privatePackKey(ORG, '!!!')).toBe('w0f1e2d3c-setup');
    expect(privatePackKey(ORG, 'Method', ['w0f1e2d3c-method'])).toBe('w0f1e2d3c-method-2');
  });

  it('makes the same ref from the same row id, in every version', () => {
    expect(shortHash('abc')).toMatch(/^[0-9a-f]{10}$/);
    expect(stableRef('s', 'row-1')).toBe(stableRef('s', 'row-1'));
    expect(stableRef('s', 'row-1')).not.toBe(stableRef('s', 'row-2'));
  });
});

describe('captureManifest', () => {
  it('captures an own sheet, its sub-items and its sub-item automations; no items', () => {
    const snap = empty({
      sheets: [
        sheet('s1', 'Audits', {
          settings: {
            subitems: {
              label: 'Steps',
              blockClose: true,
              template: [{ name: 'Plan', values: { who: 'u1', note: 'x' } }],
            },
          },
        }),
        sheet('s1c', 'Audits · Steps', { parentSheetId: 's1' }),
      ],
      fields: [
        field('f1', 's1', 'title'),
        field('f2', 's1', 'steps', 'subitems'),
        field('c1', 's1c', 'note'),
        field('c2', 's1c', 'who', 'people'),
      ],
      groups: [
        {
          id: 'g1',
          sheetId: 's1',
          name: 'Open',
          color: 'blue',
          position: 'a0',
          packInstallId: null,
          packRef: null,
        },
      ],
      automations: [
        {
          id: 'a1',
          sheetId: 's1c',
          name: 'Step added',
          enabled: true,
          trigger: { type: 'item_created' },
          conditions: [],
          actions: [{ type: 'post_update', message: 'New step {note}.' }],
          packInstallId: null,
        },
      ],
      memberIds: ['u1'],
    });
    const { manifest } = captureManifest(snap, opts);
    const s = manifest.sheets[0]!;
    expect(s.fields.map((f) => f.key)).toEqual(['title']);
    expect(s.subitems).toMatchObject({
      label: 'Steps',
      blockClose: true,
      items: [{ name: 'Plan', values: { note: 'x' } }],
    });
    expect(s.subitems!.fields.map((f) => f.key)).toEqual(['note', 'who']);
    expect(manifest.automations).toEqual([
      expect.objectContaining({ sheet: s.ref, subitems: true, startInTestMode: true }),
    ]);
    expect(manifest.requires).toEqual([]);
  });

  it('leaves out a sheet made by a pack that is not ours, and a link to it', () => {
    const snap = empty({
      installs: [
        {
          id: 'i-other',
          packKey: 'w11111111-theirs',
          version: '1.0.0',
          title: 'Their pack',
          manifest: null,
        },
      ],
      sheets: [
        sheet('s1', 'Mine'),
        sheet('s2', 'Theirs', { packInstallId: 'i-other', packRef: 'x' }),
      ],
      fields: [
        field('f1', 's1', 'link', 'link', {
          targetSheetId: 's2',
          multiple: true,
          inverseFieldId: null,
        }),
      ],
      groups: [
        {
          id: 'g1',
          sheetId: 's1',
          name: 'Open',
          color: 'blue',
          position: 'a0',
          packInstallId: null,
          packRef: null,
        },
      ],
    });
    const { manifest, leftOut } = captureManifest(snap, opts);
    expect(manifest.sheets.map((s) => s.name)).toEqual(['Mine']);
    expect(manifest.sheets[0]!.fields).toEqual([]);
    expect(leftOut.map((e) => e.kind)).toEqual(['not_ours', 'not_ours', 'items']);
  });

  it('turns a job role or team id into its name, and drops outside email addresses', () => {
    const snap = empty({
      sheets: [sheet('s1', 'Mine')],
      groups: [
        {
          id: 'g1',
          sheetId: 's1',
          name: 'Open',
          color: 'blue',
          position: 'a0',
          packInstallId: null,
          packRef: null,
        },
      ],
      jobRoles: [{ id: 'r1', name: 'Auditor' }],
      teams: [{ id: 't1', name: 'Quality' }],
      automations: [
        {
          id: 'a1',
          sheetId: 's1',
          name: 'Tell',
          enabled: true,
          trigger: { type: 'item_created' },
          conditions: [],
          actions: [
            {
              type: 'notify',
              to: ['jobRole:r1', 'team:t1', 'someone@outside.test'],
              message: 'Hi',
            },
          ],
          packInstallId: null,
        },
      ],
    });
    const { manifest, leftOut } = captureManifest(snap, opts);
    expect(manifest.automations[0]!.actions[0]!.to).toEqual(['jobRole:Auditor', 'team:Quality']);
    expect(leftOut.some((e) => e.kind === 'email')).toBe(true);
  });
});

describe('the left-out report', () => {
  it('groups lines in a fixed order', () => {
    const r = leftOutReport([
      { kind: 'shipped', where: 'Risks', text: 'Renamed.' },
      { kind: 'webhook', where: 'A', text: 'Address.' },
    ]);
    expect(r.map((g) => g.heading)).toEqual(['Webhook addresses', 'Changes to what we shipped']);
    expect(r[0]!.lines).toEqual(['A: Address.']);
  });
});

describe('versions', () => {
  const m = {
    key: 'w0f1e2d3c-method',
    version: '1.0.0',
    title: 'M',
    description: '',
    requires: [],
    people: [],
    folders: [],
    sheets: [],
    automations: [],
    dashboards: [],
  } as PackManifest;
  it('starts at 1.0.0 and needs a higher version of the same line', () => {
    expect(suggestVersion(null, m)).toMatchObject({ version: '1.0.0', kind: 'first' });
    expect(versionProblem('1.2.0', '1.2.0')).toBe('Use a version higher than 1.2.0.');
    expect(versionProblem('1.2.0', 'x')).toBe('Use a version like 1.2.0.');
    expect(versionProblem(null, '1.0.0')).toBeNull();
    expect(isMajorStep('1.2.0', '2.0.0')).toBe(true);
    expect(isMajorStep('1.2.0', '1.3.0')).toBe(false);
  });
});
