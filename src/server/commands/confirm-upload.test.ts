import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { checkUpload } from '@/engine/item-files';
import { makeFile } from '@/engine/testing/fixtures';
import { ok } from '@/server/result';
import { CHANGED_DURING_UPLOAD, confirmWith, type ConfirmDeps } from './confirm-upload';

const bytes = new TextEncoder().encode('Fire drill report, May');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const row = makeFile({ itemId: 'i', fieldId: 'f' });

function deps(stored: Uint8Array | null): ConfirmDeps & { addFile: ReturnType<typeof vi.fn> } {
  return {
    download: vi.fn(async () => stored),
    sha256: sha,
    addFile: vi.fn(async () => ok(row)),
    log: vi.fn(),
  };
}

describe('confirmUpload', () => {
  const expected = {
    path: 'org/o/item/i/f/report.pdf',
    sha256: sha(bytes),
    size: bytes.byteLength,
  };

  it('records the file when the server-side hash matches', async () => {
    const d = deps(bytes);
    expect(await confirmWith(d, expected)).toEqual({ ok: true, data: row });
    expect(d.download).toHaveBeenCalledWith(expected.path);
    expect(d.addFile).toHaveBeenCalledTimes(1);
  });

  it('refuses and records nothing when the stored bytes differ from what the browser hashed', async () => {
    const tampered = new TextEncoder().encode('Fire drill report, June');
    const d = deps(tampered);
    expect(await confirmWith(d, expected)).toEqual({
      ok: false,
      error: { code: 'conflict', message: CHANGED_DURING_UPLOAD },
    });
    expect(d.addFile).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'hash_mismatch' }));
  });

  it('refuses a size mismatch even with the right hash claimed', async () => {
    const d = deps(bytes);
    const r = await confirmWith(d, { ...expected, size: expected.size + 1 });
    expect(r.ok).toBe(false);
    expect(d.addFile).not.toHaveBeenCalled();
  });

  it('reports a missing object', async () => {
    const d = deps(null);
    const r = await confirmWith(d, expected);
    expect(r).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(d.addFile).not.toHaveBeenCalled();
  });

  it('checks the stored bytes against the name: a program renamed to .pdf is refused with a reason', async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0]);
    const d = {
      ...deps(exe),
      inspect: (b: Uint8Array) => {
        const r = checkUpload('invoice.pdf', b.byteLength, b);
        return r.ok ? null : r.reason;
      },
    };
    const r = await confirmWith(d, { ...expected, sha256: sha(exe), size: exe.byteLength });
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'invalid',
        message: 'This file contains a program or web page and is not allowed.',
      },
    });
    expect(d.addFile).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'refused' }));
  });

  it('keeps a real PDF', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 drill');
    const d = { ...deps(pdf), inspect: () => null };
    expect(await confirmWith(d, { ...expected, sha256: sha(pdf), size: pdf.byteLength })).toEqual({
      ok: true,
      data: row,
    });
  });

  it('removes a refused or changed upload so it cannot be served from storage (SA-9)', async () => {
    const tampered = new TextEncoder().encode('Fire drill report, June');
    const d = { ...deps(tampered), discard: vi.fn(async () => {}) };
    await confirmWith(d, expected);
    expect(d.discard).toHaveBeenCalledWith(expected.path);
    const program = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, ...bytes]);
    const p = { ...deps(program), discard: vi.fn(async () => {}) };
    p.inspect = (b: Uint8Array) => {
      const c = checkUpload('report.pdf', b.byteLength, b.subarray(0, 4096));
      return c.ok ? null : c.reason;
    };
    const r = await confirmWith(p, { ...expected, sha256: sha(program), size: program.byteLength });
    expect(r.ok).toBe(false);
    expect(p.discard).toHaveBeenCalledWith(expected.path);
    expect(p.addFile).not.toHaveBeenCalled();
  });

  it('a failed removal is logged, never thrown', async () => {
    const d = {
      ...deps(new TextEncoder().encode('other')),
      discard: vi.fn(async () => {
        throw new Error('storage down');
      }),
    };
    const r = await confirmWith(d, expected);
    expect(r.ok).toBe(false);
    expect(d.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'discard_failed' }));
  });
});
