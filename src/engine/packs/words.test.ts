import { describe, expect, it } from 'vitest';
import { levelName, manifestForPeople, packProse, packTitle } from './words';

describe('pack words people see (docs/05 Words)', () => {
  it('drops "(add-on)" from titles and calls the Core registers the shared registers', () => {
    expect(packTitle('ISO/IEC 27001:2022 ISMS (add-on)')).toBe('ISO/IEC 27001:2022 ISMS');
    expect(packTitle('GDPR privacy (add-on)')).toBe('GDPR privacy');
    expect(packTitle('Core registers')).toBe('Shared registers');
    expect(packTitle('CAPA')).toBe('CAPA');
  });

  it('names the levels Basic, Recommended and Everything, never Standard', () => {
    expect(levelName('Foundations')).toBe('Basic');
    expect(levelName('Starter')).toBe('Recommended');
    expect(levelName('Full')).toBe('Everything');
    expect(levelName('Custom')).toBe('Custom');
    for (const n of ['Foundations', 'Starter', 'Full']) expect(levelName(n)).not.toMatch(/standard/i);
  });

  it('rewrites running text', () => {
    expect(packProse('Installs the Core registers (Full) first.')).toBe(
      'Installs the shared registers (Everything) first.',
    );
    expect(packProse('Everything in Starter plus contractors.')).toBe(
      'Everything in Recommended plus contractors.',
    );
    expect(packProse('Installs the Core registers (Starter) first.')).toBe(
      'Installs the shared registers (Recommended) first.',
    );
    expect(packProse('Full adds a transfers sheet.')).toBe(
      'The Everything level adds a transfers sheet.',
    );
    expect(packProse('Starter has no drill log: or add Full for the sheet.')).toBe(
      'The Recommended level has no drill log: or add the Everything level for the sheet.',
    );
    expect(packProse('the add-on brings what only a quality system needs')).toBe(
      'the standard brings what only a quality system needs',
    );
  });

  it("maps a manifest's levels and setup, and leaves keys alone", () => {
    const m = manifestForPeople({
      title: 'Core registers',
      description: 'Standards are added as add-ons that extend these registers.',
      levels: [
        {
          key: 'starter',
          name: 'Starter',
          description: 'Everything in Foundations plus incidents.',
        },
      ],
      setup: {
        title: 'GDPR setup',
        description: 'Four steps on the Core registers.',
        steps: [
          {
            ref: 'transfers',
            title: 'Transfers',
            body: 'Mark each processor.',
            target: { sheetRef: 'processors' },
            rules: [],
            levels: { starter: { body: 'Full adds a transfers sheet.' } },
          },
        ],
      },
    });
    expect(m.title).toBe('Shared registers');
    expect(m.description).toBe('Standards extend these registers.');
    expect(m.levels).toEqual([
      { key: 'starter', name: 'Recommended', description: 'Everything in Basic plus incidents.' },
    ]);
    expect(m.setup!.description).toBe('Four steps on the shared registers.');
    expect(m.setup!.steps[0]!.ref).toBe('transfers');
    expect(m.setup!.steps[0]!.levels!.starter!.body).toBe(
      'The Everything level adds a transfers sheet.',
    );
  });
});
