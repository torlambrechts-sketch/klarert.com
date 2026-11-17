import { z } from 'zod';

// The sign-in page's "Try the demo workspace" link (docs/17 The live demo, owner decision 17 Nov 2026). Off unless
// NEXT_PUBLIC_DEMO_EMAIL is set. The password is shown only when NEXT_PUBLIC_DEMO_PASSWORD is set too; otherwise the
// page says to ask for it. A public password is acceptable only because the demo login is a read-only viewer in a
// fictional workspace that is rebuilt every night (docs/09 §15).
//
// Read on the server when the page renders, from the environment passed in (process.env by default), and not as
// `process.env.NEXT_PUBLIC_…` property by property, which Next.js would fix at build time: the deployment's variables
// decide it, and the end-to-end test can start a server with them set.

export interface DemoLogin {
  email: string;
  /** null: the page says "Ask us for the demo password". */
  password: string | null;
}

export function demoLogin(
  source: Record<string, string | undefined> = process.env,
): DemoLogin | null {
  const email = source['NEXT_PUBLIC_DEMO_EMAIL']?.trim() ?? '';
  if (!email || !z.email().safeParse(email).success) return null;
  const password = source['NEXT_PUBLIC_DEMO_PASSWORD'] ?? '';
  return { email, password: password ? password : null };
}
