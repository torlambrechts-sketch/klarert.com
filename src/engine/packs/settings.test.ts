import { describe, expect, it } from 'vitest';
import { packLogText } from './audit';
import {
  applyPackSettings,
  chosen,
  choiceGroups,
  cleanSettings,
  settingDefaults,
  settingFields,
  settingProblems,
  settingsSummary,
} from './settings';
import type { PackManifest, PackSetting } from './types';

// Pack settings (docs/11 Pack settings): choices shipped as data that set defaults in a pack's own sheets.
const setting: PackSetting = {
  key: 'country',
  label: 'Country',
  description: 'Where you are.',
  values: [
    { key: 'authority', label: 'Authority' },
    { key: 'csirt', label: 'CSIRT' },
  ],
  choices: [
    {
      id: 'no',
      label: 'Norway',
      group: 'EEA',
      values: { authority: 'NSM', csirt: 'NCSC' },
      verified: false,
      sources: [],
    },
    {
      id: 'de',
      label: 'Germany',
      group: 'EU',
      values: { authority: 'BSI', csirt: '' },
      verified: true,
      checkedOn: '2026-11-01',
      sources: [],
    },
  ],
};
const manifest = (over: Partial<PackManifest> = {}): PackManifest => ({
  key: 'demo',
  version: '1.0.0',
  title: 'Demo',
  description: '',
  requires: [],
  people: [],
  folders: [],
  automations: [],
  dashboards: [],
  settings: [setting],
  sheets: [
    {
      ref: 'reports',
      name: 'Reports',
      itemLabel: 'Report',
      idPrefix: 'R-',
      isLibrary: false,
      groups: [{ ref: 'open', name: 'Open', color: 'blue' }],
      views: [],
      forms: [],
      columnGroups: [],
      fields: [
        {
          key: 'to',
          name: 'Report to',
          type: 'text',
          config: { default: '$setting:country.csirt' },
        },
        {
          key: 'who',
          name: 'Authority',
          type: 'text',
          config: { default: '$setting:country.authority' },
        },
        { key: 'note', name: 'Note', type: 'text', config: { default: 'plain' } },
      ],
      items: [
        {
          ref: 'ex',
          group: 'open',
          name: 'Example',
          values: { to: '$setting:country.csirt', note: 'x' },
        },
      ],
    },
  ],
  ...over,
});
const cfg = (m: PackManifest, key: string) =>
  m.sheets[0]!.fields.find((f) => f.key === key)!.config as Record<string, unknown>;

describe('pack settings', () => {
  it('resolves $setting: tokens in field defaults and example values with the choice', () => {
    const m = applyPackSettings(manifest(), { country: 'no' });
    expect(cfg(m, 'to').default).toBe('NCSC');
    expect(cfg(m, 'who').default).toBe('NSM');
    expect(cfg(m, 'note').default).toBe('plain');
    expect(m.sheets[0]!.items[0]!.values).toEqual({ to: 'NCSC', note: 'x' });
  });

  it('leaves out a token without a choice or without a value: no default, no value', () => {
    const none = applyPackSettings(manifest(), {});
    expect(cfg(none, 'to')).toEqual({});
    expect(none.sheets[0]!.items[0]!.values).toEqual({ note: 'x' });
    const empty = applyPackSettings(manifest(), { country: 'de' });
    expect(cfg(empty, 'to')).toEqual({});
    expect(cfg(empty, 'who').default).toBe('BSI');
    // the setting's default choice applies until the workspace chooses
    const withDefault = applyPackSettings(
      manifest({ settings: [{ ...setting, default: 'no' }] }),
      {},
    );
    expect(cfg(withDefault, 'to').default).toBe('NCSC');
  });

  it('keeps only known settings and choices', () => {
    expect(cleanSettings(manifest(), { country: 'no', other: 'x' })).toEqual({ country: 'no' });
    expect(cleanSettings(manifest(), { country: 'xx' })).toEqual({});
    expect(chosen(setting, { country: 'de' })!.label).toBe('Germany');
    expect(choiceGroups(setting).map((g) => g.group)).toEqual(['EEA', 'EU']);
    expect(settingsSummary(manifest(), { country: 'no' })).toEqual(['Country: Norway']);
  });

  it('lists the setting fields by install ref and their new defaults in words', () => {
    expect(settingFields(manifest()).map((f) => [f.ref, f.setting, f.value])).toEqual([
      ['field:reports.to', 'country', 'csirt'],
      ['field:reports.who', 'country', 'authority'],
    ]);
    expect(settingDefaults(manifest(), { country: 'de' })).toEqual([
      { ref: 'field:reports.to', default: null, line: 'Report to on Reports: no default' },
      { ref: 'field:reports.who', default: 'BSI', line: 'Authority on Reports: BSI' },
    ]);
  });

  it('reports tokens that name no setting value, defaults on other types and tokens outside own sheets', () => {
    const bad = manifest();
    bad.sheets[0]!.fields.push(
      { key: 'x', name: 'X', type: 'text', config: { default: '$setting:country.nope' } },
      { key: 'y', name: 'Y', type: 'number', config: { default: '$setting:country.csirt' } },
    );
    bad.automations = [
      {
        ref: 'a',
        sheet: 'reports',
        name: 'A',
        enabled: true,
        trigger: { type: 'item_created' },
        conditions: [],
        actions: [{ type: 'post_update', message: '$setting:country.csirt' }],
      } as unknown as PackManifest['automations'][number],
    ];
    const msgs = settingProblems(bad).map((p) => p.message);
    expect(msgs).toContain('"$setting:country.nope" names no setting value of the pack.');
    expect(msgs).toContain('A setting can only set the default of a text field.');
    expect(msgs).toContain(
      'Settings set defaults and example values on the pack’s own sheets only.',
    );
    expect(settingProblems(manifest())).toEqual([]);
  });

  it('logs a settings change in words', () => {
    expect(
      packLogText('pack.settings_changed', {
        title: 'NIS2 cybersecurity (add-on)',
        labels: { 'Country of main establishment': 'Norway' },
        fields: 7,
      }),
    ).toBe(
      'Changed the settings of NIS2 cybersecurity (Country of main establishment: Norway): 7 defaults updated.',
    );
  });
});
