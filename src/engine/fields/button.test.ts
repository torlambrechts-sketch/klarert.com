import { describe, expect, it } from 'vitest';
import { makeCtx, makeField, makeItem } from '../testing/fixtures';
import { button } from './button';

// The shared contract needs two ordered non-empty values; a button never holds one, so its checks are spelt out.
describe('button', () => {
  const cfg = button.defaultConfig();
  const ctx = makeCtx();

  it('has a valid default config: Run, no confirmation', () => {
    expect(cfg).toEqual({ label: 'Run', confirm: null });
    expect(button.configSchema.safeParse(cfg).success).toBe(true);
    expect(button.configSchema.safeParse({ label: '', confirm: null }).success).toBe(false);
    expect(
      button.configSchema.safeParse({ label: 'Send', confirm: 'Send for approval?' }).success,
    ).toBe(true);
  });

  it.each([['Run'], [1], [true], [null], [''], [{}]])('stores nothing for %j', (input) => {
    expect(button.normalize(input, cfg, ctx)).toBeNull();
  });

  it.each([['Run'], ['46337'], ['']])('pastes nothing from %j', (t) => {
    expect(button.parseText(t, cfg, ctx)).toBeNull();
  });

  it('is always empty and projects to nothing', () => {
    expect(button.isEmpty(null)).toBe(true);
    expect(button.toText(null, cfg, ctx)).toBe('');
    expect(button.toNumber(null, cfg, ctx)).toBeNull();
    expect(button.toDate(null, cfg, ctx)).toBeNull();
    expect(button.compare(null, null, cfg, ctx)).toBe(0);
    expect(button.validate(null, makeField('button', cfg), makeItem(), ctx)).toEqual([]);
  });

  it('only drives the button_clicked trigger and is kept off forms', () => {
    expect(button.triggers).toEqual(['button_clicked']);
    expect(button.kind).toBe('none');
    expect(button.storage).toBe('none');
    expect(button.formAllowed).toBe(false);
  });
});
