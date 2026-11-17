// The product's name and addresses (owner decision, 16 Nov 2026: "Compliance OS" by Klarert becomes Keptrow on
// keptrow.com; docs/14). Every page title, email, the authenticator label and the public site read these: never write
// the name or the domain as a literal elsewhere. Pure data with no imports, so next.config.ts can load it too.

const product = 'Keptrow';
const tagline = 'the compliance spreadsheet';

export const BRAND = {
  /** The name in running text, page titles, emails and the authenticator app. Styled exactly "Keptrow". */
  product,
  /**
   * The wordmark in the site header, the sign-in pages and the share image. One constant so the camel-case option
   * the board designer suggested ("KeptRow") is a one-line change; the owner's default is the plain name.
   */
  wordmark: product,
  /** What it is, after the name on the share image. */
  tagline,
  /** The descriptor: the home page title, the footer and the share image's alt text. */
  descriptor: `${product} — ${tagline}`,
} as const;

/** The primary host; the apex and the old klarert.com hosts redirect here (src/lib/site/legacy-domain.ts). */
export const SITE_HOST = 'www.keptrow.com';
export const SITE_URL = `https://${SITE_HOST}`;

/** The one contact address the public pages, the legal pages and the security alerts give. */
export const SUPPORT_EMAIL = 'support@keptrow.com';

/** The sender when EMAIL_FROM is not set locally (Mailpit); hosted, EMAIL_FROM in Vercel says the same. */
export const EMAIL_SENDER = `${product} <no-reply@keptrow.com>`;
