// Two-step sign-in (SA-6, docs/09 §8, docs/05 §1): a password or email link, then a 6-digit code from an
// authenticator app (Supabase Auth MFA, TOTP). Pure: the server reads the user and the session's access token and
// asks these functions what the person may do. Copy says "two-step sign-in", never "MFA".

export type Aal = 'aal1' | 'aal2';

/** The part of a Supabase factor these rules read. */
export interface FactorLike {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string;
  created_at: string;
}

/** The workspace setting, in `orgs.settings` (docs/09 §8.2): owners turn it on in Workspace admin › Security. */
export const REQUIRE_TWO_STEP = 'requireTwoStep';

/** A TOTP code: six digits. Spaces people type between the groups are dropped. */
export const cleanCode = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(code) ? code : null;
};

/** The claims of a JWT, without checking its signature (the caller has had it checked by Supabase Auth). */
export function tokenClaims(token: string | null | undefined): Record<string, unknown> | null {
  const part = token?.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (c) =>
        c.charCodeAt(0),
      ),
    );
    const claims: unknown = JSON.parse(json);
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The session's assurance level from its access token: aal2 once a code was entered. */
export function aalOf(claims: Record<string, unknown> | null): Aal {
  return claims?.aal === 'aal2' ? 'aal2' : 'aal1';
}

/** When this session signed in (the first sign-in step's time in the token's `amr`), as an ISO instant. */
export function signedInAt(claims: Record<string, unknown> | null): string | null {
  const amr = Array.isArray(claims?.amr) ? (claims.amr as unknown[]) : [];
  const times = amr
    .map((m) => (m && typeof m === 'object' ? (m as { timestamp?: unknown }).timestamp : null))
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  return times.length ? new Date(Math.min(...times) * 1000).toISOString() : null;
}

/** The person's authenticator apps that finished set-up, oldest first. */
export function verifiedApps<F extends FactorLike>(factors: readonly F[] | null | undefined): F[] {
  return (factors ?? [])
    .filter((f) => f.factor_type === 'totp' && f.status === 'verified')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Set-ups that were started and never finished: removed before a new one starts. */
export function unfinishedApps<F extends FactorLike>(
  factors: readonly F[] | null | undefined,
): F[] {
  return (factors ?? []).filter((f) => f.factor_type === 'totp' && f.status !== 'verified');
}

export interface TwoStepState {
  /** The person has at least one authenticator app. */
  enrolled: boolean;
  level: Aal;
  /** Signed in with the first step only although an app is set up: the code is still owed. */
  needsCode: boolean;
}

export function twoStepState(
  factors: readonly FactorLike[] | null | undefined,
  level: Aal,
): TwoStepState {
  const enrolled = verifiedApps(factors).length > 0;
  return { enrolled, level, needsCode: enrolled && level !== 'aal2' };
}

/** Whether a workspace's settings require two-step sign-in. Anything but `true` means no. */
export function requiresTwoStep(settings: unknown): boolean {
  return (
    !!settings &&
    typeof settings === 'object' &&
    !Array.isArray(settings) &&
    (settings as Record<string, unknown>)[REQUIRE_TWO_STEP] === true
  );
}

/**
 * What a signed-in person must do before opening a workspace: nothing, enter their code (they have an app and
 * signed in with the first step only), or set up an app (the workspace requires one and they have none).
 */
export function workspaceGate(
  state: TwoStepState,
  required: boolean,
): 'open' | 'enter_code' | 'set_up' {
  if (state.needsCode) return 'enter_code';
  if (required && state.level !== 'aal2') return 'set_up';
  return 'open';
}

/** The message a command returns when the workspace requires two-step sign-in and this session has not done it. */
export const TWO_STEP_REQUIRED =
  'This workspace requires two-step sign-in. Set it up in Your account, then try again.';
