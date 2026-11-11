import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
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
});
