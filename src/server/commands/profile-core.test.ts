import { describe, expect, it, vi } from 'vitest';
import { changeNameWith, NAME_NOT_CHANGED, type ChangeNameDeps } from './profile-core';

function deps(rows = 1, error: { message: string } | null = null) {
  return {
    update: vi.fn<ChangeNameDeps['update']>(async () => ({ rows, error })),
    log: vi.fn(),
  };
}

describe('changeNameWith (Your account › Your name)', () => {
  it('saves the trimmed name with initials derived as onboarding derives them', async () => {
    const d = deps();
    expect(await changeNameWith(d, { displayName: '  Maria   Pereira ' })).toEqual({
      ok: true,
      data: { displayName: 'Maria   Pereira', initials: 'MP' },
    });
    expect(d.update).toHaveBeenCalledWith({ display_name: 'Maria   Pereira', initials: 'MP' });
    expect(await changeNameWith(deps(), { displayName: 'Ada' })).toMatchObject({
      data: { initials: 'AD' },
    });
  });

  it('needs a name, of at most 80 characters (onboarding’s limit)', async () => {
    const d = deps();
    expect(await changeNameWith(d, { displayName: '   ' })).toEqual({
      ok: false,
      error: {
        code: 'invalid',
        message: 'Check the highlighted fields.',
        fieldErrors: { displayName: 'Name is required.' },
      },
    });
    expect(await changeNameWith(d, { displayName: 'x'.repeat(81) })).toMatchObject({
      error: { fieldErrors: { displayName: 'Name can be at most 80 characters.' } },
    });
    expect((await changeNameWith(d, { displayName: 'x'.repeat(80) })).ok).toBe(true);
    expect(await changeNameWith(d, { displayName: null })).toMatchObject({ ok: false });
    expect(d.update).toHaveBeenCalledTimes(1);
  });

  it('does not rename a deleted profile: the policy matches no row, and the person is told', async () => {
    const d = deps(0);
    expect(await changeNameWith(d, { displayName: 'Back again' })).toEqual({
      ok: false,
      error: { code: 'forbidden', message: NAME_NOT_CHANGED },
    });
    expect(d.log).toHaveBeenCalledWith({ ok: false });
  });

  it('passes a database refusal on', async () => {
    const r = await changeNameWith(deps(0, { message: 'boom' }), { displayName: 'Ada' });
    expect(r.ok).toBe(false);
  });
});
