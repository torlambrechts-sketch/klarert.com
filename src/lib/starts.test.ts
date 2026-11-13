import { describe, expect, it } from 'vitest';
import { resolveTemplateTabs } from '@/engine/views/tabs';
import { COLUMN_STARTS, START_IDS, STARTS, startById } from './starts';

describe('wizard starts', () => {
  it('has the twelve starts of docs/05 §4 in order', () => {
    expect(STARTS.map((s) => s.id)).toEqual([...START_IDS]);
  });

  it('gives the column starts a label, groups and known field types', () => {
    expect(COLUMN_STARTS.map((s) => s.id)).toEqual([
      'blank',
      'register',
      'tracker',
      'log',
      'inspection',
      'capa',
      'audit',
      'incident',
      'control',
      'treatment',
    ]);
    for (const s of COLUMN_STARTS) {
      expect(s.itemLabel).toBeTruthy();
      expect(s.groups?.length).toBeGreaterThan(0);
    }
    expect(startById('tracker')?.fields).toContainEqual(['Priority', 'severity']);
  });

  it('gives the compliance starts a sub-item set: CAPA, audit and incident with the close gate on', () => {
    const withSets = STARTS.filter((s) => s.subitems).map((s) => s.id);
    expect(withSets).toEqual(['capa', 'audit', 'incident', 'control', 'treatment']);
    const capa = startById('capa')!.subitems!;
    expect(capa.label).toBe('Actions');
    expect(capa.items.map((i) => i.name)).toEqual([
      'Containment',
      'Root cause',
      'Correction',
      'Corrective action',
      'Effectiveness check',
    ]);
    expect(capa.items.at(-1)!.values).toEqual({ due_date: '$in:90' });
    for (const id of ['capa', 'audit', 'incident'])
      expect(startById(id)!.subitems!.blockClose, id).toBe(true);
    for (const id of ['control', 'treatment'])
      expect(startById(id)!.subitems!.blockClose, id).toBe(false);
    for (const s of STARTS.filter((x) => x.subitems))
      expect(s.subitems!.fields.map((f) => f.key)).toEqual(
        expect.arrayContaining(['owner', 'status', 'due_date', 'evidence']),
      );
  });
});

describe('starting tabs', () => {
  const visible = (id: string) =>
    resolveTemplateTabs(startById(id)!.tabs!, undefined, [])
      .tabs.filter((t) => !t.hidden)
      .map((t) => t.id);

  it('give each compliance start its tabs; the rest are hidden in More', () => {
    expect(visible('treatment')).toEqual(['table', 'kanban', 'insights']);
    expect(visible('control')).toEqual(['table', 'insights']);
    expect(visible('capa')).toEqual(['table', 'kanban', 'calendar']);
    expect(visible('incident')).toEqual(['table', 'form', 'kanban']);
    expect(visible('audit')).toEqual(['table', 'calendar']);
    expect(visible('register')).toEqual(['table', 'calendar']);
    for (const s of STARTS.filter((x) => x.tabs))
      expect(resolveTemplateTabs(s.tabs!, undefined, []).problems).toEqual([]);
    // general starts keep today's order
    expect(startById('tracker')!.tabs).toBeUndefined();
  });
});
