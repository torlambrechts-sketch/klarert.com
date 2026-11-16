import { describe, expect, it } from 'vitest';
import { parseCsv } from '../fields/csv';
import { planEditionMove } from './edition';
import {
  copyStructure,
  DEFAULT_GROUP,
  draftFromFramework,
  editionMappingFor,
  emptyRow,
  importRequirements,
  isOwnFrameworkKey,
  OWN_LIMITS,
  ownFrameworkKey,
  ownFrameworkProblems,
  ownIdPrefix,
  ownKeyPrefix,
  ownLicence,
  publishDecision,
  toFramework,
  trimDraft,
  type DraftRequirement,
  type FrameworkDraft,
} from './own';
import { frameworkToPack, LIBRARY_KEYS } from './pack';
import type { Crosswalk, Requirement } from './types';

const ORG = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const group = (ref: string, title = ref) => emptyRow({ ref, kind: 'theme', title });
const row = (
  ref: string,
  parent: string,
  title = `Title ${ref}`,
  over: Partial<DraftRequirement> = {},
) => emptyRow({ ref, parent, title, ...over });
const messages = (rows: DraftRequirement[]) =>
  ownFrameworkProblems(rows).map((p) => `${p.row ?? '-'}:${p.column ?? '-'}:${p.message}`);

const draftOf = (rows: DraftRequirement[]): FrameworkDraft => ({
  title: 'Acme supplier security schedule',
  shortTitle: 'ACME',
  kind: 'internal',
  requirements: rows,
  mappings: [],
  copiedFrom: null,
});

const asPublished = (rows: DraftRequirement[]): Requirement[] =>
  toFramework(draftOf(rows), {
    key: `${ownKeyPrefix(ORG)}acme`,
    version: '1',
    revision: 1,
    publisher: 'Meridian',
    source: 'Acme MSA, schedule 3',
    today: '2026-11-16',
  }).requirements;

describe('ownFrameworkProblems', () => {
  it('accepts a group with requirements up to 4 levels below it', () => {
    const rows = [
      group('G'),
      row('1', 'G'),
      row('1.1', '1'),
      row('1.1.1', '1.1'),
      row('1.1.1.1', '1.1.1'),
    ];
    expect(ownFrameworkProblems(rows)).toEqual([]);
  });

  it('refuses a fifth level, with the row number', () => {
    const rows = [
      group('G'),
      row('1', 'G'),
      row('1.1', '1'),
      row('1.1.1', '1.1'),
      row('1.1.1.1', '1.1.1'),
      row('1.1.1.1.1', '1.1.1.1'),
    ];
    expect(messages(rows)).toEqual(['6:parent:Too deep: a group and at most 4 levels below it.']);
  });

  it('lists every row problem with its row number and column', () => {
    const rows = [
      group('G', 'Supplier duties'),
      row('', 'G'),
      row('A#1', 'G'),
      row('2', 'G', 'x'.repeat(81)),
      row('2', 'G'),
      row('3', 'Nope'),
      row('4', '', 'Orphan'),
      row('5', 'G', ''),
      row('6', 'G', 'Long text', { text: 'y'.repeat(4001) }),
      row('7', 'G', 'Odd kind', { kind: 'chapter' }),
      emptyRow({ ref: 'H', kind: 'theme', title: 'Group with parent', parent: 'G' }),
      row('8', '8'),
      row('r'.repeat(41), 'G'),
    ];
    expect(messages(rows)).toEqual([
      '2:ref:Give a ref.',
      '3:ref:A ref cannot hold "#" or "@".',
      '4:title:Shorten the title; put the full wording in Text.',
      '5:ref:The ref "2" is used on row 4 too.',
      '6:parent:There is no row with the ref "Nope".',
      '7:parent:Give a parent or put the row in a group.',
      '8:title:Write a title.',
      '9:text:The text has at most 4,000 characters.',
      '10:kind:The kind is clause, control, article, paragraph or theme (a group).',
      '11:parent:A group has no parent.',
      '12:parent:A row cannot be its own parent.',
      `13:ref:A ref has at most ${OWN_LIMITS.ref} characters.`,
    ]);
  });

  it('finds parents that go round in a circle', () => {
    const rows = [group('G'), row('1', 'G'), row('a', 'b'), row('b', 'a')];
    expect(messages(rows)).toEqual([
      '3:parent:The parents go round in a circle and never reach a group.',
      '4:parent:The parents go round in a circle and never reach a group.',
    ]);
  });

  it('counts requirements, not groups, against the limit of 2,000', () => {
    const many = [group('G'), ...Array.from({ length: 2000 }, (_, i) => row(`R${i}`, 'G'))];
    expect(ownFrameworkProblems(many)).toEqual([]);
    expect(messages([...many, row('R2000', 'G')])).toEqual([
      '-:-:At most 2,000 requirements: this list has 2,001.',
    ]);
    expect(messages([group('G')])).toEqual(['-:-:Add at least one requirement.']);
  });

  it('checks the lists and tags a row may carry', () => {
    const rows = [
      group('G'),
      row('1', 'G', 'Lists', {
        questions: Array.from({ length: 9 }, () => 'Q?'),
        evidence: ['e'.repeat(161)],
        tags: ['Not a tag'],
        guidance: 'g'.repeat(2001),
      }),
    ];
    expect(messages(rows).map((m) => m.split(':')[1])).toEqual([
      'guidance',
      'questions',
      'evidence',
      'tags',
    ]);
  });
});

describe('importRequirements', () => {
  it('reads a list pasted from Excel (tab-separated), making a group row per group', () => {
    const text =
      'Ref\tTitle\tText\tGroup\tQuestions\tTags\tColour\n' +
      '1.1\tAccess reviews\tReview access every quarter.\tAccess\tWho reviews?; How often?\tAccess control\tred\n' +
      '1.2\tMFA\t\tAccess\t\t\t\n' +
      '2.1\tBackups\tKeep daily backups.\tContinuity\t\t\t\n';
    const t = parseCsv(text);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const r = importRequirements(t.table);
    expect(r.problems).toEqual([]);
    expect(r.ignored).toEqual(['Colour']);
    expect(r.groupsMade).toBe(2);
    expect(r.rows.map((x) => `${x.kind}:${x.ref}<${x.parent}`)).toEqual([
      'theme:Access<',
      'clause:1.1<Access',
      'clause:1.2<Access',
      'theme:Continuity<',
      'clause:2.1<Continuity',
    ]);
    expect(r.rows[1]).toMatchObject({
      title: 'Access reviews',
      text: 'Review access every quarter.',
      questions: ['Who reviews?', 'How often?'],
      tags: ['access-control'],
    });
    expect(ownFrameworkProblems(r.rows)).toEqual([]);
  });

  it('reads a CSV with parents and puts rows without a group in one group', () => {
    const t = parseCsv('ref,title,parent,kind\nS1,Scope,,\nS1.1,Sites,S1,paragraph\n');
    if (!t.ok) throw new Error(t.message);
    const r = importRequirements(t.table);
    expect(r.rows.map((x) => `${x.kind}:${x.ref}<${x.parent}`)).toEqual([
      `theme:${DEFAULT_GROUP}<`,
      `clause:S1<${DEFAULT_GROUP}`,
      'paragraph:S1.1<S1',
    ]);
  });

  it('keeps long values as written so the problems can point at them', () => {
    const t = parseCsv(`ref,title,group\n1,${'x'.repeat(90)},G\n`);
    if (!t.ok) throw new Error(t.message);
    const r = importRequirements(t.table);
    expect(r.rows[1]!.title).toHaveLength(90);
    expect(messages(r.rows)).toEqual(['2:title:Shorten the title; put the full wording in Text.']);
  });

  it('says which columns are missing', () => {
    const t = parseCsv('id,heading\n1,x\n');
    if (!t.ok) throw new Error(t.message);
    const r = importRequirements(t.table);
    expect(r.rows).toEqual([]);
    expect(r.problems[0]).toContain('Add "ref" and "title"');
  });
});

describe('copyStructure', () => {
  const catalogue: Requirement[] = [
    {
      ref: '4',
      parent: null,
      kind: 'theme',
      position: 0,
      title: 'Context',
      purpose: null,
      guidance: null,
      questions: [],
      evidence: [],
      tags: [],
    },
    {
      ref: '4.1',
      parent: '4',
      kind: 'clause',
      position: 1,
      title: 'Understanding the organization',
      purpose: 'Our purpose.',
      guidance: 'Our guidance.',
      questions: ['Q?'],
      evidence: ['E'],
      tags: ['context'],
    },
  ];

  it('copies refs, hierarchy and kinds only: no titles, never our words', () => {
    const c = copyStructure(
      { key: 'iso-27001', version: '2022', requirements: catalogue },
      { mappings: false },
    );
    expect(c.requirements).toEqual([
      emptyRow({ ref: '4', kind: 'theme' }),
      emptyRow({ ref: '4.1', parent: '4', kind: 'clause' }),
    ]);
    expect(c.mappings).toEqual([]);
    expect(c.copiedFrom).toBe('iso-27001@2022');
    // titles must be written before publishing
    expect(messages(c.requirements)).toEqual(['1:title:Write a title.', '2:title:Write a title.']);
  });

  it('can map every requirement to the one it was copied from, equivalent, for review', () => {
    const c = copyStructure(
      { key: 'iso-27001', version: '2022', requirements: catalogue },
      { mappings: true },
    );
    expect(c.mappings).toEqual([{ ref: '4.1', to: 'iso-27001@2022#4.1', relation: 'equivalent' }]);
  });
});

describe('publishDecision and editionMappingFor', () => {
  const v1 = [
    group('G'),
    row('1', 'G', 'One', { text: 'Do one.' }),
    row('2', 'G', 'Two'),
    row('3', 'G', 'Three'),
  ];
  const published = asPublished(v1);

  it('the first publish', () => {
    expect(publishDecision(null, v1).kind).toBe('first');
  });

  it('nothing changed: nothing to publish, unless the details changed', () => {
    expect(publishDecision(published, v1).kind).toBe('unchanged');
    expect(publishDecision(published, v1, true).kind).toBe('revision');
  });

  it('rewording or adding is a revision', () => {
    const next = [...v1.slice(0, 2), row('2', 'G', 'Two, reworded'), v1[3]!, row('4', 'G', 'Four')];
    const d = publishDecision(published, next);
    expect(d).toMatchObject({
      kind: 'revision',
      reworded: ['2'],
      added: ['4'],
      removed: [],
      moved: [],
    });
  });

  it('removing or renumbering a requirement is a new edition', () => {
    const renumbered = [v1[0]!, v1[1]!, row('2a', 'G', 'Two'), v1[3]!];
    expect(publishDecision(published, renumbered)).toMatchObject({
      kind: 'edition',
      removed: ['2'],
      added: ['2a'],
    });
    const moved = [...v1, group('H')].map((r) => (r.ref === '3' ? { ...r, parent: 'H' } : r));
    expect(publishDecision(published, moved)).toMatchObject({ kind: 'edition', moved: ['3'] });
  });

  it('the edition mapping: unchanged → equivalent, reworded → partial, the rest for review', () => {
    const next = asPublished([
      group('G'),
      row('1', 'G', 'One', { text: 'Do one.' }),
      row('3', 'G', 'Three, reworded'),
      row('5', 'G', 'Five'),
    ]);
    expect(editionMappingFor(published, next)).toEqual({
      pairs: [
        { fromRef: '1', toRef: '1', relation: 'equivalent' },
        { fromRef: '3', toRef: '3', relation: 'partial' },
      ],
      review: [
        { ref: '2', reason: 'removed' },
        { ref: '5', reason: 'new' },
      ],
    });
  });

  it('planEditionMove copies answers only through the equivalent pairs', () => {
    const next = asPublished([
      group('G'),
      row('1', 'G', 'One', { text: 'Do one.' }),
      row('3', 'G', 'Changed'),
    ]);
    const m = editionMappingFor(published, next);
    const key = `${ownKeyPrefix(ORG)}acme`;
    const crosswalks: Crosswalk[] = m.pairs.map((p) => ({
      from: { framework: key, version: '1', ref: p.fromRef },
      to: { framework: key, version: '2', ref: p.toRef },
      relation: p.relation,
      note: '',
      source: 'Edition mapping',
    }));
    const field = (id: string, sheetId: string) => ({
      id,
      sheetId,
      key: LIBRARY_KEYS.justification,
      name: 'Justification',
      type: 'justification',
      config: {},
      position: 'a0',
      width: 100,
      hidden: false,
      locked: false,
      description: null,
    });
    const item = (id: string, sheetId: string, ref: string, version: string, values = {}) => ({
      id,
      sheetId,
      groupId: 'g',
      name: ref,
      displayId: id,
      position: 'a0',
      values,
      requirementRef: `${key}@${version}#${ref}`,
    });
    const plan = planEditionMove({
      from: {
        sheetId: 'A',
        framework: { key, version: '1' },
        fields: [field('fa', 'A')] as never,
        items: [
          item('a1', 'A', '1', '1', { fa: 'In scope' }),
          item('a3', 'A', '3', '1', { fa: 'Also' }),
        ] as never,
      },
      to: {
        sheetId: 'B',
        framework: { key, version: '2' },
        fields: [field('fb', 'B')] as never,
        items: [item('b1', 'B', '1', '2'), item('b3', 'B', '3', '2')] as never,
      },
      crosswalks,
      links: [],
      linkFields: [],
    });
    expect(plan.copies).toEqual([
      { fromItemId: 'a1', toItemId: 'b1', fromRef: '1', toRef: '1', patch: { fb: 'In scope' } },
    ]);
    expect(plan.review.map((r) => `${r.toRef}:${r.reason}`)).toEqual(['3:partial']);
  });
});

describe('keys, the framework and its library pack', () => {
  it('keys have the reserved form w<8 hex of the org id>-<slug>', () => {
    expect(ownKeyPrefix(ORG)).toBe('w3fa85f64-');
    const k = ownFrameworkKey(ORG, 'Acme Supplier Security Schedule (2026)', new Set());
    expect(k).toBe('w3fa85f64-acme-supplier-security-schedu');
    expect(k.length).toBeLessThanOrEqual(40);
    expect(k).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
    expect(ownFrameworkKey(ORG, 'Acme Supplier Security Schedule', new Set([k]))).toBe(
      'w3fa85f64-acme-supplier-security-sche-2',
    );
    expect(ownFrameworkKey(ORG, '***', new Set())).toBe('w3fa85f64-framework');
    expect(isOwnFrameworkKey(k)).toBe(true);
    expect(isOwnFrameworkKey(`framework-${k}`)).toBe(true);
    expect(isOwnFrameworkKey('iso-27001')).toBe(false);
    expect(ownIdPrefix('Acme 2')).toBe('ACME2-');
    expect(ownIdPrefix('—')).toBe('REQ-');
  });

  const rows = [
    group('G', 'Supplier duties'),
    row('1', 'G', 'Access reviews', { text: 'Review all access every quarter.' }),
  ];
  const meta = {
    key: `${ownKeyPrefix(ORG)}acme`,
    version: '1',
    revision: 1,
    publisher: 'Meridian Components Ltd',
    source: 'Acme MSA, schedule 3',
    today: '2026-11-16',
  };

  it('publishes as a customer framework with the ownership licence note', () => {
    const f = toFramework(draftOf(rows), meta);
    expect(f.titles).toBe('customer');
    expect(f.licence).toBe(ownLicence('Acme MSA, schedule 3', 'Meridian Components Ltd'));
    expect(f.licence).toBe('Provided by Acme MSA, schedule 3. Owned by Meridian Components Ltd.');
    expect(f.library.packKey).toBeUndefined();
    expect(toFramework(draftOf(rows), { ...meta, version: '2' }).library).toMatchObject({
      packKey: `framework-${meta.key}-2`,
      name: 'Acme supplier security schedule (edition 2) requirements',
    });
  });

  it('frameworkToPack gives the library a locked Requirement field with the text and an SoA over everything', () => {
    const pack = frameworkToPack(toFramework(draftOf(rows), meta));
    expect(pack.key).toBe(`framework-${meta.key}`);
    expect(pack.version).toBe('1.1.0');
    const sheet = pack.sheets[0]!;
    expect(sheet.description).toBe(
      'Acme supplier security schedule. Provided by Acme MSA, schedule 3. Owned by Meridian Components Ltd.',
    );
    expect(sheet.fields.find((f) => f.key === LIBRARY_KEYS.text)).toMatchObject({
      name: 'Requirement',
      type: 'longtext',
      locked: true,
    });
    expect(sheet.items[0]!.values[LIBRARY_KEYS.text]).toBe('Review all access every quarter.');
    const soa = sheet.views.find((v) => v.name === 'Statement of applicability')!;
    expect((soa.config as { filters: unknown[] }).filters).toEqual([]);
  });

  it('round-trips a published framework back into a draft', () => {
    const f = toFramework(draftOf(rows), meta);
    const d = draftFromFramework(f);
    expect(trimDraft(d).requirements).toEqual(rows);
    expect(publishDecision(f.requirements, d.requirements).kind).toBe('unchanged');
  });
});
