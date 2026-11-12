import { describe, expect, it } from 'vitest';
import {
  BlockedUrlError,
  checkWebhookUrl,
  isBlockedAddress,
  v6ToBigInt,
  type Resolver,
} from './ssrf';

const answers =
  (...list: string[]): Resolver =>
  async () =>
    list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
const nxdomain: Resolver = async () => {
  throw new Error('ENOTFOUND');
};

describe('isBlockedAddress: IPv4', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254',
    '169.254.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.10',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.7',
    '203.0.113.5',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '11.0.0.1',
  ])('allows %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe('isBlockedAddress: IPv6', () => {
  it.each([
    '::',
    '::1',
    '[::1]',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:8.8.8.8', // mapped: refused whatever it embeds
    '::ffff:169.254.169.254',
    '0:0:0:0:0:ffff:a00:1',
    '::127.0.0.1', // IPv4-compatible
    '64:ff9b::a00:1', // NAT64
    '2002:7f00:1::', // 6to4
    '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
    '2001:db8::1',
    'fc00::1',
    'fd00:ec2::254', // cloud metadata over IPv6
    'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    'fe80::1',
    'febf::1',
    'fec0::1',
    'ff02::1',
    '100::1',
    'fe80::1%eth0', // zone ids are refused
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each([
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '2a00:1450:4001:82b::200e',
    '[2606:4700::1]',
  ])('allows %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));

  it('parses compressed forms and an IPv4 tail', () => {
    expect(v6ToBigInt('::ffff:1.2.3.4')).toBe(0xffff01020304n);
    expect(v6ToBigInt('1::')).toBe(1n << 112n);
    expect(v6ToBigInt('1:2:3:4:5:6:7:8')).toBe(0x00010002000300040005000600070008n);
    expect(v6ToBigInt('1::2::3')).toBeNull();
    expect(v6ToBigInt('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(v6ToBigInt('12345::')).toBeNull();
  });

  it('treats anything that is not an address as blocked', () => {
    expect(isBlockedAddress('example.com')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('checkWebhookUrl', () => {
  const ok = answers('93.184.216.34');

  it('accepts a public https URL', async () => {
    const url = await checkWebhookUrl('https://hooks.example.com/path?x=1', ok);
    expect(url.hostname).toBe('hooks.example.com');
  });

  it('accepts a public literal address', async () => {
    await expect(checkWebhookUrl('https://8.8.8.8/hook', nxdomain)).resolves.toBeInstanceOf(URL);
    await expect(
      checkWebhookUrl('https://[2606:4700:4700::1111]/hook', nxdomain),
    ).resolves.toBeInstanceOf(URL);
  });

  it.each([
    ['http://hooks.example.com/x', 'https:// addresses only'],
    ['ftp://hooks.example.com/x', 'https:// addresses only'],
    ['not a url', 'not a valid URL'],
    ['https://user:pass@hooks.example.com/x', 'user name or password'],
  ])('refuses %s', async (raw, message) => {
    await expect(checkWebhookUrl(raw, ok)).rejects.toThrow(message);
  });

  it.each([
    'https://127.0.0.1/x',
    'https://0x7f.1/x', // hex IPv4, normalised by URL to 127.0.0.1
    'https://2130706433/x', // decimal IPv4
    'https://0177.0.0.1/x', // octal IPv4
    'https://127.1/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/x',
    'https://[::ffff:127.0.0.1]/x',
    'https://[::ffff:a9fe:a9fe]/x',
    'https://[fd00:ec2::254]/x',
    'https://10.0.0.1:8443/x',
  ])('refuses the literal address in %s', async (raw) => {
    await expect(checkWebhookUrl(raw, ok)).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it.each([
    'https://localhost/x',
    'https://LOCALHOST./x',
    'https://api.localhost/x',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://metadata/x',
    'https://printer.local/x',
    'https://intranet/x',
  ])('refuses the internal name in %s without resolving it', async (raw) => {
    await expect(checkWebhookUrl(raw, ok)).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('refuses a name that resolves to a private address', async () => {
    await expect(
      checkWebhookUrl('https://evil.example.com/x', answers('10.1.2.3')),
    ).rejects.toThrow('private or internal network');
    await expect(checkWebhookUrl('https://evil.example.com/x', answers('::1'))).rejects.toThrow(
      'private or internal network',
    );
  });

  it('refuses when any one of several answers is private (rebinding-style multi-answer)', async () => {
    await expect(
      checkWebhookUrl('https://rebind.example.com/x', answers('93.184.216.34', '169.254.169.254')),
    ).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(
      checkWebhookUrl('https://rebind.example.com/x', answers('2606:4700::1', '::ffff:10.0.0.1')),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it('refuses names that do not resolve', async () => {
    await expect(checkWebhookUrl('https://nowhere.example.com/x', nxdomain)).rejects.toThrow(
      'could not be found',
    );
    await expect(checkWebhookUrl('https://empty.example.com/x', answers())).rejects.toThrow(
      'could not be found',
    );
  });
});
