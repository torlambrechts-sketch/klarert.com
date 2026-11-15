import { describe, expect, it } from 'vitest';
import { repoPacks } from '@/lib/packs/catalogue';
import type { PackManifest } from '@/engine/packs/types';
import { appStarts, rolesInWords, type AppStartInput } from '@/engine/create/apps';

// The App card's list (docs/05 §4 Create, docs/13): which apps a person can start, and the path to each.
const packs = repoPacks();
const cat = (key: string) => {
  const m = packs.find((p) => p.key === key)!;
  return { key: m.key, version: m.version, title: m.title, manifest: m as PackManifest };
};
const catalogue = [cat('start-capa'), cat('iso-27001'), cat('core'), cat('nis2')];
const base: AppStartInput = { catalogue, installs: [], resolved: [], role: 'owner' };
const byKey = (input: AppStartInput, key: string) => appStarts(input).find((a) => a.key === key)!;

describe('appStarts', () => {
  it('lists the catalogue’s apps once each, with the pack that brings them', () => {
    const list = appStarts(base);
    expect(list.map((a) => a.key)).toEqual(['capa', 'isms-capa']);
    const capa = list[0]!;
    expect(capa).toMatchObject({
      title: 'CAPA',
      packKey: 'start-capa',
      packTitle: 'Corrective action (CAPA)',
      state: 'new',
      installedVersion: null,
      forYou: true,
      uses: [],
    });
    expect(capa.sections.map((s) => s.title)).toEqual(['Work', 'Overview']);
    const report = capa.sections[0]!.screens[0]!;
    expect(report).toMatchObject({ title: 'Report a problem', kind: 'form' });
    expect(report.reads).toBeTruthy();
    expect(report.for).toBe('owners, admins and members');
    expect(capa.sections[1]!.screens.find((s) => s.kind === 'dashboard')!.reads).toBe(
      'CAPA overview',
    );
  });

  it('names the Core registers an add-on app reads once Core is set up here', () => {
    expect(byKey(base, 'isms-capa').uses).toEqual([]);
    const withCore = byKey(
      { ...base, installs: [{ packKey: 'core', version: cat('core').version }] },
      'isms-capa',
    );
    const nc = cat('core').manifest.sheets.find((s) => s.ref === 'nc')!.name;
    expect(withCore.uses).toContain(`${nc} (${cat('core').title})`);
    expect(withCore.state).toBe('new');
  });

  it('opens an app a live install carries, and points at Packs otherwise', () => {
    const resolved: AppStartInput['resolved'] = [
      {
        key: 'capa',
        title: 'CAPA',
        description: '',
        icon: 'wrench',
        packKey: 'start-capa',
        sections: [],
      },
    ];
    const v = cat('start-capa').version;
    expect(
      byKey({ ...base, installs: [{ packKey: 'start-capa', version: v }], resolved }, 'capa').state,
    ).toBe('ready');
    // set up at an older version without the app: update it in Packs
    expect(
      byKey({ ...base, installs: [{ packKey: 'start-capa', version: '1.0.0' }] }, 'capa').state,
    ).toBe('update');
    // set up at this version, but its screens' parts are missing
    expect(
      byKey({ ...base, installs: [{ packKey: 'start-capa', version: v }] }, 'capa').state,
    ).toBe('incomplete');
  });

  it('says when an app is for other roles', () => {
    const only = {
      ...cat('start-capa'),
      manifest: {
        ...cat('start-capa').manifest,
        apps: cat('start-capa').manifest.apps!.map((a) => ({ ...a, roles: ['owner' as const] })),
      },
    };
    const input: AppStartInput = {
      catalogue: [only],
      installs: [{ packKey: 'start-capa', version: only.version }],
      resolved: [],
      role: 'editor',
    };
    expect(appStarts(input)[0]).toMatchObject({
      state: 'not_for_you',
      for: 'owners',
      forYou: false,
    });
  });

  it('keeps an app of a live install the catalogue no longer ships', () => {
    const list = appStarts({
      ...base,
      catalogue: [cat('core')],
      installs: [{ packKey: 'old-pack', version: '1.0.0' }],
      resolved: [
        {
          key: 'old-app',
          title: 'Old app',
          description: 'Still here.',
          icon: 'wrench',
          packKey: 'old-pack',
          sections: [{ title: 'Work', screens: [{ title: 'List', kind: 'item' }] }],
        },
      ],
    });
    expect(list).toEqual([
      expect.objectContaining({ key: 'old-app', state: 'ready', packTitle: 'old-pack' }),
    ]);
  });

  it('says roles in words', () => {
    expect(rolesInWords(undefined)).toBeNull();
    expect(rolesInWords(['owner', 'admin'])).toBe('owners and admins');
    expect(rolesInWords(['auditor'])).toBe('auditors');
  });
});
