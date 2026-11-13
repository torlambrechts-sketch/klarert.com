import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STARTS, startById, startFieldKeys } from '@/lib/starts';
import { planTemplateImport, type PlanEnv } from './plan';
import { parseTemplate, sheetTemplateSchema } from './schema';

// Forms in templates and starts (docs/05 §3.3): groupRef, the fields asked, form refs and form_submitted.formId.

const raw = JSON.parse(
  readFileSync(new URL('../../../templates/first-sheet.json', import.meta.url), 'utf8'),
);
const base = parseTemplate(raw);
const sheet0 = raw.sheets[0];
const groupRef: string = sheet0.groups[0].ref;
const keys: string[] = sheet0.fields
  .filter((f: { type: string }) => ['text', 'longtext', 'date'].includes(f.type))
  .map((f: { key: string }) => f.key);

const withForms = (forms: unknown[], automations: unknown[] = []) => ({
  ...raw,
  sheets: [{ ...sheet0, forms }, ...raw.sheets.slice(1)],
  automations: [...raw.automations, ...automations],
});
const report = {
  ref: 'report',
  name: 'Report a problem',
  groupRef,
  access: 'public',
  layout: { fields: [{ key: keys[0] }] },
  notice: {
    purpose: 'P',
    legalBasis: 'consent',
    recipients: 'R',
    retention: '1 year',
    rights: 'Ask us',
  },
};
const issues = (t: unknown) => {
  const r = sheetTemplateSchema.safeParse(t);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('template forms', () => {
  it('accepts a form with a known group and fields', () => {
    expect(issues(withForms([report]))).toEqual([]);
  });

  it('reports unknown groups, fields, hidden values and duplicate refs', () => {
    expect(
      issues(
        withForms([
          { ...report, groupRef: 'nowhere' },
          {
            ...report,
            layout: { fields: [{ key: 'gone' }] },
            settings: { prefill: [{ key: 'also_gone', value: 1 }] },
          },
        ]),
      ),
    ).toEqual([
      'Unknown group "nowhere".',
      'Duplicate form ref "report".',
      'Unknown field "gone".',
      'Unknown field "also_gone".',
    ]);
  });

  it('form_submitted.formId must name a form of the same sheet', () => {
    const auto = (formId: unknown) => ({
      sheet: sheet0.ref,
      name: 'On report',
      trigger: { type: 'form_submitted', formId },
      actions: [{ type: 'notify', to: [], message: 'New report' }],
    });
    expect(issues(withForms([report], [auto('report')]))).toEqual([]);
    expect(issues(withForms([report], [auto(null)]))).toEqual([]);
    expect(issues(withForms([report], [auto('elsewhere')]))).toEqual(['Unknown form "elsewhere".']);
  });

  it('plans a form as a draft form view whose notice needs a review, and resolves the trigger ref', () => {
    let n = 0;
    const env: PlanEnv = {
      orgId: 'org-1',
      folderId: null,
      people: base.people.map((p) => ({
        ref: p.ref,
        id: `user-${p.ref}`,
        name: p.name,
        initials: p.initials,
        color: 'blue',
        email: p.email,
      })),
      today: '2026-11-13',
      now: new Date('2026-11-13T09:00:00Z'),
      timeZone: 'Europe/London',
      newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
      lastSheetPosition: null,
      jobRoles: [
        { id: 'role-cm', name: 'Compliance manager' },
        { id: 'role-hse', name: 'HSE manager' },
      ],
      teams: [],
    };
    const t = parseTemplate(
      withForms(
        [report],
        [
          {
            sheet: sheet0.ref,
            name: 'On report',
            trigger: { type: 'form_submitted', formId: 'report' },
            actions: [{ type: 'notify', to: ['$person:' + base.people[0]!.ref], message: 'New' }],
          },
        ],
      ),
    );
    const plan = planTemplateImport(t, env);
    const s = plan.sheets[0]!;
    const view = s.views.find((v) => v.type === 'form')!;
    const form = (view.config as { form: Record<string, unknown> }).form;
    expect(form).toMatchObject({
      status: 'draft',
      access: 'public',
      groupId: s.groups[0]!.id,
      notice: { version: 1, legalBasis: 'consent' },
    });
    expect((form.notice as Record<string, unknown>).reviewedVersion).toBeUndefined();
    const a = plan.automations.find((x) => x.name === 'On report')!;
    expect((a.trigger as { formId: string }).formId).toBe(view.id);
  });
});

describe('ready-made forms in the starts', () => {
  it('Incident has a public report form and an internal intake; CAPA, audit and register have theirs', () => {
    const names = (id: string) => (startById(id)?.forms ?? []).map((f) => `${f.name} (${f.access})`);
    expect(names('incident')).toEqual([
      'Report an incident or near miss (public)',
      'Investigator intake (internal)',
    ]);
    expect(names('capa')).toEqual(['Raise a nonconformity (internal)']);
    expect(names('audit')).toEqual(['Audit finding (internal)']);
    expect(names('register')).toEqual([
      'Supplier self-assessment (public)',
      'Training attendance (public)',
    ]);
  });

  it('every start form names its own columns and groups, and public ones ship a notice to review', () => {
    for (const s of STARTS) {
      const own = new Set(startFieldKeys(s.fields ?? []));
      for (const f of s.forms ?? []) {
        for (const q of f.layout.fields) expect(own.has(q.key), `${s.id}: ${q.key}`).toBe(true);
        expect(s.groups).toContain(f.groupRef);
        if (f.access === 'public') expect(f.notice?.purpose).toBeTruthy();
      }
    }
  });
});
