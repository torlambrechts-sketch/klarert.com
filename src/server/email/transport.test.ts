import { describe, expect, it, vi } from 'vitest';
import {
  chooseTransport,
  deliver,
  emailConfigured,
  LOCAL_MAILPIT_URL,
  parseFrom,
  BREVO_URL,
  type EmailEnv,
  type EmailMessage,
} from './transport';

const message: EmailMessage = {
  to: 'grace@example.test',
  subject: 'Ada invited you to Acme',
  text: 'Secret body text',
  html: '<p>Secret body html</p>',
  tag: 'invite',
  idempotencyKey: 'invite/1234',
};

const HOSTED = 'https://abcd.supabase.co';
const LOCAL = 'http://127.0.0.1:54321';

type FetchArgs = [url: string, init: RequestInit];

function fakeFetch(status = 200, body: unknown = { id: 'msg_1' }) {
  return vi.fn<(...args: FetchArgs) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
}

function run(env: EmailEnv, fetch = fakeFetch()) {
  const log = vi.fn();
  return { log, fetch, result: deliver(message, { env, fetch, log }) };
}

/** Every logged value, as one string: never an address, subject or body. */
const logged = (log: ReturnType<typeof vi.fn>) => JSON.stringify(log.mock.calls);
const expectNoPersonalData = (log: ReturnType<typeof vi.fn>) => {
  const s = logged(log);
  expect(s).not.toContain('grace@example.test');
  expect(s).not.toContain('Ada invited you');
  expect(s).not.toContain('Secret body');
};

describe('chooseTransport', () => {
  const f = fakeFetch();
  it('uses Brevo when BREVO_API_KEY is set', () => {
    const c = chooseTransport(
      {
        BREVO_API_KEY: 'xkeysib-x',
        EMAIL_FROM: 'no-reply@mail.keptrow.com',
        NEXT_PUBLIC_SUPABASE_URL: HOSTED,
      },
      f,
    );
    expect(c.transport?.name).toBe('brevo');
  });

  it('uses Brevo on Vercel even though Vercel sets CI while it builds', () => {
    const c = chooseTransport(
      {
        BREVO_API_KEY: 'xkeysib-x',
        EMAIL_FROM: 'a@b.co',
        CI: '1',
        VERCEL: '1',
        NEXT_PUBLIC_SUPABASE_URL: HOSTED,
      },
      f,
    );
    expect(c.transport?.name).toBe('brevo');
  });

  it('uses local Mailpit without a key when Supabase is on this machine', () => {
    for (const url of [LOCAL, 'http://localhost:54321', 'http://host.docker.internal:54321'])
      expect(chooseTransport({ NEXT_PUBLIC_SUPABASE_URL: url }, f).transport?.name).toBe('local');
  });

  it('never sends real mail from CI: the key is ignored there', () => {
    expect(
      chooseTransport(
        {
          BREVO_API_KEY: 'xkeysib-x',
          EMAIL_FROM: 'a@b.co',
          CI: 'true',
          NEXT_PUBLIC_SUPABASE_URL: LOCAL,
        },
        f,
      ).transport?.name,
    ).toBe('local');
    const hosted = chooseTransport(
      {
        BREVO_API_KEY: 'xkeysib-x',
        EMAIL_FROM: 'a@b.co',
        CI: 'true',
        NEXT_PUBLIC_SUPABASE_URL: HOSTED,
      },
      f,
    );
    expect(hosted.transport).toBeNull();
  });

  it('fails closed without a key for a hosted Supabase', () => {
    const c = chooseTransport({ NEXT_PUBLIC_SUPABASE_URL: HOSTED }, f);
    expect(c.transport).toBeNull();
    expect(c.transport === null && c.problem).toMatch(/BREVO_API_KEY is not set/);
    expect(chooseTransport({ NEXT_PUBLIC_SUPABASE_URL: 'not a url' }, f).transport).toBeNull();
    expect(chooseTransport({}, f).transport).toBeNull();
    expect(
      chooseTransport({ BREVO_API_KEY: '  ', NEXT_PUBLIC_SUPABASE_URL: HOSTED }, f).transport,
    ).toBeNull();
  });

  it('fails closed when EMAIL_FROM is missing or not an address', () => {
    for (const from of [undefined, '', 'Keptrow', 'no-reply@'])
      expect(
        chooseTransport(
          { BREVO_API_KEY: 'xkeysib-x', EMAIL_FROM: from, NEXT_PUBLIC_SUPABASE_URL: HOSTED },
          f,
        ).transport,
      ).toBeNull();
  });

  it('emailConfigured follows the same rules', () => {
    expect(emailConfigured({ NEXT_PUBLIC_SUPABASE_URL: LOCAL })).toBe(true);
    expect(emailConfigured({ NEXT_PUBLIC_SUPABASE_URL: HOSTED })).toBe(false);
  });
});

describe('parseFrom', () => {
  it('reads a name and an address, or a bare address', () => {
    expect(parseFrom('Keptrow <no-reply@mail.keptrow.com>')).toEqual({
      name: 'Keptrow',
      email: 'no-reply@mail.keptrow.com',
    });
    expect(parseFrom('"Keptrow" <no-reply@mail.keptrow.com>')?.name).toBe('Keptrow');
    expect(parseFrom('no-reply@mail.keptrow.com')).toEqual({
      name: '',
      email: 'no-reply@mail.keptrow.com',
    });
    expect(parseFrom('nobody')).toBeNull();
    expect(parseFrom(undefined)).toBeNull();
  });
});

describe('deliver with Brevo', () => {
  const env = {
    BREVO_API_KEY: 'xkeysib-test',
    EMAIL_FROM: 'Keptrow <no-reply@mail.keptrow.com>',
    NEXT_PUBLIC_SUPABASE_URL: HOSTED,
  };
  const created = { messageId: '<202611151800.1@smtp-relay.mailin.fr>' };

  it('posts the message with the key, the sender, the tag and the trace key', async () => {
    const { fetch, log, result } = run(env, fakeFetch(201, created));
    expect(await result).toEqual({ sent: true, id: created.messageId });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(BREVO_URL);
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'api-key': 'xkeysib-test',
      'content-type': 'application/json',
      accept: 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      sender: { email: 'no-reply@mail.keptrow.com', name: 'Keptrow' },
      to: [
        {
          email: 'grace@example.test',
          contactPixelTrackingConsent: false,
          removeTrackingPixel: true,
        },
      ],
      subject: 'Ada invited you to Acme',
      htmlContent: '<p>Secret body html</p>',
      textContent: 'Secret body text',
      tags: ['invite'],
      headers: { 'X-Mailin-custom': 'invite/1234' },
    });
    expect(log).toHaveBeenCalledWith('info', {
      tag: 'invite',
      transport: 'brevo',
      outcome: 'sent',
    });
    expectNoPersonalData(log);
  });

  it('sends a bare address without a name', async () => {
    const { fetch, result } = run(
      { ...env, EMAIL_FROM: 'no-reply@mail.keptrow.com' },
      fakeFetch(201, created),
    );
    await result;
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body)).sender).toEqual({
      email: 'no-reply@mail.keptrow.com',
    });
  });

  it.each([
    [
      400,
      'rejected',
      { code: 'invalid_parameter', message: 'email is not valid: grace@example.test' },
    ],
    [401, 'rejected', { code: 'unauthorized', message: 'Key not found' }],
    [429, 'unavailable', { code: 'too_many_requests', message: 'grace@example.test' }],
    [503, 'unavailable', { message: 'Service unavailable' }],
  ] as const)('reports %i as %s with the status code only', async (status, reason, body) => {
    const { log, result } = run(env, fakeFetch(status, body));
    expect(await result).toEqual({ sent: false, reason });
    expect(log).toHaveBeenCalledWith('error', {
      tag: 'invite',
      transport: 'brevo',
      outcome: reason,
      status,
    });
    expectNoPersonalData(log);
    expect(logged(log)).not.toContain(body.message);
  });

  it('never throws on a network error or timeout', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('fetch failed for grace@example.test');
    });
    const { log, result } = run(env, failing as never);
    expect(await result).toEqual({ sent: false, reason: 'unavailable' });
    expect(log).toHaveBeenCalledWith('error', {
      tag: 'invite',
      transport: 'brevo',
      outcome: 'unavailable',
      error: 'TypeError',
    });
    expectNoPersonalData(log);
  });
});

describe('deliver to local Mailpit', () => {
  it('posts to the Mailpit send API with the tag', async () => {
    const { fetch, log, result } = run(
      { NEXT_PUBLIC_SUPABASE_URL: LOCAL },
      fakeFetch(200, { ID: 'mp_1' }),
    );
    expect(await result).toEqual({ sent: true, id: 'mp_1' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${LOCAL_MAILPIT_URL}/api/v1/send`);
    expect(JSON.parse(String(init.body))).toEqual({
      From: { Email: 'no-reply@mail.keptrow.com', Name: 'Keptrow' },
      To: [{ Email: 'grace@example.test' }],
      Subject: 'Ada invited you to Acme',
      Text: 'Secret body text',
      HTML: '<p>Secret body html</p>',
      Tags: ['invite'],
    });
    expect(log).toHaveBeenCalledWith('info', {
      tag: 'invite',
      transport: 'local',
      outcome: 'sent',
    });
  });

  it('follows MAILPIT_URL and EMAIL_FROM', async () => {
    const { fetch, result } = run({
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      MAILPIT_URL: 'http://127.0.0.1:9025/',
      EMAIL_FROM: 'Test <test@example.test>',
    });
    await result;
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:9025/api/v1/send');
    expect(JSON.parse(String(init.body)).From).toEqual({
      Email: 'test@example.test',
      Name: 'Test',
    });
  });
});

describe('deliver fails closed', () => {
  it('sends nothing without a transport and logs one clear error', async () => {
    const { fetch, log, result } = run({ NEXT_PUBLIC_SUPABASE_URL: HOSTED });
    expect(await result).toEqual({ sent: false, reason: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('error', {
      tag: 'invite',
      outcome: 'not_configured',
      message:
        'BREVO_API_KEY is not set: no email is sent until BREVO_API_KEY and EMAIL_FROM are set',
    });
    expectNoPersonalData(log);
  });

  it('sends nothing with a key but no sender', async () => {
    const { fetch, log, result } = run({
      BREVO_API_KEY: 'xkeysib-x',
      NEXT_PUBLIC_SUPABASE_URL: HOSTED,
    });
    expect(await result).toEqual({ sent: false, reason: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
    expect(logged(log)).toContain('EMAIL_FROM is missing');
  });
});
