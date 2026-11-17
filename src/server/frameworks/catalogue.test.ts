import { describe, expect, it } from 'vitest';
import { emptyRow, toFramework, type FrameworkDraft } from '@/engine/frameworks/own';
import { frameworkHash, frameworkRow, requirementRows } from './catalogue';

// The content hash of a workspace's own framework (docs/12 Your own frameworks): frameworkHash, as for the catalogue.
const draft: FrameworkDraft = {
  title: 'Acme schedule',
  shortTitle: 'ACME',
  kind: 'internal',
  copiedFrom: null,
  mappings: [],
  requirements: [
    emptyRow({ ref: 'G', kind: 'theme', title: 'Supplier duties' }),
    emptyRow({
      ref: '1',
      parent: 'G',
      title: 'Access reviews',
      text: 'Review access every quarter.',
    }),
  ],
};
const meta = {
  key: 'w3fa85f64-acme',
  version: '1',
  revision: 1,
  publisher: 'Meridian',
  source: 'Acme MSA',
  today: '2026-11-16',
};

describe('frameworkHash of an own framework', () => {
  it('changes with the wording, not with the edition status or the day it was published', () => {
    const a = toFramework(draft, meta);
    const b = toFramework(draft, { ...meta, today: '2026-12-01' });
    expect(frameworkHash(a)).toBe(frameworkHash(b));
    expect(frameworkHash({ ...a, status: 'withdrawn', supersededBy: 'w3fa85f64-acme@2' })).toBe(
      frameworkHash(a),
    );
    const reworded = toFramework(
      {
        ...draft,
        requirements: [draft.requirements[0]!, { ...draft.requirements[1]!, text: 'Monthly.' }],
      },
      meta,
    );
    expect(frameworkHash(reworded)).not.toBe(frameworkHash(a));
    expect(frameworkHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a catalogue framework hashes as before: no text key unless a requirement has text', () => {
    const f = toFramework(draft, meta);
    const plain = {
      ...f,
      requirements: f.requirements.map((r) =>
        Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'text')),
      ),
    } as typeof f;
    expect(frameworkHash(plain)).not.toBe(frameworkHash(f));
    expect(requirementRows(f)[1]).toMatchObject({ ref: '1' });
    expect(frameworkRow(f).titles).toBe('customer');
  });
});
