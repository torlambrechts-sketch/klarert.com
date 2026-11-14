import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { planPackInstall, previewLines, type PackSnapshot } from '@/engine/packs';
import { parseTemplate } from '@/lib/templates/schema';
import { startById } from '@/lib/starts';
import { repoPacks } from './catalogue';
import { canonicalJson, packHash } from './hash';
import { startToPack, templateToPack } from './wrap';

const snapshot = (over: Partial<PackSnapshot> = {}): PackSnapshot => ({
  orgId: 'org-1',
  prefixes: [],
  folders: [],
  installs: [],
  members: [
    {
      id: 'u-maria',
      name: 'Maria Pereira',
      initials: 'MP',
      color: 'blue',
      email: 'maria@example.com',
    },
  ],
  jobRoles: [],
  teams: [],
  lastSheetPosition: null,
  lastFolderPosition: null,
  lastDashboardPosition: null,
  ...over,
});
const env = {
  today: '2026-11-13',
  now: new Date('2026-11-13T10:00:00Z'),
  timeZone: 'Europe/London',
  newId: randomUUID,
  hash: 'h',
  userId: 'u-maria',
};

describe('repository packs', () => {
  it('parse, have unique keys and hash the same however they are written', () => {
    const packs = repoPacks();
    expect(packs.map((p) => p.key)).toEqual([
      'first-sheet-corrective-actions',
      'supplier-management',
      'iso-27001',
      'iso-9001',
      'gdpr',
      'start-capa',
      'start-documents',
    ]);
    for (const p of packs) expect(packHash(p)).toBe(packHash(JSON.parse(JSON.stringify(p))));
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: null }] })).toBe('{"a":[{"c":null,"d":2}],"b":1}');
  });

  it('every one plans into an empty workspace', () => {
    for (const p of repoPacks()) {
      const plan = planPackInstall(p, snapshot(), env);
      expect(plan.preview.conflicts, p.key).toEqual([]);
      expect(plan.state).toBe('ready');
    }
  });
});

describe('templateToPack', () => {
  const t = parseTemplate(
    JSON.parse(
      readFileSync(new URL('../../../templates/first-sheet.json', import.meta.url), 'utf8'),
    ),
  );
  const m = templateToPack(t, { version: '1.0.0', title: 'First sheet' });

  it('gives folders, items and automations refs and links items by ref', () => {
    expect(m.folders).toEqual([{ ref: 'your_sheets', name: 'Your sheets' }]);
    expect(m.sheets.map((s) => s.folder)).toEqual(['your_sheets', 'your_sheets']);
    const act = m.sheets.find((s) => s.ref === 'act')!;
    expect(act.items[0]).toMatchObject({
      ref: 'deburr_lot_2210_and_re_inspect',
      links: { corrective_action: ['burrs_on_bracket_44_210'] },
    });
    expect(m.automations.map((a) => a.ref)).toContain('done_move_to_closed_and_lock');
  });

  it('plans the same sheets, links and automations as the template', () => {
    const plan = planPackInstall(
      m,
      snapshot({
        members: [
          {
            id: 'u-maria',
            name: 'Maria',
            initials: 'MP',
            color: 'blue',
            email: 'maria@example.com',
          },
          { id: 'u-tom', name: 'Tom', initials: 'TK', color: 'teal', email: 'tom@example.com' },
          {
            id: 'u-james',
            name: 'James',
            initials: 'JO',
            color: 'teal',
            email: 'james@example.com',
          },
        ],
        jobRoles: [
          { id: 'r1', name: 'Compliance manager' },
          { id: 'r2', name: 'HSE manager' },
        ],
      }),
      env,
    );
    expect(plan.preview.warnings).toEqual([]);
    expect(plan.payload!.links).toHaveLength(4);
    expect(plan.payload!.automations).toHaveLength(9);
    expect(plan.payload!.automations.every((a) => a.enabled)).toBe(true);
    expect(previewLines(plan.preview)[0]).toBe(
      'Installs 1 folder, 2 sheets, 25 fields, 6 views, 7 example items, 4 links and 9 automations.',
    );
  });
});

describe('startToPack', () => {
  it('turns a start into the one sheet the wizard makes, forms grouped by ref', () => {
    const m = startToPack(startById('capa')!);
    expect(m.key).toBe('start-capa');
    expect(m.folders).toEqual([{ ref: 'audit_and_capa', name: 'Audit and CAPA' }]);
    const s = m.sheets[0]!;
    expect(s.fields.map((f) => f.key)).toEqual([
      'owner',
      'status',
      'severity',
      'found_on',
      'due_date',
      'description',
    ]);
    expect(s.groups.map((g) => g.ref)).toEqual(['open', 'closed']);
    expect(s.forms[0]!.groupRef).toBe('open');
    expect(s.subitems?.label).toBe('Actions');
  });

  it('keeps a documents register and its status rules', () => {
    const s = startToPack(startById('documents')!).sheets[0]!;
    expect(s.register).toBe('documents');
    expect(s.fields.find((f) => f.key === 'status')!.rules!.map((r) => r.id)).toEqual([
      'approve_note',
      'leave_approved',
    ]);
  });
});
