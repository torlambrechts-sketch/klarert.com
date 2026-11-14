import { describe, expect, it } from 'vitest';
import { repoPacks } from '@/lib/packs/catalogue';
import { INTENTS, intentsFile } from './intents';

describe('templates/intents.json', () => {
  it('loads, with the example chips', () => {
    expect(INTENTS.filter((i) => i.chip).map((i) => i.label)).toEqual(
      expect.arrayContaining([
        'Complaints',
        'Supplier onboarding',
        'Incidents',
        'Corrective actions',
        'Data subject requests',
        'Risks',
      ]),
    );
  });

  it('names packs and apps the repository ships', () => {
    const packs = repoPacks();
    const keys = new Set(packs.map((p) => p.key));
    const apps = new Set(packs.flatMap((p) => (p.apps ?? []).map((a) => a.key)));
    for (const i of INTENTS)
      for (const t of i.targets) {
        if (t.kind === 'pack') expect(keys.has(t.id), `${i.id} → pack ${t.id}`).toBe(true);
        if (t.kind === 'app') expect(apps.has(t.id), `${i.id} → app ${t.id}`).toBe(true);
      }
  });

  it('refuses unknown starts and recipes, and repeated ids', () => {
    const one = { id: 'x', label: 'X', keywords: ['xx'], targets: [{ kind: 'start', id: 'nope' }] };
    expect(intentsFile.safeParse({ intents: [one] }).success).toBe(false);
    const ok = { ...one, targets: [{ kind: 'recipe', id: 'done-lock' }] };
    expect(intentsFile.safeParse({ intents: [ok] }).success).toBe(true);
    expect(intentsFile.safeParse({ intents: [ok, ok] }).success).toBe(false);
  });
});
