import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { email } from './email';

describe('email', () => {
  contract(email, {
    valid: [
      ['maria@example.com', 'maria@example.com'],
      ['  Maria.Pereira@Example.COM ', 'maria.pereira@example.com'],
      ['mailto:james@example.com', 'james@example.com'],
    ],
    invalid: ['maria', 'maria@example', '', null, 'a b@example.com'],
    parse: [
      ['Maria Pereira <Maria@Example.com>', 'maria@example.com'],
      ['vic@example.co.uk', 'vic@example.co.uk'],
      ['MAILTO:QA@EXAMPLE.COM', 'qa@example.com'],
    ],
    text: [['maria@example.com', 'maria@example.com']],
    order: ['anna@example.com', 'zoe@example.com'],
    empty: [
      ['', true],
      ['a@b.co', false],
    ],
  });

  it('stores addresses in lower case', () => {
    expect(email.normalize('QA@Meridian.EXAMPLE', {}, makeCtx())).toBe('qa@meridian.example');
  });
});
