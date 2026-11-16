import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';
import { LEGACY_HOSTS, LEGACY_REDIRECTS, legacyRedirectTarget } from './legacy-domain';

describe('klarert.com redirects to www.keptrow.com (docs/14)', () => {
  it('sends both old hosts to the same path and query on www.keptrow.com', () => {
    expect(legacyRedirectTarget('klarert.com', '/')).toBe('https://www.keptrow.com/');
    expect(legacyRedirectTarget('www.klarert.com', '/privacy')).toBe(
      'https://www.keptrow.com/privacy',
    );
    expect(legacyRedirectTarget('www.klarert.com', '/login?mode=signup')).toBe(
      'https://www.keptrow.com/login?mode=signup',
    );
    expect(legacyRedirectTarget('klarert.com', '/acme/s/123?view=grid#x')).toBe(
      'https://www.keptrow.com/acme/s/123?view=grid#x',
    );
  });

  it('reads a Host header as browsers and proxies send it: any case, a port, a trailing dot', () => {
    expect(legacyRedirectTarget('WWW.Klarert.COM', '/terms')).toBe('https://www.keptrow.com/terms');
    expect(legacyRedirectTarget('klarert.com:443', '/')).toBe('https://www.keptrow.com/');
    expect(legacyRedirectTarget('klarert.com.', '/')).toBe('https://www.keptrow.com/');
  });

  it('leaves every other host alone, look-alikes included', () => {
    for (const host of [
      'www.keptrow.com',
      'keptrow.com',
      'localhost:3000',
      'mail.klarert.com',
      'klarert.com.evil.test',
      'notklarert.com',
      'klarert.co',
      '',
      null,
      undefined,
    ])
      expect(legacyRedirectTarget(host, '/'), String(host)).toBeNull();
  });

  it('the next.config.ts rule matches exactly the old hosts, as a permanent 301 keeping the path', () => {
    expect(LEGACY_REDIRECTS).toHaveLength(1);
    const [rule] = LEGACY_REDIRECTS;
    expect(rule).toMatchObject({
      source: '/:path*',
      destination: 'https://www.keptrow.com/:path*',
      statusCode: 301,
    });
    // Next.js matches a `has` host value against the whole host
    const host = new RegExp(`^(?:${rule!.has[0]!.value})$`);
    for (const h of LEGACY_HOSTS) expect(host.test(h), h).toBe(true);
    for (const h of ['www.keptrow.com', 'keptrow.com', 'mail.klarert.com', 'klarert.com.evil.test'])
      expect(host.test(h), h).toBe(false);
  });

  it('next.config.ts serves these rules', async () => {
    expect(await nextConfig.redirects?.()).toEqual(LEGACY_REDIRECTS);
  });
});
