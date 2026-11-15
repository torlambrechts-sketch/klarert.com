import { describe, expect, it } from 'vitest';
import {
  canSeeExports,
  exportRefs,
  exportRow,
  type ExportEntry,
  type ExportNames,
} from './exports';

// The Exports list (docs/11 Audit outputs, owner decision 15 Nov 2026): each `audit.exported` entry in words, with
// what was exported, who, when and the filters used.

const names: ExportNames = {
  person: (id) => (id === 'u-maria' ? 'Maria Pereira' : 'Former member'),
  folder: (id) => (id === 'f-isms' ? 'ISMS' : null),
  install: (id) => (id === 'i-core' ? 'Core registers' : null),
  pack: (key) => (key === 'core' ? 'Core registers' : null),
  app: (key) => (key === 'capa' ? 'CAPA' : null),
};

const entry = (
  newValue: ExportEntry['newValue'],
  more: Partial<ExportEntry> = {},
): ExportEntry => ({
  id: 41,
  at: '2026-11-15T09:42:00Z',
  actorKind: 'user',
  actorId: 'u-maria',
  newValue,
  ...more,
});

describe('exports list', () => {
  it('owners, admins and auditors see it; editors and viewers do not', () => {
    expect(['owner', 'admin', 'auditor', 'editor', 'viewer'].map(canSeeExports)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('an audit pack: the scope, the period, the files and what it covered', () => {
    const r = exportRow(
      entry({
        kind: 'audit_pack',
        scope: 'folder',
        folder_id: 'f-isms',
        from: '2025-11-16',
        to: '2026-11-15',
        sheets: 12,
        files: 4,
        files_included: 3,
        entries: 450,
        chains: 30,
        chains_ok: 29,
        chains_broken: 1,
      }),
      names,
      'Europe/London',
    );
    expect(r).toEqual({
      id: 41,
      kind: 'audit_pack',
      what: 'Audit pack',
      who: 'Maria Pereira',
      atIso: '2026-11-15T09:42:00Z',
      at: '15 Nov 2026, 09:42',
      filters: ['Folder: ISMS', 'Period 16 Nov 2025 to 15 Nov 2026', 'With 3 evidence files'],
      covered: '12 registers · 450 log entries · 30 chains checked, 29 ok, 1 broken',
    });
  });

  it('the whole workspace, or a pack install, or one that is gone', () => {
    const scope = (s: Record<string, string>) =>
      exportRow(entry({ kind: 'audit_pack', ...s }), names, 'UTC').filters[0];
    expect(scope({ scope: 'workspace' })).toBe('Whole workspace');
    expect(scope({ scope: 'install', install_id: 'i-core' })).toBe('Pack: Core registers');
    expect(scope({ scope: 'install', install_id: 'i-gone' })).toBe('Pack: a pack since archived');
    expect(scope({ scope: 'folder', folder_id: 'f-gone' })).toBe('Folder: a folder since removed');
  });

  it('the statement of applicability: print or CSV, the library and the view', () => {
    const r = exportRow(
      entry({
        kind: 'soa.csv',
        framework: 'iso-27001@2022',
        sheet_id: 's-1',
        sheet: 'ISO/IEC 27001:2022 requirements',
        scope: 'All requirements',
        items: 93,
      }),
      names,
      'UTC',
    );
    expect([r.what, r.filters, r.covered]).toEqual([
      'Statement of applicability (CSV)',
      ['ISO/IEC 27001:2022 requirements', 'All requirements'],
      '93 requirements',
    ]);
    expect(exportRow(entry({ kind: 'soa.print', items: 1 }), names, 'UTC').covered).toBe(
      '1 requirement',
    );
  });

  it('the data-flow record with its filters, by name where they are known', () => {
    const r = exportRow(
      entry({
        kind: 'data_flow_record',
        app: 'capa',
        pack: 'core',
        folder_id: 'none',
        domain: 'Quality',
        differs: true,
        sheets: 4,
        destinations: 1,
      }),
      names,
      'UTC',
    );
    expect(r.what).toBe('Data-flow record');
    expect(r.filters).toEqual([
      'App: CAPA',
      'Pack: Core registers',
      'Folder: No folder',
      'Registers domain: Quality',
      'Only sheets that differ from their pack',
    ]);
    expect(r.covered).toBe('4 sheets · 1 destination');
    const plain = exportRow(
      entry({ kind: 'data_flow_record', app: 'gone', differs: false, sheets: 1, destinations: 0 }),
      names,
      'UTC',
    );
    expect(plain.filters).toEqual(['App: gone']);
  });

  it('management review inputs: the period; no filters reads so', () => {
    expect(
      exportRow(
        entry({ kind: 'management_review', from: '2026-01-01', to: '2026-06-30' }),
        names,
        'UTC',
      ).filters,
    ).toEqual(['Period 1 Jan 2026 to 30 Jun 2026']);
    const item = exportRow(
      entry({ kind: 'management_review.item', from: '2026-01-01', to: '2026-06-30', item_id: 'x' }),
      names,
      'UTC',
    );
    expect(item.what).toBe('Management review inputs, added to a review');
    expect(item.filters).toEqual([
      'Period 1 Jan 2026 to 30 Jun 2026',
      'Added to a management review',
    ]);
    expect(exportRow(entry({ kind: 'data_flow_record' }), names, 'UTC').filters).toEqual([
      'No filters',
    ]);
  });

  it('a former member and an unknown kind still read', () => {
    const r = exportRow(entry({ kind: 'later.kind' }, { actorId: 'u-left' }), names, 'UTC');
    expect([r.what, r.who, r.covered]).toEqual(['later kind', 'Former member', null]);
    expect(exportRow(entry(null), names, 'UTC').what).toBe('unknown');
  });

  it('collects the folders, installs, packs and apps a page names', () => {
    expect(
      exportRefs([
        entry({ kind: 'audit_pack', scope: 'folder', folder_id: 'f-1' }),
        entry({ kind: 'audit_pack', scope: 'install', install_id: 'i-1' }),
        entry({ kind: 'data_flow_record', app: 'capa', pack: 'core', folder_id: 'none' }),
        entry({ kind: 'data_flow_record', folder_id: 'f-1' }),
      ]),
    ).toEqual({ folders: ['f-1'], installs: ['i-1'], packs: ['core'], apps: ['capa'] });
  });
});
