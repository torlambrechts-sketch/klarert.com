import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extendsAgainst, neededLevel } from '@/engine/packs/extend';
import { afterInstall, installedStateOf } from '@/engine/packs/installed.fixture';
import { planPackInstall } from '@/engine/packs/plan';
import { planPackUpgrade, upgradeLines } from '@/engine/packs/upgrade';
import type { Json } from '@/engine/types';
import { core, emptySnapshot, env, libraryItems, packByKey, packs } from './addon.fixture';
import { parsePack } from './manifest';
import { packQualityProblems } from './quality';

// Core registers 1.1.0 (docs/11 Core registers): the add-on builders' suggestions (approval workflows, Context and
// interested parties, a shared Requirements column, description fields, residual risk, review inputs, tab sets, a
// Suppliers register), the quality bar, and the update from 1.0.0 with ISO/IEC 27001 2.0.0 and Supplier management
// 2.0.0 installed on top.

const core100 = parsePack(
  JSON.parse(
    readFileSync(join(process.cwd(), 'src/lib/packs/fixtures/core-1.0.0.json'), 'utf8'),
  ) as unknown,
);
const sheet = (ref: string) => core.sheets.find((s) => s.ref === ref)!;
const keys = (ref: string) => sheet(ref).fields.map((f) => f.key);

describe('Core registers 1.1.0', () => {
  it('is a minor version of 1.0.0 that meets the pack quality bar', () => {
    expect(core.version).toBe('1.1.0');
    expect(core100.version).toBe('1.0.0');
    expect(packQualityProblems(core)).toEqual([]);
    expect(packQualityProblems(core100).length).toBeGreaterThan(0);
  });

  it('keeps every sheet, field and type of 1.0.0, every view in its place and every sheet at its level', () => {
    for (const s of core100.sheets) {
      const t = sheet(s.ref);
      for (const f of s.fields)
        expect(t.fields.find((x) => x.key === f.key)?.type, f.key).toBe(f.type);
      // views are matched by position (`<sheet>.view.<n>`): new views only ever come last
      expect(t.views.slice(0, s.views.length).map((v) => v.name)).toEqual(
        s.views.map((v) => v.name),
      );
      // an install at Starter keeps every Starter sheet of 1.0.0; Full stays Full
      if (s.level === 'full') expect(t.level, s.ref).toBe('full');
      else expect([undefined, 'starter']).toContain(t.level);
    }
  });

  it('declares document approval, risk acceptance and CAPA closure as approval workflows', () => {
    expect(sheet('documents').workflows!.map((w) => w.id)).toEqual(['document-approval']);
    expect(sheet('risk').workflows!.map((w) => w.id)).toEqual(['risk-acceptance']);
    const capa = sheet('nc').workflows![0]!;
    expect(capa.id).toBe('capa-closure');
    // closing needs a verified effect, checked by someone named on the record
    expect(capa.requiredFields).toEqual(expect.arrayContaining(['root_cause', 'effective']));
    expect(capa.steps[0]!.approvers).toEqual({ kind: 'field', fieldKey: 'verifier' });
    expect(capa.statusField).toMatchObject({ fieldKey: 'stage', onApproved: 'opt_closed' });
  });

  it('adds Context and interested parties (Management system) and Suppliers (Suppliers)', () => {
    const ctx = sheet('context');
    expect([ctx.folder, ctx.kind, ctx.level]).toEqual(['management', 'register', undefined]);
    expect(ctx.groups.map((g) => g.ref)).toEqual(['internal', 'external', 'parties', 'scope']);
    expect(ctx.fields.find((f) => f.key === 'risks')?.config).toMatchObject({
      targetSheetRef: 'risk',
      inverseKey: 'context',
    });
    const sup = sheet('suppliers');
    expect([sup.folder, sup.kind, sup.level]).toEqual(['suppliers', 'register', 'starter']);
    expect(keys('suppliers')).toEqual(
      expect.arrayContaining(['owner', 'criticality', 'status', 'standards']),
    );
  });

  it('has one shared Requirements column (any adopted library, several) on the registers', () => {
    for (const ref of [
      'context',
      'documents',
      'objectives',
      'risk',
      'controls',
      'legal',
      'audits',
      'incidents',
      'nc',
      'suppliers',
    ]) {
      const f = sheet(ref).fields.find((x) => x.key === 'requirements');
      expect(f?.type, ref).toBe('requirement');
      expect(f?.config, ref).toEqual({ multiple: true });
    }
  });

  it('describes nonconformities and incidents, scores residual risk and ticks review inputs', () => {
    expect(keys('nc')).toEqual(expect.arrayContaining(['details', 'found_on']));
    expect(sheet('incidents').fields.find((f) => f.key === 'noticed_at')?.type).toBe('datetime');
    expect(keys('incidents')).toContain('what_happened');
    expect(keys('risk')).toEqual(
      expect.arrayContaining([
        'residual_likelihood',
        'residual_impact',
        'residual_score',
        'residual_against_appetite',
      ]),
    );
    const inputs = sheet('reviews').fields.filter((f) => f.type === 'check');
    expect(inputs.map((f) => f.key)).toContain('input_actions');
    expect(inputs).toHaveLength(10);
  });

  it('gives every sheet a kind and a tab set of at most four visible tabs', () => {
    for (const s of core.sheets) {
      expect(s.kind, s.ref).toBeTruthy();
      expect(s.tabs!.filter((t) => !t.hidden).length, s.ref).toBeLessThanOrEqual(4);
    }
  });

  it('still carries every add-on: their extensions fit and the Starter add-ons need no more than Starter', () => {
    for (const p of packs.filter((x) => x.requires.some((r) => r.pack === 'core')))
      expect(extendsAgainst(p, core), p.key).toEqual([]);
    expect(neededLevel(packByKey('supplier-management'), core)).toBe('starter');
    expect(neededLevel(packByKey('gdpr'), core, null)).toBe('starter');
    expect(neededLevel(packByKey('iso-9001'), core, 'starter')).toBe('starter');
    expect(neededLevel(packByKey('iso-27001'), core)).toBe('full');
  });
});

describe('updating Core 1.0.0 → 1.1.0 with ISO/IEC 27001 2.0.0 and Supplier management 2.0.0 installed', () => {
  const iso27001 = packByKey('iso-27001');
  const suppliers = packByKey('supplier-management');
  const libraries = (iso27001.frameworks ?? []).map((f) => ({
    library: `${f.key}@${f.version}`,
    sheetId: `lib:${f.key}@${f.version}`,
  }));
  const coreHash = 'h-core-100';
  const coreP = planPackInstall(
    core100,
    emptySnapshot({ libraries }),
    { ...env, hash: coreHash },
    { level: 'full' },
  ).payload!;
  const withCore = afterInstall(
    emptySnapshot({
      libraries,
      requirementItems: Object.assign(
        {},
        ...(iso27001.frameworks ?? []).map((f) => libraryItems(f.key, f.version)),
      ) as Record<string, string>,
    }),
    coreP,
    'inst-core',
  );
  const isoP = planPackInstall(iso27001, withCore, env).payload!;
  const withIso = afterInstall(withCore, isoP, 'inst-27001');
  const supP = planPackInstall(suppliers, withIso, env).payload!;
  const all = afterInstall(withIso, supP, 'inst-sup');
  const state = installedStateOf(coreP, 'inst-core', [isoP, supP]);
  const plan = () =>
    planPackUpgrade({
      from: { manifest: core100, hash: coreHash },
      to: { manifest: core, hash: 'h-core-110' },
      state,
      // Core requires no pack: the server reads no foreign sheets for it
      snapshot: { ...all, foreign: {}, foreignFolders: {} },
      env,
      extenders: [
        { title: iso27001.title, manifest: iso27001 },
        { title: suppliers.title, manifest: suppliers },
      ],
    });

  it('is ready: nothing the add-ons use is removed, no conflicts', () => {
    const p = plan();
    expect(p.preview.blockers).toEqual([]);
    expect(p.state).toBe('ready');
    expect(p.preview.conflicts).toEqual([]);
    expect(p.preview.archived).toEqual([]);
  });

  it('adds the new sheets, columns, automations and forms after what the add-ons put there', () => {
    const p = plan();
    const added = p.preview.added.map((a) => `${a.kind}:${a.ref}`);
    expect(added).toEqual(
      expect.arrayContaining([
        'sheet:context',
        'sheet:suppliers',
        'field:documents.requirements',
        'field:risk.residual_score',
        'field:nc.details',
        'field:incidents.noticed_at',
        'field:reviews.input_actions',
        'form:incidents.form.report',
        'form:nc.form.report',
        'automation:document_approved',
        'automation:risk_accepted',
      ]),
    );
    // the risk register gets its Context column, the inverse of the new sheet's link
    expect(p.payload!.add.fields.find((f) => f.ref === 'risk.context')?.type).toBe('link');
    // new columns go after the sheet's last column, the add-ons' columns included
    const riskId = state.refMap['sheet:risk']!;
    const last = state.lastPosition.fields[riskId]!;
    for (const f of p.payload!.add.fields.filter((x) => x.sheet_id === riskId))
      expect(String(f.position) > last, `${String(f.ref)} ${String(f.position)} ${last}`).toBe(
        true,
      );
  });

  it('puts the approval workflows on Documents, the Risk register and Nonconformities, and the tab sets', () => {
    const p = plan();
    const flows = new Map(
      (p.payload!.update.workflows ?? []).map((w) => [w.sheet_id, w.workflows as Json[]]),
    );
    const ids = (ref: string) =>
      (flows.get(state.refMap[`sheet:${ref}`]!) ?? []).map((w) => (w as { id: string }).id);
    expect(ids('documents')).toEqual(['document-approval']);
    expect(ids('risk')).toEqual(['risk-acceptance']);
    expect(ids('nc')).toEqual(['capa-closure']);
    const tabs = (p.payload!.update.tabs ?? []).map((t) => t.sheet_id);
    expect(tabs).toContain(state.refMap['sheet:documents']);
    expect(tabs).toHaveLength(core100.sheets.length);
    expect(upgradeLines(p.preview)).toContain(
      'Changes sheet Documents and policies: Description, approval workflows and tabs.',
    );
  });

  it('keeps a workflow an add-on put on a Core sheet; one the client made is a conflict', () => {
    const docs = state.sheets.find((s) => s.ref === 'documents')!;
    const addOn = { id: 'iso27001_isms_sign_off', name: 'ISMS sign-off', enabled: true, steps: [] };
    docs.workflows = [addOn as unknown as Json];
    const kept = plan();
    const written = kept.payload!.update.workflows!.find((w) => w.sheet_id === docs.id)!;
    expect((written.workflows as { id: string }[]).map((w) => w.id)).toEqual([
      'document-approval',
      'iso27001_isms_sign_off',
    ]);
    // a workflow the client made is the client's change: a conflict, kept by default
    docs.workflows = [{ id: 'our-approval', name: 'Our approval', enabled: true, steps: [] }];
    const conflict = plan();
    expect(conflict.preview.conflicts.map((c) => c.id)).toContain('sheet:documents');
    docs.workflows = [];
  });

  it('leaves a tab set the client customised as a conflict', () => {
    const risk = state.sheets.find((s) => s.ref === 'risk')!;
    risk.tabs = { tabs: [{ id: 'table' }, { id: 'kanban', hidden: true }], defaultViewId: null };
    const p = plan();
    expect(p.preview.conflicts.find((c) => c.id === 'sheet:risk')?.attributes).toEqual(['tabs']);
    expect((p.payload!.update.tabs ?? []).some((t) => t.sheet_id === risk.id)).toBe(false);
    risk.tabs = null;
  });
});
