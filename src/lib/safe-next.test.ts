import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('keeps paths on this site, with their query and hash', () => {
    expect(safeNext('/')).toBe('/');
    expect(safeNext('/acme/home')).toBe('/acme/home');
    expect(safeNext('/acme/s/abc?view=v1&item=RSK-3#files')).toBe(
      '/acme/s/abc?view=v1&item=RSK-3#files',
    );
    expect(safeNext('/invite/0f3c')).toBe('/invite/0f3c');
    expect(safeNext('/acme/evidence?q=ISO%2027001')).toBe('/acme/evidence?q=ISO%2027001');
  });

  it('normalises the path it returns', () => {
    expect(safeNext('/acme/../other')).toBe('/other');
  });

  it.each([
    ['backslash', '/\\evil.com'],
    ['backslash after a tab', '/\t/evil.com'],
    ['encoded backslash', '/%5Cevil.com'],
    ['encoded backslash, lower case', '/%5cevil.com'],
    ['double-encoded backslash', '/%255Cevil.com'],
    ['protocol-relative', '//evil.com'],
    ['protocol-relative with a path', '//evil.com/acme/home'],
    ['absolute URL', 'https://evil.com'],
    ['absolute URL to this site', 'https://www.klarert.com/acme'],
    ['encoded tab', '/%09/evil.com'],
    ['tab', '/\t'],
    ['line feed', '/\n/evil.com'],
    ['carriage return', '/\r/evil.com'],
    ['encoded line feed', '/%0A/evil.com'],
    ['encoded slash making //', '/%2Fevil.com'],
    ['NUL', '/\u0000evil.com'],
    ['DEL', '/\u007fevil.com'],
    ['javascript URL', 'javascript:alert(1)'],
    ['data URL', 'data:text/html,hi'],
    ['relative path', 'acme/home'],
    ['leading space', ' /acme'],
    ['broken escape', '/%E0%A4%A'],
    ['empty', ''],
  ])('refuses %s', (_, value) => {
    expect(safeNext(value)).toBeNull();
  });

  it('refuses values that are not strings and very long values', () => {
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext(null)).toBeNull();
    expect(safeNext(['/acme'])).toBeNull();
    expect(safeNext(`/${'a'.repeat(2048)}`)).toBeNull();
  });
});
