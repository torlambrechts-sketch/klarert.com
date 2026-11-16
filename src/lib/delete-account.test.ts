import { describe, expect, it } from 'vitest';
import { confirmsEmail, onlyOwnerMessage, onlyOwnerOf } from './delete-account';

describe('delete my account', () => {
  it('needs the account email typed exactly, apart from case and spaces', () => {
    expect(confirmsEmail('mia@example.com', 'mia@example.com')).toBe(true);
    expect(confirmsEmail('  Mia@Example.com ', 'mia@example.com')).toBe(true);
    expect(confirmsEmail('mia@example.co', 'mia@example.com')).toBe(false);
    expect(confirmsEmail('', 'mia@example.com')).toBe(false);
    expect(confirmsEmail(null, 'mia@example.com')).toBe(false);
    expect(confirmsEmail('mia@example.com', null)).toBe(false);
  });

  it('names the workspaces the person is the only owner of', () => {
    expect(onlyOwnerMessage(['Acme'])).toBe(
      'You are the only owner of Acme. Make someone else owner of Acme or delete it first.',
    );
    expect(onlyOwnerMessage(['Acme', 'Beta', 'Gamma'])).toBe(
      'You are the only owner of Acme, Beta and Gamma. Make someone else owner of each of them, or delete them, first.',
    );
  });

  it('reads the names from the database refusal', () => {
    const message =
      'account: You are the only owner of Acme, Beta. Make someone else owner of each, or delete it, first.';
    expect(onlyOwnerOf({ message, details: '["Acme", "Beta"]' })).toEqual(['Acme', 'Beta']);
    expect(onlyOwnerOf({ message, details: 'not json' })).toEqual([]);
    expect(onlyOwnerOf({ message: 'something else', details: '["Acme"]' })).toBeNull();
  });
});
