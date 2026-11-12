import { describe, expect, it } from 'vitest';
import {
  activeMention,
  insertMention,
  mentionedUserIds,
  parseMentions,
  suggestMentions,
  type MentionCandidate,
} from './mentions';

const candidates: MentionCandidate[] = [
  { kind: 'person', id: 'u-maria', name: 'Maria Pereira' },
  { kind: 'person', id: 'u-mar', name: 'Mar' },
  { kind: 'person', id: 'u-james', name: 'James Okafor' },
  { kind: 'role', id: 'r-cm', name: 'Compliance manager' },
  { kind: 'role', id: 'r-it', name: 'Head of IT' },
];

describe('parseMentions', () => {
  it('finds people and roles, longest name first', () => {
    const body = '@Maria Pereira and @Head of IT, please check. cc @mar';
    const spans = parseMentions(body, candidates);
    expect(spans.map((s) => [s.kind, s.id, body.slice(s.start, s.end)])).toEqual([
      ['person', 'u-maria', '@Maria Pereira'],
      ['role', 'r-it', '@Head of IT'],
      ['person', 'u-mar', '@mar'],
    ]);
  });

  it('ignores email addresses, unknown names and partial words', () => {
    expect(parseMentions('mail maria@example.com', candidates)).toEqual([]);
    expect(parseMentions('@Nobody here', candidates)).toEqual([]);
    expect(parseMentions('@Marianne', candidates)).toEqual([]);
  });
});

describe('mentionedUserIds', () => {
  it('expands roles to the people who hold them, without the author or duplicates', () => {
    const spans = parseMentions(
      '@Compliance manager @James Okafor @Head of IT @Maria Pereira',
      candidates,
    );
    const holders = (id: string) =>
      ({ 'r-cm': ['u-maria', 'u-tom'], 'r-it': ['u-james'] })[id] ?? [];
    expect(mentionedUserIds(spans, holders, 'u-maria')).toEqual(['u-tom', 'u-james']);
  });
});

describe('composer helpers', () => {
  it('finds the mention being typed', () => {
    expect(activeMention('Hello @Mar', 10)).toEqual({ start: 6, query: 'Mar' });
    expect(activeMention('Hello @', 7)).toEqual({ start: 6, query: '' });
    expect(activeMention('maria@exa', 9)).toBeNull();
    expect(activeMention('@Maria\nnext', 11)).toBeNull();
    expect(activeMention('no mention', 10)).toBeNull();
  });

  it('suggests names that start with the query, then names with a word that does', () => {
    expect(suggestMentions('o', candidates).map((c) => c.id)).toEqual(['u-james', 'r-it']);
    expect(suggestMentions('ma', candidates).map((c) => c.id)).toEqual([
      'u-maria',
      'u-mar',
      'r-cm',
    ]);
  });

  it('inserts the chosen name', () => {
    expect(insertMention('Hi @Ma there', 3, 6, 'Maria Pereira')).toEqual({
      text: 'Hi @Maria Pereira  there',
      caret: 18,
    });
  });
});
