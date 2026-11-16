import { describe, expect, it } from 'vitest';
import { escapeHtml, inviteEmail, type InviteEmailInput } from './templates';

const base: InviteEmailInput = {
  workspace: 'Acme Engineering',
  inviter: 'Ada Lovelace',
  role: 'editor',
  email: 'grace@example.test',
  link: 'https://www.keptrow.com/invite/abc123',
  linkExpiresAt: '2026-11-29T17:00:00.000Z',
  timeZone: 'Europe/Oslo',
};

describe('inviteEmail', () => {
  it('names the inviter, the workspace and the role', () => {
    const e = inviteEmail(base);
    expect(e.subject).toBe('Ada Lovelace invited you to Acme Engineering on Keptrow');
    expect(e.text).toContain(
      'Ada Lovelace invited you to join the workspace Acme Engineering on Keptrow as an editor.',
    );
    expect(e.html).toContain('as an editor.');
  });

  it('says in one sentence what the role can do', () => {
    expect(inviteEmail(base).text).toContain(
      'Editors add and change items, and create sheets, fields, views and automations.',
    );
    expect(inviteEmail({ ...base, role: 'viewer' }).text).toContain('as a viewer.');
    expect(inviteEmail({ ...base, role: 'viewer' }).text).toContain(
      'Viewers see sheets, items and activity, but cannot change anything.',
    );
    expect(inviteEmail({ ...base, role: 'admin' }).text).toContain('as an admin.');
  });

  it('holds the link, linked and written out, with the expiry date in the workspace time zone', () => {
    const e = inviteEmail(base);
    expect(e.text).toContain('Accept the invite:\nhttps://www.keptrow.com/invite/abc123');
    expect(e.html).toContain('<a href="https://www.keptrow.com/invite/abc123"');
    expect(e.html.match(/https:\/\/www\.keptrow\.com\/invite\/abc123/g)).toHaveLength(2);
    expect(e.text).toContain(
      'The link works once, for grace@example.test only, until 29 Nov 2026.',
    );
    // 23:30 UTC is already the next day in Oslo
    expect(inviteEmail({ ...base, linkExpiresAt: '2026-11-29T23:30:00.000Z' }).text).toContain(
      'until 30 Nov 2026.',
    );
  });

  it('tells an auditor when their access ends, and nobody else', () => {
    const auditor = inviteEmail({
      ...base,
      role: 'auditor',
      accessEndsAt: '2026-12-31T22:59:59.999Z',
    });
    expect(auditor.text).toContain('as an auditor.');
    expect(auditor.text).toContain('Your read-only access ends on 31 Dec 2026.');
    expect(inviteEmail({ ...base, accessEndsAt: '2026-12-31T22:59:59.999Z' }).text).not.toContain(
      'access ends',
    );
  });

  it('escapes names in the HTML and keeps the subject on one line', () => {
    const e = inviteEmail({
      ...base,
      workspace: 'R&D <script>alert(1)</script>',
      inviter: 'Eve\r\nBcc: x@evil.test',
    });
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('R&amp;D &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(e.subject).not.toMatch(/[\r\n]/);
    expect(e.subject).toBe(
      'Eve Bcc: x@evil.test invited you to R&D <script>alert(1)</script> on Keptrow',
    );
  });

  it('is plain: no images, no remote resources, no tracking', () => {
    const { html } = inviteEmail(base);
    expect(html).not.toMatch(/<img|<link|<script|<iframe|url\(|src=/i);
    // the only link is the invite
    expect([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([base.link]);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<title>');
  });

  it('uses sentence case and no exclamation marks', () => {
    const { subject, text } = inviteEmail(base);
    expect(`${subject}\n${text}`).not.toContain('!');
    expect(text).toContain('If you did not expect this invite, you can ignore this email.');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});
