import { describe, expect, it } from 'vitest';
import { repoApps, repoPacks, withApps } from '@/lib/packs/catalogue';
import { parsePack } from '@/lib/packs/manifest';
import { appManifestSchema, appProblems, parseAppFile } from './manifest';

const pack = () => repoPacks().find((p) => p.key === 'start-capa')!;
const capa = () => pack().apps!.find((a) => a.key === 'capa')!;

describe('app manifest', () => {
  it('the CAPA app joins the CAPA pack and every ref resolves', () => {
    const p = pack();
    expect(p.version).toBe('1.1.0');
    const app = capa();
    expect(app.sections.flatMap((s) => s.screens.map((x) => [x.key, x.kind]))).toEqual([
      ['report', 'form'],
      ['my-actions', 'item'],
      ['approvals', 'item'],
      ['all', 'view'],
      ['overview', 'dashboard'],
      ['workflow', 'workflow'],
    ]);
    expect(appProblems(app, p)).toEqual([]);
    // the pack adds the steps when a problem is reported, and its overview dashboard
    expect(p.automations.map((a) => a.ref)).toEqual(['reported_add_steps']);
    expect(p.dashboards.map((d) => d.ref)).toEqual(['capa_overview']);
  });

  it('the ISO 27001 add-on ships its own CAPA app over the Core registers', () => {
    const iso = repoPacks().find((p) => p.key === 'iso-27001')!;
    const core = repoPacks().find((p) => p.key === 'core')!;
    expect(iso.version).toBe('2.2.0');
    const app = iso.apps!.find((a) => a.key === 'isms-capa')!;
    expect(appProblems(app, iso)).toEqual([]);
    expect(appProblems(app, iso, [core])).toEqual([]);
    expect(app.sections[0]!.screens.map((s) => s.title)).toEqual([
      'Report a problem',
      'My actions',
      'Needs my check',
    ]);
    // a Core column that does not exist is named when Core's manifest is at hand
    const bad = JSON.parse(JSON.stringify(app));
    bad.sections[0].screens[2].filters[1].fieldKey = 'status';
    expect(appProblems(bad, iso, [core]).map((p) => p.message)).toEqual([
      'Unknown field "status".',
    ]);
    // only packs it requires, and only forms its extends add
    bad.sections[0].screens[2].sheet = 'gdpr:breach';
    bad.sections[0].screens[0].form = 'report';
    expect(appProblems(bad, iso).map((p) => p.message)).toEqual([
      'Unknown form "report" on "core:nc".',
      '"gdpr:breach" is not a sheet of a pack this one requires.',
    ]);
  });

  it('refuses unknown kinds, icons, roles, operators and duplicate screens', () => {
    const base = capa();
    const bad = (patch: (a: Record<string, unknown>) => void) => {
      const a = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      patch(a);
      return appManifestSchema.safeParse(a).success;
    };
    type S = { sections: { screens: Record<string, unknown>[] }[] };
    expect(bad(() => {})).toBe(true);
    expect(bad((a) => (a.icon = 'rocket'))).toBe(false);
    expect(bad((a) => (a.roles = ['editor']))).toBe(false);
    expect(bad((a) => ((a as unknown as S).sections[0]!.screens[0]!.kind = 'page'))).toBe(false);
    expect(
      bad((a) => {
        const s = (a as unknown as S).sections[0]!.screens[1]!;
        (s.filters as { op: string }[])[0]!.op = 'is_mine';
      }),
    ).toBe(false);
    expect(
      bad((a) => {
        const s = a as unknown as S;
        s.sections[0]!.screens[1]!.key = 'report';
      }),
    ).toBe(false);
  });

  it('names every ref the pack does not have', () => {
    const app = JSON.parse(JSON.stringify(capa()));
    app.sections[0].screens[0].form = 'complaint';
    app.sections[0].screens[1].filters[0].fieldKey = 'assignee';
    app.sections[0].screens[2].sort = [{ fieldKey: 'when' }];
    app.sections[1].screens[0].view = 'By site';
    app.sections[1].screens[1].dashboard = 'kpis';
    expect(appProblems(app, pack()).map((p) => p.message)).toEqual([
      'Unknown form "complaint" on "capa".',
      'Unknown field "assignee".',
      'Unknown field "when".',
      'Unknown view "By site" on "capa".',
      'Unknown dashboard "kpis".',
    ]);
    const docs = repoPacks().find((p) => p.key === 'start-documents')!;
    const onDocs = JSON.parse(JSON.stringify(capa()));
    onDocs.sections = [{ title: 'Work', screens: [capa().sections[0]!.screens[1]] }];
    onDocs.sections[0].screens[0].sheet = 'documents';
    expect(appProblems(onDocs, docs).map((p) => p.message)).toEqual([
      '"documents" has no sub-items.',
    ]);
    // the pack schema runs the same checks
    expect(() => parsePack({ ...pack(), apps: [app] })).toThrow(/Unknown dashboard "kpis"/);
  });

  it('an app file needs its pack at a version in range', () => {
    const file = repoApps()[0]!;
    expect(file.requires).toEqual({ pack: 'start-capa', range: '^1.1.0' });
    expect(() =>
      parseAppFile({ ...file, requires: { pack: 'start-capa', range: 'latest' } }),
    ).toThrow(/range/);
    const old = { ...pack(), version: '1.0.0', apps: undefined };
    expect(() => withApps([old], [file])).toThrow(/needs start-capa \^1.1.0/);
    expect(() => withApps([], [file])).toThrow(/needs the pack "start-capa"/);
  });
});
