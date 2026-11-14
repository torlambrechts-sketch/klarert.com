import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoPacks } from './catalogue';
import { parsePack } from './manifest';
import { packLogText } from '@/engine/packs/audit';
import { manifestAtLevel } from '@/engine/packs/levels';
import { planPackInstall, type PackSnapshot } from '@/engine/packs/plan';
import {
  appsAfter,
  bundleParts,
  canChooseFolder,
  closeExclusions,
  selectionCounts,
  selectManifest,
  togglePart,
} from '@/engine/packs/select';
import type { PackManifest } from '@/engine/packs/types';

const pack = (key: string) => repoPacks().find((p) => p.key === key)!;
/** Supplier management 1.1.0, a standalone pack with a documents register, a library and a public form. */
const standalone = () =>
  parsePack(
    JSON.parse(
      readFileSync(new URL('./fixtures/supplier-management-1.1.0.json', import.meta.url), 'utf8'),
    ),
  );

const snapshot: PackSnapshot = {
  orgId: 'org-1',
  prefixes: [],
  folders: [{ id: 'f-ops', name: 'Operations', archived: false }],
  installs: [],
  members: [],
  jobRoles: [],
  teams: [],
  lastSheetPosition: null,
  lastFolderPosition: null,
  lastDashboardPosition: null,
};
const env = {
  today: '2026-11-14',
  now: new Date('2026-11-14T09:00:00Z'),
  timeZone: 'Europe/London',
  newId: randomUUID,
  hash: 'h'.repeat(64),
  userId: 'u-1',
};

describe('bundle parts', () => {
  it('lists sheets, forms, automations and dashboards with what they need', () => {
    const parts = bundleParts(standalone());
    const byId = new Map(parts.map((p) => [p.id, p]));
    expect(parts.filter((p) => p.kind === 'sheet')).not.toHaveLength(0);
    expect(byId.get('sheet:supplier')!.requires).toEqual(
      expect.arrayContaining(['sheet:review', 'sheet:requirement', 'sheet:document']),
    );
    expect(byId.get('automation:review_failed')!.requires).toEqual(['sheet:review']);
    expect(byId.get('dashboard:overview')!.requires).toContain('sheet:supplier');
    const form = byId.get('form:supplier.self_assessment')!;
    expect(form.flags.map((f) => f.kind)).toEqual(['public_form']);
    expect(form.requires).toEqual(['sheet:supplier']);
  });

  it('makes a form trigger depend on its form', () => {
    const parts = bundleParts(pack('start-capa'));
    const auto = parts.find((p) => p.id === 'automation:reported_add_steps')!;
    expect(auto.requires).toEqual(['sheet:capa', 'form:capa.nonconformity']);
  });

  it('flags and turns off automations that send data out', () => {
    const m: PackManifest = {
      ...pack('start-capa'),
      automations: [
        {
          ref: 'hook',
          sheet: 'capa',
          name: 'Tell the ticket system',
          enabled: true,
          trigger: { type: 'item_created' },
          conditions: [],
          actions: [{ type: 'webhook', url: 'https://example.com/hook' }],
        },
      ],
    };
    const part = bundleParts(m).find((p) => p.id === 'automation:hook')!;
    expect(part.flags[0]!.kind).toBe('outbound');
    expect(part.detail).toBe('Created off');
    expect(selectManifest(m, []).automations[0]!.enabled).toBe(false);
  });
});

describe('ticking and unticking', () => {
  const parts = bundleParts(pack('start-capa'));

  it('unticking a sheet leaves out what is on it, with a note', () => {
    const s = togglePart(parts, [], 'sheet:capa', false);
    expect(new Set(s.excluded)).toEqual(new Set(parts.map((p) => p.id)));
    expect(s.note).toMatch(/^Also leaves out 1 form, 1 automation and 1 dashboard that need/);
  });

  it('unticking a form leaves out the automation it starts', () => {
    const s = togglePart(parts, [], 'form:capa.nonconformity', false);
    expect(s.excluded).toEqual(['form:capa.nonconformity', 'automation:reported_add_steps']);
    expect(s.note).toContain('Problem reported');
  });

  it('ticking brings back what a part needs', () => {
    const off = togglePart(parts, [], 'sheet:capa', false).excluded;
    const s = togglePart(parts, off, 'automation:reported_add_steps', true);
    expect(s.excluded).toEqual(['dashboard:capa_overview']);
    expect(s.note).toMatch(/^Also adds back 1 sheet and 1 form/);
  });

  it('closes what the browser sent over dependents and ignores unknown ids', () => {
    expect([...closeExclusions(parts, ['form:capa.nonconformity', 'sheet:nope'])]).toEqual([
      'form:capa.nonconformity',
      'automation:reported_add_steps',
    ]);
  });

  it('counts what is left', () => {
    expect(selectionCounts(parts, ['dashboard:capa_overview'])).toMatchObject({
      sheets: 1,
      forms: 1,
      automations: 1,
      dashboards: 0,
    });
  });
});

describe('the chosen manifest', () => {
  it('plans without the parts left out', () => {
    const m = selectManifest(standalone(), ['dashboard:overview', 'automation:review_due']);
    const plan = planPackInstall(m, snapshot, env);
    expect(plan.state).toBe('ready');
    expect(plan.payload!.dashboards).toHaveLength(0);
    const refs = plan.payload!.automations.map((a) => a.ref);
    expect(refs).toContain('review_failed');
    expect(refs).not.toContain('review_due');
  });

  it('drops folders nobody uses and applies a folder choice', () => {
    const m = pack('start-incident');
    expect(selectManifest(m, ['sheet:incident']).folders).toEqual([]);
    const none = selectManifest(m, [], { mode: 'none' });
    expect(none.folders).toEqual([]);
    expect(none.sheets[0]!.folder).toBeUndefined();
    const chosen = selectManifest(m, [], { mode: 'folder', name: 'Operations' });
    expect(chosen.folders).toEqual([{ ref: 'chosen_folder', name: 'Operations' }]);
    const plan = planPackInstall(chosen, snapshot, env);
    expect(plan.preview.folders).toEqual([{ name: 'Operations', action: 'reuse' }]);
  });

  it('keeps a pack with a restricted folder in its own folders', () => {
    const m: PackManifest = {
      ...pack('start-incident'),
      folders: [{ ref: 'audit_and_capa', name: 'Audit and CAPA', restricted: true }],
    };
    expect(canChooseFolder(m)).toBe(false);
    expect(selectManifest(m, [], { mode: 'none' }).folders).toHaveLength(1);
  });

  it('drops setup steps on a left-out sheet and counts the app screens that stay', () => {
    const iso = manifestAtLevel(pack('iso-27001'), 'full');
    const sheet = iso.sheets.find((s) =>
      iso.setup?.steps.some((st) => st.target.sheetRef === s.ref),
    )!;
    const chosen = selectManifest(iso, [`sheet:${sheet.ref}`]);
    expect(chosen.setup!.steps.every((st) => st.target.sheetRef !== sheet.ref)).toBe(true);
    const capa = pack('start-capa');
    expect(appsAfter(capa, [])).toEqual([{ title: 'CAPA', screens: 6 }]);
    expect(appsAfter(capa, ['dashboard:capa_overview'])).toEqual([{ title: 'CAPA', screens: 5 }]);
    expect(appsAfter(capa, ['sheet:capa'])).toEqual([]);
  });
});

describe('bundle entries of the activity log', () => {
  it('reads as sentences', () => {
    const v = { name: 'Customer complaints', title: 'Corrective action (CAPA)', version: '1.1.0' };
    expect(packLogText('bundle.created', v)).toBe(
      'Created Customer complaints via Create from Corrective action (CAPA) 1.1.0.',
    );
    expect(packLogText('bundle.reviewed', v)).toBe('Marked Customer complaints reviewed.');
  });
});
