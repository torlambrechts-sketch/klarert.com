import { describe, expect, it } from 'vitest';
import { greeting, hourIn, nextSteps, testModeLine, type StandardSetup } from './home';
import type { SetupStepProgress } from './packs/setup';

describe('greeting', () => {
  it('says morning, afternoon or evening by the hour', () => {
    expect(greeting(5)).toBe('Good morning');
    expect(greeting(11)).toBe('Good morning');
    expect(greeting(12)).toBe('Good afternoon');
    expect(greeting(17)).toBe('Good afternoon');
    expect(greeting(18)).toBe('Good evening');
    expect(greeting(0)).toBe('Good evening');
    expect(greeting(4)).toBe('Good evening');
  });
});

describe('hourIn', () => {
  const now = new Date('2026-11-12T08:30:00Z');
  it('reads the hour in the given time zone', () => {
    expect(hourIn(now, 'UTC')).toBe(8);
    expect(hourIn(now, 'Europe/Oslo')).toBe(9);
    expect(hourIn(now, 'America/New_York')).toBe(3);
  });
  it('falls back to UTC for an unknown zone', () => {
    expect(hourIn(now, 'Not/AZone')).toBe(8);
  });
});

const step = (number: number, done: boolean): SetupStepProgress => ({
  ref: `s${number}`,
  number,
  title: `Step ${number} title`,
  body: `Do step ${number}.`,
  link: { sheetId: `sheet-${number}`, viewId: null, sheetName: `Sheet ${number}` },
  progress: done ? 1 : 0,
  done,
  detail: done ? '1 of 1' : '0 of 1',
});

const setup = (installId: string, title: string, done: boolean[]): StandardSetup => ({
  installId,
  title,
  level: installId === 'gdpr' ? { name: 'Recommended' } : null,
  progress: {
    title: `${title} setup`,
    description: '',
    steps: done.map((d, i) => step(i + 1, d)),
    done: done.filter(Boolean).length,
    total: done.length,
    percent: Math.floor((done.filter(Boolean).length / done.length) * 100),
  },
});

describe('nextSteps', () => {
  it('gives one card per standard with its first step not done', () => {
    const cards = nextSteps([
      setup('gdpr', 'GDPR privacy', [true, false, false, true]),
      setup('iso-27001', 'ISO/IEC 27001:2022 ISMS', [false, false]),
    ]);
    expect(cards.map((c) => [c.standard, c.step.number, c.level])).toEqual([
      ['GDPR privacy', 2, 'Recommended'],
      ['ISO/IEC 27001:2022 ISMS', 1, null],
    ]);
    expect(cards[0]!.line).toBe('Step 2 of 4 · 50% done');
    expect(cards[0]!.total).toBe(4);
  });

  it('leaves out a standard whose setup is done', () => {
    expect(nextSteps([setup('nis2', 'NIS2 cybersecurity', [true, true])])).toEqual([]);
    expect(nextSteps([])).toEqual([]);
  });
});

describe('testModeLine', () => {
  it('counts every waiting automation in one sentence', () => {
    expect(testModeLine([{ count: 40 }, { count: 34 }])).toBe('74 automations are in test mode.');
    expect(testModeLine([{ count: 1 }])).toBe('1 automation is in test mode.');
    expect(testModeLine([{ count: 0 }])).toBeNull();
    expect(testModeLine([])).toBeNull();
  });
});
