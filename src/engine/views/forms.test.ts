import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { publicFormEligible } from '../fields/view-support';
import { makeField } from '../testing/fixtures';
import { formLayoutSchema, parseViewConfig, type FormLayout } from './config';
import {
  asNewCopy,
  defaultFormLayout,
  formFieldChoices,
  formFingerprint,
  formLayoutProblems,
  formQuestions,
  formState,
  mapFormToSheet,
  needsConsent,
  nextNotice,
  noticeProblems,
  noticeReviewed,
  openProblems,
  privacyWarnings,
} from './form';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const f = {
  where: makeField('text', {}, { key: 'where_seen', name: 'Where', position: 'a0' }),
  what: makeField('longtext', {}, { key: 'description', name: 'Description', position: 'a1' }),
  owner: makeField('people', { multiple: true }, { key: 'owner', name: 'Owner', position: 'a2' }),
  email: makeField('email', {}, { key: 'reporter_email', name: 'Your email', position: 'a3' }),
  injury: makeField('text', {}, { key: 'injury', name: 'Injury details', position: 'a4' }),
  channel: makeField('text', {}, { key: 'channel', name: 'Channel', position: 'a5' }),
};
const fields = Object.values(f);

const notice = {
  purpose: 'Safety reports',
  legalBasis: 'legal_obligation' as const,
  recipients: 'HSE team',
  retention: '5 years',
  rights: 'Ask privacy@example.com',
};
const publicForm = (extra: Partial<FormLayout> = {}): FormLayout => ({
  fields: [{ key: 'where_seen' }, { key: 'description' }],
  status: 'open',
  access: 'public',
  ...extra,
});

describe('form settings (Zod)', () => {
  it('accepts every setting and keeps a legacy layout', () => {
    const r = formLayoutSchema.safeParse({
      ...publicForm(),
      opensAt: '2026-11-13T08:00:00.000Z',
      closesAt: null,
      maxResponses: 50,
      confirmation: 'Thank you. We read every report.',
      notify: ['00000000-0000-0000-0000-000000000001'],
      prefill: [{ key: 'channel', value: 'QR poster' }],
      notice: { ...notice, url: 'https://example.com/privacy', version: 2, reviewedVersion: 2 },
    });
    expect(r.success).toBe(true);
    expect(parseViewConfig({ form: { fields: [{ key: 'where_seen' }] } }).form).toEqual({
      fields: [{ key: 'where_seen' }],
    });
  });

  it('refuses unknown states, people that are not ids and web addresses that are not links', () => {
    expect(formLayoutSchema.safeParse({ fields: [], status: 'live' }).success).toBe(false);
    expect(formLayoutSchema.safeParse({ fields: [], access: 'everyone' }).success).toBe(false);
    expect(formLayoutSchema.safeParse({ fields: [], notify: ['maria'] }).success).toBe(false);
    expect(formLayoutSchema.safeParse({ fields: [], maxResponses: 0 }).success).toBe(false);
    expect(
      formLayoutSchema.safeParse({ fields: [], notice: { url: 'javascript:alert(1)' } }).success,
    ).toBe(false);
  });

  it('a new form is a draft with the fields its access allows', () => {
    const pub = defaultFormLayout(fields, 'public');
    expect(pub.status).toBe('draft');
    expect(pub.fields.map((q) => q.key)).not.toContain('owner');
    expect(defaultFormLayout(fields, 'internal').fields.map((q) => q.key)).toContain('owner');
  });
});

describe('public forms: no files, no directory', () => {
  it('leaves people out of public forms and says why', () => {
    expect(publicFormEligible(f.owner)).toBe(false);
    expect(publicFormEligible(f.where)).toBe(true);
    expect(formFieldChoices(fields, 'public').map((x) => x.key)).not.toContain('owner');
    const layout = publicForm({ fields: [{ key: 'owner' }] });
    expect(formLayoutProblems(layout, fields)).toEqual([
      'Owner cannot be asked on a public form. Make the form internal or remove it.',
    ]);
    expect(formQuestions(layout, fields)).toEqual([]);
  });

  it('a hidden value cannot also be a question and must be a real field', () => {
    const layout = publicForm({
      prefill: [
        { key: 'where_seen', value: 'x' },
        { key: 'gone', value: 'x' },
      ],
    });
    expect(formLayoutProblems(layout, fields)).toEqual([
      'Where is asked on the form and cannot also be hidden.',
      'Hidden value: field "gone" no longer exists.',
    ]);
  });

  it('checks opening and closing times', () => {
    expect(
      formLayoutProblems(
        publicForm({ opensAt: '2026-11-14T00:00:00Z', closesAt: '2026-11-13T00:00:00Z' }),
        fields,
      ),
    ).toEqual(['The closing time must be after the opening time.']);
  });
});

describe('the privacy notice gates opening a public form', () => {
  it('a public form needs a complete notice, then a review', () => {
    expect(openProblems(publicForm(), fields)).toEqual([
      'The privacy notice needs the purpose, the legal basis, who receives the answers, how long answers are kept, people’s rights and a contact.',
    ]);
    expect(openProblems(publicForm({ notice: { ...notice } }), fields)).toEqual([
      'An owner or admin must mark the privacy notice as reviewed.',
    ]);
    const reviewed = publicForm({ notice: { ...notice, version: 1, reviewedVersion: 1 } });
    expect(noticeReviewed(reviewed.notice)).toBe(true);
    expect(openProblems(reviewed, fields)).toEqual([]);
  });

  it('an internal form opens without a notice', () => {
    expect(openProblems(publicForm({ access: 'internal' }), fields)).toEqual([]);
  });

  it('names the parts that are missing', () => {
    expect(noticeProblems({ ...notice, retention: ' ' })).toEqual([
      'The privacy notice needs how long answers are kept.',
    ]);
  });

  it('asks for consent only when the legal basis is consent', () => {
    expect(needsConsent(publicForm({ notice: { ...notice, legalBasis: 'consent' } }))).toBe(true);
    expect(needsConsent(publicForm({ notice }))).toBe(false);
    expect(
      needsConsent(publicForm({ access: 'internal', notice: { ...notice, legalBasis: 'consent' } })),
    ).toBe(false);
  });
});

describe('form state', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const open = publicForm({ notice: { ...notice, version: 1, reviewedVersion: 1 } });
  it('draft, open, closed, not open yet, full', () => {
    expect(formState({ fields: [] }, now, 0)).toBe('draft');
    expect(formState(open, now, 0)).toBe('open');
    expect(formState({ ...open, notice: { ...notice } }, now, 0)).toBe('draft');
    expect(formState({ ...open, status: 'closed' }, now, 0)).toBe('closed');
    expect(formState({ ...open, opensAt: '2026-11-14T00:00:00Z' }, now, 0)).toBe('scheduled');
    expect(formState({ ...open, closesAt: '2026-11-13T11:59:00Z' }, now, 0)).toBe('closed');
    expect(formState({ ...open, maxResponses: 3 }, now, 3)).toBe('full');
    expect(formState({ ...open, maxResponses: 3 }, now, 2)).toBe('open');
  });
});

describe('version and fingerprint', () => {
  it('changing the notice words makes a new, unreviewed version', () => {
    const before = { ...notice, version: 2, reviewedVersion: 2, reviewedAt: 'x', reviewedBy: 'y' };
    expect(nextNotice(before, { ...before })).toMatchObject({ version: 2, reviewedVersion: 2 });
    const changed = nextNotice(before, { ...before, purpose: 'Something else' });
    expect(changed.version).toBe(3);
    expect(changed.reviewedVersion).toBeUndefined();
    expect(noticeReviewed(changed)).toBe(false);
  });

  it('the fingerprint ignores key order and the review stamp, and follows every edit', () => {
    const a = publicForm({ notice: { ...notice, version: 1 } });
    const b: FormLayout = JSON.parse(JSON.stringify({ access: a.access, ...a }));
    expect(formFingerprint('Report', a)).toBe(formFingerprint('Report', b));
    expect(
      formFingerprint('Report', {
        ...a,
        notice: { ...a.notice!, reviewedVersion: 1, reviewedAt: 'now' },
      }),
    ).toBe(formFingerprint('Report', a));
    expect(formFingerprint('Report', { ...a, title: 'New' })).not.toBe(formFingerprint('Report', a));
    expect(formFingerprint('Renamed', a)).not.toBe(formFingerprint('Report', a));
    expect(formFingerprint('Report', a)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('duplicate and copy to another sheet', () => {
  const reviewed = publicForm({
    groupId: 'g-src-triage',
    fields: [{ key: 'where_seen', label: 'Where was it?' }, { key: 'description' }, { key: 'injury' }],
    prefill: [{ key: 'channel', value: 'QR' }],
    notice: { ...notice, version: 3, reviewedVersion: 3, reviewedAt: 'then', reviewedBy: 'u1' },
  });

  it('a copy is a draft whose notice needs a new review', () => {
    const c = asNewCopy(reviewed);
    expect(c.status).toBe('draft');
    expect(c.notice).toEqual({ ...notice, version: 1 });
    expect(c.fields).toEqual(reviewed.fields);
  });

  it('maps questions by key and reports the ones the target lacks', () => {
    const target = {
      fields: [
        makeField('text', {}, { key: 'where_seen', name: 'Location', position: 'a0' }),
        makeField('text', {}, { key: 'channel', name: 'Channel', position: 'a1' }),
      ],
      groups: [
        { id: 'g-dst-new', name: 'New' },
        { id: 'g-dst-triage', name: 'Triage' },
      ],
    };
    const src = {
      fields,
      groups: [
        { id: 'g-src-new', name: 'New' },
        { id: 'g-src-triage', name: 'Triage' },
      ],
    };
    const r = mapFormToSheet(reviewed, src, target);
    expect(r.missing).toEqual(['Description', 'Injury details']);
    expect(r.form.fields).toEqual([{ key: 'where_seen', label: 'Where was it?' }]);
    expect(r.form.prefill).toEqual([{ key: 'channel', value: 'QR' }]);
    expect(r.form.groupId).toBe('g-dst-triage');
    expect(r.form.status).toBe('draft');
    expect(noticeReviewed(r.form.notice)).toBe(false);
  });
});

describe('privacy warnings', () => {
  it('warns about contact details and special-category data', () => {
    const qs = formQuestions(
      { fields: [{ key: 'reporter_email' }, { key: 'injury' }], access: 'internal' },
      fields,
    );
    expect(privacyWarnings(qs, 'Incident')).toEqual([
      'This form collects names or contact details. Ask only for what you need.',
      'This form may collect health or other special-category data (Injury details). Don’t include health data unless needed.',
    ]);
    expect(privacyWarnings(formQuestions(publicForm(), fields), 'Incident')).toEqual([]);
    expect(privacyWarnings([], 'Your name')).toEqual([
      'This form collects names or contact details. Ask only for what you need.',
    ]);
  });
});
