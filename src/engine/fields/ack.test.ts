import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { ack, ackAudience, ackPercent, currentAckVersion, type AckConfig } from './ack';
import { installFieldTypes } from './resolve';
import { version } from './version';

const cfg: AckConfig = {
  audience: { userIds: ['u-james', 'u-maria'], teamIds: ['t-quality'], jobRoleIds: ['r-cm'] },
  versionFieldKey: 'version',
};
const at = '2026-11-10T09:00:00Z';
const maria = { userId: 'u-maria', at, version: 'v1.2' };
const james = { userId: 'u-james', at, version: 'v1.2' };
const vicOld = { userId: 'u-vic', at: '2026-01-01T09:00:00Z', version: 'v1.1' };

describe('ack', () => {
  contract(ack, {
    config: cfg,
    valid: [
      [[maria], [maria]],
      [[{ userId: 'maria@example.com', at, version: 'v1.2' }], [maria]],
      [[{ userId: 'u-james', at }], [{ userId: 'u-james', at, version: null }]],
      [
        [maria, { ...maria, at: '2026-11-11T09:00:00Z' }],
        [{ ...maria, at: '2026-11-11T09:00:00Z' }],
      ],
    ],
    invalid: [
      [],
      null,
      'Maria',
      [{ userId: 'nobody', at }],
      [{ userId: 'u-maria', at: 'yesterday' }],
    ],
    parse: [
      [JSON.stringify([maria]), [maria]],
      ['Maria Pereira', null],
      ['', null],
    ],
    text: [[[maria, vicOld], '1 of 3 acknowledged']],
    number: [
      [[maria, james, vicOld], (2 / 3) * 100],
      [[vicOld], (1 / 3) * 100],
    ],
    order: [[maria], [maria, james]],
  });

  it('builds the audience from users and team members, deduped', () => {
    expect(ackAudience(cfg, makeCtx()).sort()).toEqual(['u-james', 'u-maria', 'u-vic']);
  });

  it('counts only acknowledgements of the current version', () => {
    installFieldTypes([version]);
    const vf = makeField('version', {}, { key: 'version', id: 'f-ver' });
    const field = makeField('ack', cfg);
    const ctx = makeCtx({ fields: [vf] });
    const item = makeItem({ 'f-ver': 'v1.3' });
    const v = [maria, james];
    expect(currentAckVersion(item, field, ctx)).toBe('v1.3');
    expect(ackPercent(v, cfg, ctx, currentAckVersion(item, field, ctx))).toBe(0);
    expect(ackPercent(v, cfg, ctx, 'v1.2')).toBeCloseTo(66.67, 1);
    expect(
      ackPercent(v, { ...cfg, audience: { userIds: [], teamIds: [], jobRoleIds: [] } }, ctx),
    ).toBeNull();
  });
});
