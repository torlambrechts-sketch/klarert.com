import { describe, expect, it } from 'vitest';
import { repoPacks } from '@/lib/packs/catalogue';
import { rankGoal, type Candidate } from '@/engine/create/match';
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

  it('finds apps by goal, as apps (the App card), next to their sets', () => {
    const packs = repoPacks();
    const candidates: Candidate[] = [
      ...packs.map((p) => ({ kind: 'pack' as const, id: p.key, title: p.title, description: '' })),
      ...packs.flatMap((p) =>
        (p.apps ?? []).map((a) => ({
          kind: 'app' as const,
          id: a.key,
          title: a.title,
          description: a.description ?? '',
        })),
      ),
    ];
    const capa = rankGoal('corrective actions', INTENTS, candidates);
    expect(capa[0]).toMatchObject({ kind: 'app', id: 'capa' });
    expect(capa.map((m) => `${m.kind}:${m.id}`)).toContain('app:isms-capa');
    const isms = rankGoal('information security', INTENTS, candidates).map(
      (m) => `${m.kind}:${m.id}`,
    );
    expect(isms.slice(0, 2)).toEqual(['pack:iso-27001', 'app:isms-capa']);
  });

  it('refuses unknown starts and recipes, and repeated ids', () => {
    const one = { id: 'x', label: 'X', keywords: ['xx'], targets: [{ kind: 'start', id: 'nope' }] };
    expect(intentsFile.safeParse({ intents: [one] }).success).toBe(false);
    const ok = { ...one, targets: [{ kind: 'recipe', id: 'done-lock' }] };
    expect(intentsFile.safeParse({ intents: [ok] }).success).toBe(true);
    expect(intentsFile.safeParse({ intents: [ok, ok] }).success).toBe(false);
  });
});
