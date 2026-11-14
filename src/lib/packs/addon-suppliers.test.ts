import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { neededLevel } from '@/engine/packs/extend';
import { afterInstall, installedStateOf } from '@/engine/packs/installed.fixture';
import { planPackInstall, type PackSnapshot } from '@/engine/packs/plan';
import { planPackUpgrade } from '@/engine/packs/upgrade';
import type { PackManifest } from '@/engine/packs/types';
import { core, emptySnapshot, env, packByKey } from './addon.fixture';
import { parsePack } from './manifest';

// The add-ons that link their supplier records to Core 1.1.0's Suppliers register (docs/11): ISO 9001 2.1.0
// (External providers, Full), ISO 45001 1.1.0 (Contractors, Full) and GDPR 2.1.0 (Processors, Starter). Each is an
// update of the version before, which is the same manifest without the Supplier link (rebuilt here).

const LINKS = [
  {
    key: 'iso-9001',
    from: '2.0.0',
    sheet: 'supplier',
    inverse: 'iso9001_providers',
    level: 'full',
  },
  {
    key: 'iso-45001',
    from: '1.0.0',
    sheet: 'contractors',
    inverse: 'iso45001_contractors',
    level: 'full',
  },
  { key: 'gdpr', from: '2.0.0', sheet: 'processor', inverse: 'gdpr_processors', level: 'starter' },
] as const;

/** The version before: no Supplier link, Core ^1.0.0. */
function before(m: PackManifest, version: string): PackManifest {
  return {
    ...m,
    version,
    requires: m.requires.map((r) => (r.pack === 'core' ? { ...r, range: '^1.0.0' } : r)),
    sheets: m.sheets.map((s) => ({
      ...s,
      fields: s.fields.filter((f) => f.key !== 'core_supplier'),
    })),
    extends: (m.extends ?? []).filter((e) => e.sheet !== 'suppliers'),
  };
}

const core100 = parsePack(
  JSON.parse(
    readFileSync(join(process.cwd(), 'src/lib/packs/fixtures/core-1.0.0.json'), 'utf8'),
  ) as unknown,
);

describe.each(LINKS)('$key links its supplier records to Core Suppliers', (l) => {
  const pack = packByKey(l.key);
  const level = l.level === 'full' ? 'full' : 'starter';

  it('links both ways, from the level of its own sheet, and Starter needs only Core Starter', () => {
    const own = pack.sheets.find((s) => s.ref === l.sheet)!;
    expect(own.fields.find((f) => f.key === 'core_supplier')?.config).toMatchObject({
      targetSheetRef: 'core:suppliers',
      inverseKey: l.inverse,
    });
    const entry = pack.extends!.find((e) => e.sheet === 'suppliers')!;
    expect(entry.level).toBe(l.level === 'full' ? 'full' : undefined);
    expect(entry.fields!.map((f) => f.key)).toEqual([l.inverse]);
    expect(neededLevel(pack, core, 'starter')).toBe('starter');
    expect(pack.requires).toEqual([{ pack: 'core', range: '^1.1.0' }]);
  });

  it(`updates from ${l.from} on Core 1.1.0, and waits for Core 1.1.0 on Core 1.0.0`, () => {
    const old = before(pack, l.from);
    const plan = (c: PackManifest, coreLevel: string) => {
      const coreP = planPackInstall(c, emptySnapshot(), env, { level: coreLevel }).payload!;
      const withCore = afterInstall(emptySnapshot(), coreP, 'inst-core');
      const addonP = planPackInstall(old, withCore, env, { level }).payload!;
      const all: PackSnapshot = afterInstall(withCore, addonP, 'inst-addon');
      // its own rows on Core's sheets are its own (as the server reads them)
      for (const f of Object.values(all.foreign ?? {}))
        for (const x of f.fields)
          if (addonP.fields.some((y) => y.id === x.id)) x.installId = 'inst-addon';
      return planPackUpgrade({
        from: { manifest: old, hash: 'h-old' },
        to: { manifest: pack, hash: 'h-new' },
        state: installedStateOf(addonP, 'inst-addon'),
        snapshot: { ...all, installs: all.installs.filter((i) => i.id !== 'inst-addon') },
        env,
      });
    };
    const coreLevel = level === 'full' ? 'full' : 'starter';
    const ok = plan(core, coreLevel);
    expect(ok.preview.blockers).toEqual([]);
    expect(ok.state).toBe('ready');
    expect(ok.payload!.add.fields.map((f) => f.ref).sort()).toEqual(
      [`${l.sheet}.core_supplier`, `core:suppliers.${l.inverse}`].sort(),
    );
    const waits = plan(core100, coreLevel);
    expect(waits.state).toBe('blocked');
    expect(waits.preview.blockers.join(' ')).toMatch(
      /needs the sheet "suppliers" of "core"|\^1\.1\.0/,
    );
  });
});
