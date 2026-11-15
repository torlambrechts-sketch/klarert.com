import 'server-only';
import { deliver, emailConfigured, type EmailMessage, type SendResult } from './transport';

// The email module (docs/09 §10): server-only, no database access and no service role. Callers authorise first (a
// command), build the content with a template (./templates) and send it here. Later steps (reminders, policy
// read-and-accept requests, notifications) add a template and a tag; the interface stays `sendEmail(message)`.

export type { EmailMessage, EmailTag, SendResult } from './transport';
export type { EmailContent } from './templates';
export { inviteEmail } from './templates';

const log = (level: 'info' | 'error', fields: Record<string, unknown>) => {
  const line = JSON.stringify({ level, source: 'email', ...fields });
  if (level === 'error') console.error(line);
  else console.info(line);
};

/** Send one email. Never throws; the result says whether it went. */
export function sendEmail(message: EmailMessage): Promise<SendResult> {
  return deliver(message, { env: process.env, fetch: (input, init) => fetch(input, init), log });
}

/** Whether a transport is set up (Resend, or Mailpit next to a local Supabase). */
export const canSendEmail = () => emailConfigured(process.env);
