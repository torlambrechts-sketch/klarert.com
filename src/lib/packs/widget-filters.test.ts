import { describe, expect, it } from 'vitest';
import { manifestFor, packCases } from '@/engine/packs/optional';
import type { PackManifest } from '@/engine/packs/types';
import { repoPacks } from './catalogue';

// A widget's filter must not contradict its kind (Supplier management 3.1.0's "Met checks with expired evidence" was an
// Overdue widget filtered to Met: Overdue leaves out done items and Met is done, so it always read 0). Every widget of
// every repository pack, in every case of its optional requirements, on its own sheets and on the Core registers.

type Field = { key: string; type: string; config?: Record<string, unknown> };
type Option = { id: string; done?: boolean };
const packs = repoPacks();
const optionsOf = (f: Field): Option[] => (f.config?.options as Option[] | undefined) ?? [];

/** The sheet's fields as the widget sees them: a required pack's sheet with the options this pack adds to it. */
function fieldsOf(m: PackManifest, sheetRef: string): Field[] | null {
  const colon = sheetRef.indexOf(':');
  if (colon < 0) return (m.sheets.find((s) => s.ref === sheetRef)?.fields as Field[]) ?? null;
  const [key, ref] = [sheetRef.slice(0, colon), sheetRef.slice(colon + 1)];
  const base = packs.find((p) => p.key === key)?.sheets.find((s) => s.ref === ref);
  if (!base) return null;
  const e = (m.extends ?? []).find((x) => x.pack === key && x.sheet === ref);
  return [...(base.fields as Field[]), ...((e?.fields ?? []) as Field[])].map((f) => ({
    ...f,
    config: {
      ...(f.config ?? {}),
      options: [
        ...optionsOf(f),
        ...((e?.options?.[f.key] ?? []) as Option[]),
        // the Standards tag of every add-on
        ...(f.key === 'standards'
          ? packs.flatMap((p) => (p.standard ? [{ id: p.standard.id }] : []))
          : []),
      ],
    },
  }));
}

/** What is wrong with a pack's widgets' filters, one line each. */
function problems(m: PackManifest): string[] {
  const out: string[] = [];
  for (const d of m.dashboards)
    for (const w of d.widgets) {
      const fields = w.sheetRef ? fieldsOf(m, w.sheetRef) : null;
      if (!fields) continue;
      // the field that says whether an item is done (fields/item-status.ts): the first status field, else one with a
      // done option
      const status =
        fields.find((f) => f.type === 'status') ??
        fields.find((f) => optionsOf(f).some((o) => o.done));
      const say = (msg: string) => out.push(`${m.key} › ${d.name} › ${w.title}: ${msg}`);
      const all = [...(w.scope ?? []), ...(w.conditions ?? [])];
      for (const c of all) {
        const f = fields.find((x) => x.key === c.fieldKey);
        if (!f) continue;
        const opts = optionsOf(f);
        const values = Array.isArray(c.value) ? (c.value as string[]) : [];
        if (opts.length && /^(is|has)_(any|none|all)_of$/.test(c.op))
          for (const v of values)
            if (!opts.some((o) => o.id === v)) say(`"${v}" is not an option of ${f.key}`);
        const onlyDone =
          f.key === status?.key &&
          (c.op === 'is_done' ||
            (c.op === 'is_any_of' &&
              values.length > 0 &&
              values.every((v) => opts.find((o) => o.id === v)?.done)));
        if (onlyDone && w.type === 'overdue')
          say('an Overdue widget leaves out done items, but its filter keeps only done ones');
        if (onlyDone && all.some((x) => x.fieldKey === f.key && x.op === 'is_not_done'))
          say('its filter keeps items that are done and not done');
      }
    }
  return out;
}

describe('widget filters agree with the widget kind', () => {
  it('no widget of a repository pack is filtered to what its kind leaves out', () => {
    const found = packs.flatMap((p) => packCases(p).flatMap((c) => problems(manifestFor(p, c))));
    expect(found).toEqual([]);
  });

  it('names an Overdue widget filtered to a done option (the 3.1.0 widget)', () => {
    const sm = packs.find((p) => p.key === 'supplier-management')!;
    const broken: PackManifest = {
      ...sm,
      dashboards: [
        {
          ref: 'overview',
          name: 'Supplier overview',
          widgets: [
            {
              ref: 'w_expired',
              type: 'overdue',
              title: 'Met checks with expired evidence',
              sheetRef: 'check',
              fieldKey: 'evidence_expiry',
              conditions: [{ fieldKey: 'status', op: 'is_any_of', value: ['opt_met'] }],
            },
            {
              ref: 'w_typo',
              type: 'count',
              title: 'Typo',
              sheetRef: 'check',
              conditions: [{ fieldKey: 'status', op: 'is_any_of', value: ['opt_mett'] }],
            },
          ],
        },
      ],
    };
    expect(problems(broken)).toEqual([
      'supplier-management › Supplier overview › Met checks with expired evidence: an Overdue widget leaves out done items, but its filter keeps only done ones',
      'supplier-management › Supplier overview › Typo: "opt_mett" is not an option of status',
    ]);
  });
});
