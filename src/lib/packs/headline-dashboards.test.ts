import { describe, expect, it } from 'vitest';
import { STANDARDS_KEY } from '@/engine/packs/extend';
import type { PackWidget } from '@/engine/packs/types';
import { packs } from './addon.fixture';

// An add-on's headline dashboard reads the shared Core registers through its Standards tag (docs/11 Core registers).
// Owner decision (Nov 2026, the ISMS overview's "3 risks" against "0 of 12 risks"): every widget on one register
// looks at the same rows, the ones tagged with the add-on's standard, as the widget's scope. A count then says
// "0 of 3 risks", against the tagged rows, never against the whole shared register.

const tagOf = (conds: PackWidget['conditions']) =>
  JSON.stringify((conds ?? []).filter((c) => c.fieldKey === STANDARDS_KEY));

const addons = packs.filter((p) => p.standard && p.requires.some((r) => r.pack === 'core'));

describe('add-on headline dashboards on the Core registers', () => {
  it('covers the standards built on Core', () => {
    expect(addons.map((p) => p.key).sort()).toEqual(
      ['gdpr', 'iso-14001', 'iso-27001', 'iso-45001', 'iso-9001', 'nis2'].sort(),
    );
  });

  for (const p of addons) {
    const headline = p.dashboards.find((d) => d.headline)!;
    const onCore = headline.widgets.filter((w) => w.sheetRef?.startsWith('core:'));

    it(`${p.key} ${p.version}: widgets on one register look at the same rows, by its standard's tag`, () => {
      const bySheet = new Map<string, Set<string>>();
      for (const w of onCore) {
        const scopes = bySheet.get(w.sheetRef!) ?? new Set<string>();
        scopes.add(tagOf(w.scope));
        bySheet.set(w.sheetRef!, scopes);
        // the tag is the scope, never one of the conditions
        expect(tagOf(w.conditions), `${w.ref}`).toBe('[]');
      }
      for (const [sheet, scopes] of bySheet) expect([...scopes], sheet).toHaveLength(1);
      // the tag is the add-on's own standard
      for (const w of onCore.filter((x) => x.scope?.length))
        expect(w.scope, w.ref).toEqual([
          { fieldKey: STANDARDS_KEY, op: 'has_any_of', value: [p.standard!.id] },
        ]);
    });
  }

  it('the ISMS overview counts risks above 12 among the ISO 27001 risks, like Risks by status', () => {
    const isms = packs.find((p) => p.key === 'iso-27001')!.dashboards.find((d) => d.headline)!;
    const w = (ref: string) => isms.widgets.find((x) => x.ref === ref)!;
    expect(w('w_risk_high').scope).toEqual(w('w_risk_status').scope);
    expect(w('w_risk_high').scope).toEqual([
      { fieldKey: 'standards', op: 'has_any_of', value: ['iso27001'] },
    ]);
    expect(w('w_risk_high').conditions).toEqual([
      { fieldKey: 'iso27001_residual_score', op: 'gt', value: 12 },
    ]);
  });
});
