import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '../fields/registry';
import { installFieldTypes } from '../fields/resolve';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { actorName, itemLink, renderTemplate, type TemplateEnv } from '.';

beforeAll(() => installFieldTypes(Object.values(FIELD_TYPES)));

const status = makeField('status', FIELD_TYPES.status.defaultConfig(), { key: 'status' });
const due = makeField('date', { relative: false }, { key: 'review_date' });
const owner = makeField('people', { multiple: true }, { key: 'owner' });
const secret = makeField('protected', { allowedUserIds: ['u-maria'] }, { key: 'secret' });
const ctx = makeCtx(
  { fields: [status, due, owner, secret], protected: { 'i-7:f-secret': 'hidden' } },
  {},
);
const item = makeItem(
  { [status.id]: 'opt_done', [due.id]: '2026-11-11', [owner.id]: ['u-maria', 'u-james'] },
  { id: 'i-7', displayId: 'CA-007', name: 'Replace guard', groupId: 'g-closed' },
);
const env: TemplateEnv = {
  appUrl: 'https://app.example.com/',
  workspace: 'meridian',
  actor: { kind: 'user', id: 'u-james' },
};

describe('renderTemplate', () => {
  it('fills the built-in keys', () => {
    expect(renderTemplate('{id} {name} in {group} of {sheet} by {actor}', item, ctx, env)).toBe(
      'CA-007 Replace guard in Closed of Corrective actions by James Okafor',
    );
    expect(renderTemplate('{link}', item, ctx, env)).toBe(
      'https://app.example.com/meridian/s/s-ca?item=CA-007',
    );
  });

  it('fills field keys with the value as text', () => {
    expect(renderTemplate('{status} on {review_date} for {owner}', item, ctx, env)).toBe(
      'Done on 11 Nov 2026 for Maria Pereira, James Okafor',
    );
  });

  it('leaves unknown keys as written and protected fields Restricted', () => {
    expect(renderTemplate('{nope} {secret} {', item, ctx, env)).toBe('{nope} Restricted {');
  });

  it('names who started the chain', () => {
    expect(actorName({ kind: 'form', id: null }, ctx)).toBe('A form');
    expect(actorName({ kind: 'system', id: null }, ctx)).toBe('The system');
    expect(actorName({ kind: 'user', id: 'u-gone' }, ctx)).toBe('Someone');
    expect(itemLink(item, env)).toBe('https://app.example.com/meridian/s/s-ca?item=CA-007');
  });
});
