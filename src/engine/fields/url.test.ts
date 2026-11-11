import { describe, expect, it } from 'vitest';
import { contract } from '../testing/contract';
import { makeCtx } from '../testing/fixtures';
import { url, urlHost } from './url';

describe('url', () => {
  contract(url, {
    valid: [
      ['https://example.com/policy.pdf', 'https://example.com/policy.pdf'],
      ['http://example.com', 'https://example.com'],
      ['example.com', 'https://example.com'],
      ['www.gov.uk/guidance?x=1', 'https://www.gov.uk/guidance?x=1'],
    ],
    invalid: [
      'javascript:alert(1)',
      'not a url',
      '',
      null,
      'ftp://example.com',
      'mailto:a@example.com',
    ],
    parse: [
      ['=HYPERLINK("https://example.com/a","Policy")', 'https://example.com/a'],
      ['HTTP://Example.com/Docs', 'https://Example.com/Docs'],
      ['iso.org', 'https://iso.org'],
    ],
    text: [
      ['https://www.gov.uk/guidance/x', 'https://www.gov.uk/guidance/x'],
      ['https://example.com:8443/a', 'https://example.com:8443/a'],
    ],
    order: ['https://a.example.com', 'https://b.example.com'],
    empty: [
      ['', true],
      ['https://example.com', false],
    ],
  });

  it('upgrades http to https and accepts a host with a port', () => {
    expect(url.normalize('http://intranet.example.com/x', {}, makeCtx())).toBe(
      'https://intranet.example.com/x',
    );
    expect(url.normalize('example.com:8080/x', {}, makeCtx())).toBe('https://example.com:8080/x');
  });
});

describe('urlHost', () => {
  it('shows only the host in the cell, keeping the full address as text', () => {
    expect(urlHost('https://www.gov.uk/guidance/x')).toBe('www.gov.uk');
    expect(urlHost('https://example.com:8443/a')).toBe('example.com:8443');
    expect(urlHost(null)).toBe('');
  });
});
