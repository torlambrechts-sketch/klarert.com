import { describe, expect, it } from 'vitest';
import { repoPacks } from '@/lib/packs/catalogue';
import { levelName, manifestForPeople, packProse, packTitle } from './words';

describe('pack words people see (docs/05 Words)', () => {
  it('drops "(add-on)" from titles and calls the Core registers the shared registers', () => {
    expect(packTitle('ISO/IEC 27001:2022 ISMS (add-on)')).toBe('ISO/IEC 27001:2022 ISMS');
    expect(packTitle('GDPR privacy (add-on)')).toBe('GDPR privacy');
    expect(packTitle('Core registers')).toBe('Shared registers');
    expect(packTitle('CAPA')).toBe('CAPA');
  });

  it('names the levels Basic, Standard and Everything', () => {
    expect(levelName('Foundations')).toBe('Basic');
    expect(levelName('Starter')).toBe('Standard');
    expect(levelName('Full')).toBe('Everything');
    expect(levelName('Custom')).toBe('Custom');
  });

  it('rewrites running text', () => {
    expect(packProse('Installs the Core registers (Full) first.')).toBe(
      'Installs the shared registers (Everything) first.',
    );
    expect(packProse('Everything in Starter plus contractors.')).toBe(
      'Everything in Standard plus contractors.',
    );
    expect(packProse('Full adds a transfers sheet.')).toBe(
      'The Everything level adds a transfers sheet.',
    );
    expect(packProse('Starter has no drill log: or add Full for the sheet.')).toBe(
      'The Standard level has no drill log: or add the Everything level for the sheet.',
    );
    expect(packProse('the add-on brings what only a quality system needs')).toBe(
      'the standard brings what only a quality system needs',
    );
  });

  it('leaves keys, versions and sheets alone', () => {
    const [m] = repoPacks().filter((p) => p.key === 'core');
    const shown = manifestForPeople(m!);
    expect(shown.key).toBe('core');
    expect(shown.version).toBe(m!.version);
    expect(shown.sheets).toBe(m!.sheets);
    expect(shown.levels!.map((l) => l.key)).toEqual(m!.levels!.map((l) => l.key));
    expect(shown.levels!.map((l) => l.name)).toEqual(['Basic', 'Standard', 'Everything']);
  });

  it('leaves no pack vocabulary in any catalogue pack people read', () => {
    const banned = /\badd-ons?\b|\bCore registers\b|\b(Foundations|Starter|Full)\b/i;
    for (const m of repoPacks()) {
      const shown = manifestForPeople(m);
      const texts = [
        shown.title,
        shown.description,
        ...(shown.levels ?? []).flatMap((l) => [l.name, l.description]),
        ...(shown.setup
          ? [
              shown.setup.title,
              shown.setup.description,
              ...shown.setup.steps.flatMap((s) => [
                s.title,
                s.body,
                ...Object.values(s.levels ?? {}).flatMap((v) => [v.title ?? '', v.body ?? '']),
              ]),
            ]
          : []),
      ];
      for (const t of texts) expect(t, `${m.key}: ${t}`).not.toMatch(banned);
    }
  });
});
