import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { shouldClearSignature, signature, signaturePayload } from './signature';

const hash = 'b'.repeat(64);
const sig = { by: 'u-maria', at: '2026-11-11T14:20:00Z', meaning: 'Approved', hash };
const later = { ...sig, by: 'u-james', at: '2026-11-12T09:00:00Z' };

describe('signature', () => {
  contract(signature, {
    valid: [
      [sig, sig],
      [{ ...sig, by: 'maria@example.com' }, sig],
      [
        { by: 'James Okafor', at: sig.at, hash },
        { ...sig, by: 'u-james' },
      ],
    ],
    invalid: [
      null,
      'Approved',
      { ...sig, by: 'nobody' },
      { ...sig, hash: 'short' },
      { ...sig, at: '11/11/2026' },
    ],
    parse: [
      [JSON.stringify(sig), sig],
      ['Approved', null],
      ['', null],
    ],
    text: [
      [sig, 'Approved by Maria Pereira on 11 Nov 2026'],
      [{ ...sig, by: 'u-gone' }, 'Approved on 11 Nov 2026'],
    ],
    number: [[sig, null]],
    date: [[{ ...sig, at: '2026-06-30T23:30:00Z' }, '2026-07-01']],
    order: [sig, later],
  });

  describe('clears on change', () => {
    const cfg = { meaning: 'Approved', clearOnChange: true };
    const prev = { 'f-sig': sig, 'f-status': 'opt_done', 'f-obj': { b: 1, a: 2 } };

    it('clears when any other value changes', () => {
      expect(shouldClearSignature(prev, { ...prev, 'f-status': 'opt_wip' }, 'f-sig', cfg)).toBe(
        true,
      );
      expect(shouldClearSignature(prev, { ...prev, 'f-new': 'x' }, 'f-sig', cfg)).toBe(true);
    });

    it('keeps the signature when only the signature or key order changes', () => {
      expect(shouldClearSignature(prev, { ...prev, 'f-sig': later }, 'f-sig', cfg)).toBe(false);
      expect(shouldClearSignature(prev, { ...prev, 'f-obj': { a: 2, b: 1 } }, 'f-sig', cfg)).toBe(
        false,
      );
    });

    it('never clears when clearOnChange is off', () => {
      expect(
        shouldClearSignature(prev, { ...prev, 'f-status': 'opt_wip' }, 'f-sig', {
          ...cfg,
          clearOnChange: false,
        }),
      ).toBe(false);
    });

    it('hashes the values without the signature in a stable order', () => {
      expect(signaturePayload({ 'f-sig': sig, b: 1, a: 'x' }, 'f-sig')).toBe('{"a":"x","b":1}');
    });
  });
});
