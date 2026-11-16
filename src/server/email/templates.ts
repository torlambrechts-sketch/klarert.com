// Email templates (docs/09 §11): pure functions from data to subject, plain text and HTML. Plain and accessible: one
// column, real text, the link written out as well as linked, no images, no remote resources and no tracking. English
// sentence case; dates as 11 Nov 2026 in the workspace's time zone. Every value from people (workspace and person
// names) is escaped in the HTML and stripped of line breaks in the subject.

import { formatDate, isoDateInZone } from '@/engine/fields/helpers';
import { ROLE_LABELS, ROLE_SUMMARIES, type ROLES } from '@/lib/schemas/workspace';

export type Role = (typeof ROLES)[number];

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

/** The product name used in the body (the sender's display name comes from EMAIL_FROM). */
export const PRODUCT_NAME = 'Compliance OS';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** One line, no control characters: a subject never carries a line break from a name. */
const oneLine = (s: string) =>
  s
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 11 Nov 2026: the day an instant falls on in a time zone. */
export const emailDate = (instant: string, timeZone: string) =>
  formatDate(isoDateInZone(instant, timeZone));

const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

/** A paragraph of the HTML body. `html` is already escaped. */
type Block = { html: string; text: string };
const para = (text: string): Block => ({ html: `<p>${escapeHtml(text)}</p>`, text });

function page(subject: string, blocks: Block[]): EmailContent {
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    `<title>${escapeHtml(subject)}</title>`,
    '</head>',
    '<body style="margin:0;padding:24px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5">',
    '<div style="max-width:560px">',
    ...blocks.map((b) => b.html),
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
  return { subject, text: `${blocks.map((b) => b.text).join('\n\n')}\n`, html };
}

export interface InviteEmailInput {
  workspace: string;
  /** The display name of the person who sent the invite. */
  inviter: string;
  role: Role;
  /** The invited address: the link works for it only. */
  email: string;
  link: string;
  /** When the link stops working (ISO instant, 14 days after the invite was created). */
  linkExpiresAt: string;
  /** Auditors: when their read-only access ends (ISO instant). */
  accessEndsAt?: string | null;
  timeZone: string;
}

/** The invite to a workspace: who, which workspace, the role and what it can do, the link and until when it works. */
export function inviteEmail(input: InviteEmailInput): EmailContent {
  const workspace = oneLine(input.workspace);
  const inviter = oneLine(input.inviter) || 'Someone';
  const role = ROLE_LABELS[input.role].toLowerCase();
  const until = emailDate(input.linkExpiresAt, input.timeZone);
  const subject = `${inviter} invited you to ${workspace} on ${PRODUCT_NAME}`;
  const link: Block = {
    html: `<p><a href="${escapeHtml(input.link)}" style="font-weight:600">Accept the invite</a></p>\n<p>Or copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(input.link)}</span></p>`,
    text: `Accept the invite:\n${input.link}`,
  };
  return page(subject, [
    para(
      `${inviter} invited you to join the workspace ${workspace} on ${PRODUCT_NAME} as ${article(role)}.`,
    ),
    para(ROLE_SUMMARIES[input.role]),
    ...(input.role === 'auditor' && input.accessEndsAt
      ? [para(`Your read-only access ends on ${emailDate(input.accessEndsAt, input.timeZone)}.`)]
      : []),
    link,
    para(`The link works once, for ${input.email} only, until ${until}.`),
    para(
      'If you did not expect this invite, you can ignore this email. Nothing changes unless you accept it.',
    ),
  ]);
}
