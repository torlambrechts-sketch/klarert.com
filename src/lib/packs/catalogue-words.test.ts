import { describe, expect, it } from 'vitest';
import { manifestForPeople } from '@/engine/packs/words';
import { repoPacks } from './catalogue';

// The catalogue in the words people see (engine/packs/words.ts, docs/05 Words): every shipped pack.
describe('catalogue packs in plain words', () => {
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
