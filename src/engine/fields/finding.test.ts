import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { finding } from './finding';

describe('finding', () => {
  contract(finding, {
    valid: [
      ['opt_major', 'opt_major'],
      ['Minor nonconformity', 'opt_minor'],
      [' observation ', 'opt_observation'],
    ],
    invalid: ['Major', '', null, 3],
    parse: [
      ['Conformity', 'opt_conformity'],
      ['OPPORTUNITY FOR IMPROVEMENT', 'opt_ofi'],
      ['opt_major', 'opt_major'],
    ],
    text: [
      ['opt_ofi', 'Opportunity for improvement'],
      ['opt_unknown', ''],
    ],
    number: [
      ['opt_conformity', 0],
      ['opt_major', 4],
    ],
    order: ['opt_observation', 'opt_major'],
    done: [
      ['opt_conformity', true],
      ['opt_minor', false],
    ],
  });

  it('has fixed, ordered options that config cannot change', () => {
    const cfg = finding.defaultConfig();
    cfg.options = [{ id: 'opt_x', label: 'Other', color: 'grey' }];
    expect(finding.options!(cfg, makeCtx()).map((o) => o.id)).toEqual([
      'opt_conformity',
      'opt_observation',
      'opt_ofi',
      'opt_minor',
      'opt_major',
    ]);
    expect(finding.kind).toBe('ordered');
    expect(finding.rank!('opt_major', cfg)).toBeGreaterThan(finding.rank!('opt_minor', cfg)!);
    expect(finding.kanbanCapable).toBe(true);
  });
});
