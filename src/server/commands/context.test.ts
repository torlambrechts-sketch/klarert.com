import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TwoStepState } from '@/lib/two-step';

vi.mock('server-only', () => ({}));

// withOrg and two-step sign-in (docs/09 §8): a session that still owes its code is signed out for commands, and a
// workspace that requires two-step sign-in refuses every command from a session that did not enter one.

const state: { session: TwoStepState | null; owesCode: boolean; requireTwoStep: unknown } = {
  session: null,
  owesCode: false,
  requireTwoStep: null,
};

const membership = () => ({
  data: {
    role: 'owner',
    orgs: { id: 'org-1', slug: 'acme', require_two_step: state.requireTwoStep },
  },
});
const query = {
  select: () => query,
  eq: () => query,
  maybeSingle: async () => membership(),
};
const fake = { from: () => query };

vi.mock('@/server/auth', () => ({
  getSession: async () =>
    state.session
      ? { supabase: fake, user: { id: 'u1' }, profile: { id: 'u1' }, twoStep: state.session }
      : null,
  getSignIn: async () => ({
    twoStep: { enrolled: true, level: 'aal1', needsCode: state.owesCode },
  }),
  isAdminRole: (r: string) => r === 'owner' || r === 'admin',
  isEditorRole: (r: string) => r !== 'viewer',
}));

const { withOrg } = await import('./context');
const run = () =>
  withOrg('acme', 'member', async () => ({ ok: true as const, data: 'ran' }), 'test');

const firstStep: TwoStepState = { enrolled: false, level: 'aal1', needsCode: false };
const twoStep: TwoStepState = { enrolled: true, level: 'aal2', needsCode: false };

describe('withOrg and two-step sign-in', () => {
  beforeEach(() => {
    state.session = null;
    state.owesCode = false;
    state.requireTwoStep = null;
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('asks for the code when the session still owes it', async () => {
    state.owesCode = true;
    expect(await run()).toEqual({
      ok: false,
      error: {
        code: 'unauthenticated',
        message: 'Enter the code from your authenticator app to finish signing in.',
      },
    });
  });

  it('runs for a first-step session when the workspace does not require two-step sign-in', async () => {
    state.session = firstStep;
    expect(await run()).toEqual({ ok: true, data: 'ran' });
  });

  it('refuses a first-step session when the workspace requires it', async () => {
    state.session = firstStep;
    state.requireTwoStep = true;
    expect(await run()).toEqual({
      ok: false,
      error: {
        code: 'forbidden',
        message:
          'This workspace requires two-step sign-in. Set it up in Your account, then try again.',
      },
    });
  });

  it('runs for a two-step session when the workspace requires it', async () => {
    state.session = twoStep;
    state.requireTwoStep = true;
    expect(await run()).toEqual({ ok: true, data: 'ran' });
  });

  it('treats anything but true as not required', async () => {
    state.session = firstStep;
    state.requireTwoStep = 'true';
    expect(await run()).toEqual({ ok: true, data: 'ran' });
  });
});
