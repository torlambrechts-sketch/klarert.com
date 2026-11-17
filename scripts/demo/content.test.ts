// The demo content is checked against the catalogue it is written into, without a database: every sheet exists in a
// pack the demo installs, every value names a field of that sheet, option values are options the field offers, people
// are the demo's people, dates sit within the last 18 months and the next two years, and every requirement it links to
// is in the framework's library.
import { describe, expect, it } from 'vitest';
import { repoFrameworks } from '../../src/lib/frameworks/catalogue';
import { repoPacks } from '../../src/lib/packs/catalogue';
import { demoClock } from './clock';
import { coreContent, coreLinks } from './content/core';
import { ehsContent } from './content/ehs';
import { ismsContent } from './content/isms';
import { libraryPlans } from './content/library';
import { ownFrameworkDraft } from './content/own-framework';
import { privacyContent } from './content/privacy';
import { qualityContent } from './content/quality';
import type { DemoSheet } from './content/types';
import { PEOPLE } from './people';

const c = demoClock('2026-11-17');
const content: DemoSheet[] = [
  ...coreContent(c),
  ...qualityContent(c),
  ...ismsContent(c),
  ...ehsContent(c),
  ...privacyContent(c),
];
const INSTALLED = [
  'core',
  'iso-9001',
  'iso-27001',
  'iso-14001',
  'iso-45001',
  'gdpr',
  'nis2',
  'supplier-management',
];

type FieldInfo = { type: string; options: Set<string> };

/** Sheet name → field key → type and option labels, with what every installed pack adds to it. */
function sheetIndex() {
  const packs = repoPacks().filter((p) => INSTALLED.includes(p.key));
  const out = new Map<string, Map<string, FieldInfo>>();
  const refName = new Map<string, string>();
  const add = (sheet: string, f: { key: string; type: string; config?: unknown }) => {
    const fields = out.get(sheet) ?? new Map<string, FieldInfo>();
    const opts = ((f.config as { options?: { label: string }[] } | undefined)?.options ?? []).map(
      (o) => o.label,
    );
    const known = fields.get(f.key);
    fields.set(f.key, { type: f.type, options: new Set([...(known?.options ?? []), ...opts]) });
    out.set(sheet, fields);
  };
  for (const p of packs)
    for (const s of p.sheets) {
      refName.set(`${p.key}:${s.ref}`, s.name);
      for (const f of s.fields) add(s.name, f);
    }
  for (const p of packs)
    for (const e of p.extends ?? []) {
      const name = refName.get(`${e.pack}:${e.sheet}`)!;
      for (const f of e.fields ?? []) add(name, f);
      for (const [key, options] of Object.entries(e.options ?? {}))
        for (const o of options) out.get(name)?.get(key)?.options.add(o.label);
    }
  return out;
}

const OPTION_TYPES = new Set(['dropdown', 'status', 'multiselect']);
const PEOPLE_NAMES = new Set(PEOPLE.map((p) => p.name));
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

describe('the demo content fits the catalogue', () => {
  const index = sheetIndex();

  it('writes only to sheets the installed packs make, and only to their fields', () => {
    for (const block of content) {
      const fields = index.get(block.sheet);
      expect(fields, block.sheet).toBeDefined();
      for (const it of block.items) {
        const keys = [
          ...Object.keys(it.values ?? {}),
          ...Object.keys(it.links ?? {}),
          ...(it.steps ?? []).flatMap((s) => Object.keys(s.values)),
          ...(it.files ?? []).flatMap((f) => (f.field ? [f.field] : [])),
        ];
        for (const k of keys)
          expect(fields!.has(k), `${block.sheet} › ${it.name} › ${k}`).toBe(true);
      }
    }
  });

  it('uses option labels the fields offer (Standards is narrowed to the sheet’s options when written)', () => {
    for (const block of content) {
      const fields = index.get(block.sheet)!;
      for (const it of block.items)
        for (const values of [it.values ?? {}, ...(it.steps ?? []).map((s) => s.values)])
          for (const [k, v] of Object.entries(values)) {
            const f = fields.get(k)!;
            if (!OPTION_TYPES.has(f.type) || k === 'standards' || v === undefined) continue;
            for (const label of Array.isArray(v) ? v : [v])
              expect(
                f.options.has(String(label)),
                `${block.sheet} › ${it.name} › ${k}: ${label}`,
              ).toBe(true);
          }
    }
  });

  it('names only the demo’s people, and dates stay within 18 months back and two years ahead', () => {
    const earliest = c.month(-18, 1);
    const latest = c.day(800);
    for (const block of content) {
      const fields = index.get(block.sheet)!;
      for (const it of block.items)
        for (const values of [it.values ?? {}, ...(it.steps ?? []).map((s) => s.values)])
          for (const [k, v] of Object.entries(values)) {
            if (fields.get(k)?.type === 'people')
              for (const n of Array.isArray(v) ? v : [v])
                expect(PEOPLE_NAMES.has(String(n)), `${it.name} › ${k}: ${n}`).toBe(true);
            if (isDate(v) && ['date', 'datetime'].includes(fields.get(k)?.type ?? '')) {
              expect(v.slice(0, 10) >= earliest, `${it.name} › ${k}: ${v}`).toBe(true);
              expect(v.slice(0, 10) <= latest, `${it.name} › ${k}: ${v}`).toBe(true);
            }
          }
    }
  });

  it('links only to requirements the libraries have and to items the content makes', () => {
    const frameworks = repoFrameworks();
    const names = new Set(content.flatMap((b) => b.items.map((i) => `${b.sheet}#${i.name}`)));
    const refs = [
      ...content.flatMap((b) => b.items.flatMap((i) => Object.values(i.links ?? {}).flat())),
      ...coreLinks().flatMap((l) => [l.from, ...l.to]),
    ];
    for (const ref of refs) {
      if (ref.startsWith('req:')) {
        const [fw, r] = ref.slice(4).split('#') as [string, string];
        const [key, version] = fw.split('@');
        const f = frameworks.find((x) => x.key === key && x.version === version);
        expect(
          f?.requirements.some((x) => x.ref === r && x.kind !== 'theme'),
          ref,
        ).toBe(true);
      } else expect(names.has(ref.slice(5)), ref).toBe(true);
    }
  });

  it('library plans and the own framework name real requirements', () => {
    const frameworks = repoFrameworks();
    for (const plan of libraryPlans(c)) {
      const [key, version] = plan.framework.split('@');
      const f = frameworks.find((x) => x.key === key && x.version === version)!;
      const refs = new Set(f.requirements.filter((r) => r.kind !== 'theme').map((r) => r.ref));
      const named = [
        ...Object.keys(plan.notApplicable),
        ...(plan.applicable === '*' ? [] : plan.applicable),
        ...plan.implemented,
        ...plan.partial,
        ...plan.planned,
        ...plan.evidence.map((e) => e.ref),
        ...(plan.expired ?? []).map((e) => e.ref),
      ];
      for (const r of named) expect(refs.has(r), `${plan.framework} ${r}`).toBe(true);
    }
    const iso2015 = frameworks.find((x) => x.key === 'iso-9001' && x.version === '2015')!;
    for (const m of ownFrameworkDraft().mappings)
      expect(
        iso2015.requirements.some((r) => `iso-9001@2015#${r.ref}` === m.to),
        m.to,
      ).toBe(true);
  });

  it('item names are unique per sheet', () => {
    for (const block of content) {
      const names = block.items.map((i) => i.name);
      expect(new Set(names).size, block.sheet).toBe(names.length);
    }
  });
});

describe('the demo clock', () => {
  it('counts days, months and quarters from the injected today', () => {
    const k = demoClock('2026-01-31');
    expect(k.day(1)).toBe('2026-02-01');
    expect(k.day(-31)).toBe('2025-12-31');
    expect(k.month(1)).toBe('2026-02-28');
    expect(k.month(-12, 15)).toBe('2025-01-15');
    expect(k.at(0, '09:20')).toBe('2026-01-31T09:20:00.000Z');
    expect(k.quarter(0)).toBe('Q1 2026');
    expect(k.quarter(-1)).toBe('Q4 2025');
    expect(() => demoClock('31/01/2026')).toThrow();
  });
});
