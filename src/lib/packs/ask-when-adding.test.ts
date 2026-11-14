import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { afterInstall, installedStateOf } from '@/engine/packs/installed.fixture';
import { planPackInstall, type PackSnapshot } from '@/engine/packs/plan';
import { planPackUpgrade } from '@/engine/packs/upgrade';
import type { PackManifest } from '@/engine/packs/types';
import { askWhenAdding } from '@/engine/views/new-item';
import { core, emptySnapshot, env, libraryItems, packByKey } from './addon.fixture';
import { parsePack } from './manifest';
import { packQualityProblems } from './quality';

// The packs mark "Ask when adding" (config.askWhenAdding, docs/05 §3.7) on their audit registers: what the New item
// dialog asks with the name. Each is a same-major minor version of the one before (kept in
// tests/e2e/fixtures/catalogue, taken from the repository's history), and an untouched workspace updates without a
// conflict: only those fields' settings change.

const MARKED: Record<string, { from: string; to: string; sheets: Record<string, string[]> }> = {
  core: {
    from: '1.2.0',
    to: '1.3.0',
    sheets: {
      risk: ['owner', 'cause', 'likelihood', 'impact'],
      incidents: ['what_happened', 'noticed_at', 'severity', 'owner'],
      nc: ['details', 'found_on', 'grade', 'owner', 'due_date'],
      actions: ['owner', 'due'],
      suppliers: ['supplies', 'owner', 'criticality'],
    },
  },
  gdpr: {
    from: '2.1.0',
    to: '2.2.0',
    sheets: {
      dsr: ['request_type', 'requester', 'received_on', 'owner'],
      breach: ['aware_at', 'description', 'owner'],
      dpia: ['description', 'owner'],
      processor: ['service', 'owner'],
    },
  },
  'iso-14001': {
    from: '2.1.0',
    to: '2.2.0',
    sheets: { aspects: ['activity', 'aspect', 'impact', 'owner'] },
  },
  'iso-27001': {
    from: '2.1.0',
    to: '2.2.0',
    sheets: { treatment: ['owner', 'details', 'due_date'] },
  },
  'iso-45001': {
    from: '1.2.0',
    to: '1.3.0',
    sheets: {
      hazards: ['task', 'hazard', 'likelihood', 'severity', 'owner'],
      contractors: ['work', 'owner'],
    },
  },
  'iso-9001': {
    from: '2.2.0',
    to: '2.3.0',
    sheets: {
      complaint: ['kind', 'customer', 'received_on', 'description', 'owner'],
      supplier: ['provides', 'criticality', 'owner'],
    },
  },
  nis2: { from: '1.0.0', to: '1.1.0', sheets: { reports: ['aware_at', 'significant', 'owner'] } },
  'supplier-management': {
    from: '3.0.0',
    to: '3.1.0',
    sheets: { review: ['reviewer', 'review_date', 'result'] },
  },
};

const archived = (key: string, version: string): PackManifest =>
  parsePack(
    JSON.parse(
      readFileSync(
        join(process.cwd(), `tests/e2e/fixtures/catalogue/${key}@${version}.json`),
        'utf8',
      ),
    ) as unknown,
  );

/** The libraries a pack builds on, adopted, each requirement an item. */
function libraries(packs: PackManifest[]) {
  const fws = packs.flatMap((p) => p.frameworks ?? []).filter((f) => !f.optional);
  return {
    libraries: fws.map((f) => ({
      library: `${f.key}@${f.version}`,
      sheetId: `lib:${f.key}@${f.version}`,
    })),
    requirementItems: Object.assign(
      {},
      ...fws.map((f) => libraryItems(f.key, f.version)),
    ) as Record<string, string>,
  };
}

/** Plan the update of `key` from its previous version in a workspace that installed it untouched (Core at Full). */
function update(key: string) {
  const m = MARKED[key]!;
  const from = archived(key, m.from);
  const to = packByKey(key);
  if (key === 'core') {
    const coreP = planPackInstall(from, emptySnapshot(), env, { level: 'full' }).payload!;
    return planPackUpgrade({
      from: { manifest: from, hash: 'h-from' },
      to: { manifest: to, hash: 'h-to' },
      state: installedStateOf(coreP, 'inst-core'),
      snapshot: { ...afterInstall(emptySnapshot(), coreP, 'inst-core'), installs: [] },
      env,
    });
  }
  const libs = libraries([from]);
  const coreP = planPackInstall(core, emptySnapshot(libs), env, { level: 'full' }).payload!;
  const withCore = afterInstall(emptySnapshot(libs), coreP, 'inst-core');
  const addonP = planPackInstall(from, withCore, env, { level: 'full' }).payload!;
  const all: PackSnapshot = afterInstall(withCore, addonP, 'inst-addon');
  // its own rows on Core's sheets are its own (as the server reads them)
  for (const f of Object.values(all.foreign ?? {}))
    for (const x of f.fields)
      if (addonP.fields.some((y) => y.id === x.id)) x.installId = 'inst-addon';
  return planPackUpgrade({
    from: { manifest: from, hash: 'h-from' },
    to: { manifest: to, hash: 'h-to' },
    state: installedStateOf(addonP, 'inst-addon'),
    snapshot: { ...all, installs: all.installs.filter((i) => i.id !== 'inst-addon') },
    env,
  });
}

describe.each(Object.keys(MARKED))('%s asks for its key fields when an item is added', (key) => {
  const m = MARKED[key]!;
  const pack = packByKey(key);

  it(`is ${m.to}, a minor version of ${m.from}, and meets the quality bar`, () => {
    expect(pack.version).toBe(m.to);
    expect(m.to.split('.')[0]).toBe(m.from.split('.')[0]);
    expect(packQualityProblems(pack)).toEqual([]);
  });

  it('marks "Ask when adding" on its audit registers, and only there', () => {
    for (const s of pack.sheets) {
      const marked = s.fields.filter(askWhenAdding).map((f) => f.key);
      expect(marked, s.ref).toEqual(m.sheets[s.ref] ?? []);
    }
    // never on a column it adds to a shared register: those belong to the Core registers' choice
    for (const e of pack.extends ?? [])
      for (const f of e.fields ?? []) expect(askWhenAdding(f), `${e.sheet}.${f.key}`).toBe(false);
  });

  it('updates an untouched workspace without a conflict, changing only those fields', () => {
    const p = update(key);
    expect(p.preview.blockers).toEqual([]);
    expect(p.state).toBe('ready');
    expect(p.preview.conflicts).toEqual([]);
    expect(p.preview.archived).toEqual([]);
    const marked = Object.entries(m.sheets).flatMap(([s, keys]) => keys.map((k) => `${s}.${k}`));
    expect(
      p.preview.changed
        .filter((c) => c.kind === 'field')
        .map((c) => c.ref)
        .sort(),
    ).toEqual(marked.sort());
    for (const f of p.payload!.update.fields)
      expect((f.config as { askWhenAdding?: boolean }).askWhenAdding, String(f.id)).toBe(true);
  });
});

describe('Core registers asks the key fields of its audit registers', () => {
  it('asks what was found, when, how serious, who owns it and by when for a nonconformity', () => {
    const nc = core.sheets.find((s) => s.ref === 'nc')!;
    expect(nc.fields.filter(askWhenAdding).map((f) => f.name)).toEqual([
      'What was found',
      'Found on',
      'Grade',
      'Owner',
      'Due',
    ]);
  });
});
