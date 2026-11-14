import { describe, expect, it } from 'vitest';
import { goalChips, intentScore, rankGoal, words, type Candidate, type Intent } from './match';

const intents: Intent[] = [
  {
    id: 'complaints',
    label: 'Complaints',
    chip: true,
    keywords: ['complaint', 'customer complaint', 'feedback'],
    targets: [
      { kind: 'pack', id: 'start-capa' },
      { kind: 'start', id: 'log' },
      { kind: 'recipe', id: 'form-alert' },
    ],
  },
  {
    id: 'suppliers',
    label: 'Supplier onboarding',
    chip: true,
    keywords: ['supplier', 'vendor', 'third party'],
    targets: [
      { kind: 'pack', id: 'supplier-management' },
      { kind: 'start', id: 'register' },
    ],
  },
  {
    id: 'quality',
    label: 'Quality',
    chip: false,
    keywords: ['iso 9001'],
    targets: [{ kind: 'pack', id: 'iso-9001' }],
  },
];

const candidates: Candidate[] = [
  {
    kind: 'pack',
    id: 'start-capa',
    title: 'Corrective action (CAPA)',
    description: 'Nonconformities',
  },
  {
    kind: 'pack',
    id: 'supplier-management',
    title: 'Supplier management',
    description: 'Suppliers',
  },
  { kind: 'start', id: 'log', title: 'Log', description: 'Events recorded as they happen' },
  { kind: 'start', id: 'register', title: 'Register', description: 'Things you keep under review' },
  {
    kind: 'recipe',
    id: 'form-alert',
    title: 'When a form is submitted, notify the team',
    description: '',
  },
];

describe('goal matching', () => {
  it('folds case, punctuation and plurals', () => {
    expect(words('Customer COMPLAINTS, please')).toEqual(['customer', 'complaint', 'please']);
    expect(words('process')).toEqual(['process']);
  });

  it('scores whole phrases above partial words', () => {
    const q = words('customer complaints');
    expect(intentScore(q, intents[0]!)).toBeGreaterThan(intentScore(words('compl'), intents[0]!));
    expect(intentScore(words('nothing here'), intents[0]!)).toBe(0);
  });

  it('ranks the intent targets best first and keeps only what the workspace offers', () => {
    const r = rankGoal('We get customer complaints by email', intents, candidates);
    expect(r.map((m) => `${m.kind}:${m.id}`)).toEqual([
      'pack:start-capa',
      'start:log',
      'recipe:form-alert',
    ]);
    expect(r[0]!.because).toBe('Complaints');
  });

  it('matches a partial word and the candidates’ own words', () => {
    expect(rankGoal('vend', intents, candidates)[0]!.id).toBe('supplier-management');
    expect(rankGoal('nonconformities', intents, candidates)[0]!.id).toBe('start-capa');
  });

  it('returns nothing for an empty goal, at most the limit, and leaves out missing targets', () => {
    expect(rankGoal('  ', intents, candidates)).toEqual([]);
    expect(rankGoal('complaint supplier', intents, candidates, 3)).toHaveLength(3);
    expect(rankGoal('iso 9001', intents, candidates)).toEqual([]);
  });

  it('lists the chips in file order', () => {
    expect(goalChips(intents)).toEqual(['Complaints', 'Supplier onboarding']);
  });
});
