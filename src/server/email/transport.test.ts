import { describe, expect, it, vi } from 'vitest';
import {
  chooseTransport,
  deliver,
  emailConfigured,
  LOCAL_MAILPIT_URL,
  parseFrom,
  RESEND_URL,
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

function fakeFetch(status = 200, body: unknown = { id: 'msg_1' }) {
  return vi.fn(
    async (_url: string, _init: RequestInit) =>
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
  it('uses Resend when RESEND_API_KEY is set', () => {
    const c = chooseTransport(
      {
        RESEND_API_KEY: 're_x',
        EMAIL_FROM: 'no-reply@mail.klarert.com',
        NEXT_PUBLIC_SUPABASE_URL: HOSTED,
      },
      f,
    );
    expect(c.transport?.name).toBe('resend');
  });

  it('uses Resend on Vercel even though Vercel sets CI while it builds', () => {
    const c = chooseTransport(
      {
        RESEND_API_KEY: 're_x',
        EMAIL_FROM: 'a@b.co',
        CI: '1',
        VERCEL: '1',
        NEXT_PUBLIC_SUPABASE_URL: HOSTED,
      },
      f,
    );
    expect(c.transport?.name).toBe('resend');
  });

  it('uses local Mailpit without a key when Supabase is on this machine', () => {
    for (const url of [LOCAL, 'http://localhost:54321', 'http://host.docker.internal:54321'])
      expect(chooseTransport({ NEXT_PUBLIC_SUPABASE_URL: url }, f).transport?.name).toBe('local');
  });

  it('never sends real mail from CI: the key is ignored there', () => {
    expect(
      chooseTransport(
        {
          RESEND_API_KEY: 're_x',
          EMAIL_FROM: 'a@b.co',
          CI: 'true',
          NEXT_PUBLIC_SUPABASE_URL: LOCAL,
        },
        f,
      ).transport?.name,
    ).toBe('local');
    const hosted = chooseTransport(
      {
        RESEND_API_KEY: 're_x',
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
    expect(c.transport === null && c.problem).toMatch(/RESEND_API_KEY is not set/);
    expect(chooseTransport({ NEXT_PUBLIC_SUPABASE_URL: 'not a url' }, f).transport).toBeNull();
    expect(chooseTransport({}, f).transport).toBeNull();
    expect(
      chooseTransport({ RESEND_API_KEY: '  ', NEXT_PUBLIC_SUPABASE_URL: HOSTED }, f).transport,
    ).toBeNull();
  });

  it('fails closed when EMAIL_FROM is missing or not an address', () => {
    for (const from of [undefined, '', 'Compliance OS', 'no-reply@'])
      expect(
        chooseTransport(
          { RESEND_API_KEY: 're_x', EMAIL_FROM: from, NEXT_PUBLIC_SUPABASE_URL: HOSTED },
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
    expect(parseFrom('Compliance OS <no-reply@mail.klarert.com>')).toEqual({
      name: 'Compliance OS',
      email: 'no-reply@mail.klarert.com',
    });
    expect(parseFrom('"Klarert" <no-reply@mail.klarert.com>')?.name).toBe('Klarert');
    expect(parseFrom('no-reply@mail.klarert.com')).toEqual({
      name: '',
      email: 'no-reply@mail.klarert.com',
    });
    expect(parseFrom('nobody')).toBeNull();
    expect(parseFrom(undefined)).toBeNull();
  });
});

describe('deliver with Resend', () => {
  const env = {
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'Compliance OS <no-reply@mail.klarert.com>',
    NEXT_PUBLIC_SUPABASE_URL: HOSTED,
  };

  it('posts the message with the key, the sender, the tag and the idempotency key', async () => {
    const { fetch, log, result } = run(env);
    expect(await result).toEqual({ sent: true, id: 'msg_1' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(RESEND_URL);
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'invite/1234',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'Compliance OS <no-reply@mail.klarert.com>',
      to: ['grace@example.test'],
      subject: 'Ada invited you to Acme',
      text: 'Secret body text',
      html: '<p>Secret body html</p>',
      tags: [{ name: 'category', value: 'invite' }],
    });
    expect(log).toHaveBeenCalledWith('info', {
      tag: 'invite',
      transport: 'resend',
      outcome: 'sent',
    });
    expectNoPersonalData(log);
  });

  it('reports a refusal with the status code only', async () => {
    const { log, result } = run(
      env,
      fakeFetch(422, { name: 'validation_error', message: 'Invalid `to`: grace@example.test' }),
    );
    expect(await result).toEqual({ sent: false, reason: 'rejected' });
    expect(log).toHaveBeenCalledWith('error', {
      tag: 'invite',
      transport: 'resend',
      outcome: 'rejected',
      status: 422,
    });
    expectNoPersonalData(log);
  });

  it('treats rate limits and server errors as unavailable', async () => {
    expect(await run(env, fakeFetch(429)).result).toEqual({ sent: false, reason: 'unavailable' });
    expect(await run(env, fakeFetch(503)).result).toEqual({ sent: false, reason: 'unavailable' });
  });

  it('never throws on a network error or timeout', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('fetch failed for grace@example.test');
    });
    const { log, result } = run(env, failing as never);
    expect(await result).toEqual({ sent: false, reason: 'unavailable' });
    expect(log).toHaveBeenCalledWith('error', {
      tag: 'invite',
      transport: 'resend',
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
      From: { Email: 'no-reply@mail.klarert.com', Name: 'Compliance OS' },
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
        'RESEND_API_KEY is not set: no email is sent until RESEND_API_KEY and EMAIL_FROM are set',
    });
    expectNoPersonalData(log);
  });

  it('sends nothing with a key but no sender', async () => {
    const { fetch, log, result } = run({
      RESEND_API_KEY: 're_x',
      NEXT_PUBLIC_SUPABASE_URL: HOSTED,
    });
    expect(await result).toEqual({ sent: false, reason: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
    expect(logged(log)).toContain('EMAIL_FROM is missing');
  });
});
