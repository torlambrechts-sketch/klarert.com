// The heart of confirmUpload (docs/02 §8, FR-30): read the uploaded object back, hash it on the server, compare with
// the browser's checksum and size, check what the bytes really are (allow-list, magic bytes, no programs), and only
// then record the file. Kept free of `server-only` and of Supabase so the refusal paths are unit-tested; the command
// in ./files.ts supplies the real dependencies.
import type { FileRow } from '@/engine/types';
import { fail, type Result } from '@/server/result';

export const CHANGED_DURING_UPLOAD = 'The file changed during upload. Try again.';

export interface ConfirmDeps {
  /** The object's bytes, read with the person's own client (storage RLS), or null when it is not there. */
  download(path: string): Promise<Uint8Array | null>;
  sha256(bytes: Uint8Array): string;
  /** What is wrong with the stored bytes (type, size, content), or null when they may be kept. */
  inspect?(bytes: Uint8Array): string | null;
  /** Writes the files row and the activity entry in one transaction (add_file RPC). */
  addFile(): Promise<Result<FileRow>>;
  /** Removes a refused object (the uploader may delete their own pending upload, 0054). Failures are only logged. */
  discard?(path: string): Promise<void>;
  log(fields: Record<string, unknown>): void;
}

export async function confirmWith(
  deps: ConfirmDeps,
  expected: { path: string; sha256: string; size: number },
): Promise<Result<FileRow>> {
  const bytes = await deps.download(expected.path);
  if (!bytes) {
    deps.log({ outcome: 'missing', path: expected.path });
    return fail('not_found', 'The upload did not arrive. Try again.');
  }
  const actual = deps.sha256(bytes);
  if (actual !== expected.sha256 || bytes.byteLength !== expected.size) {
    // No files row ever points at it; the uploader's pending object is removed (0054) and the attempt logged.
    deps.log({
      outcome: 'hash_mismatch',
      path: expected.path,
      expected: expected.sha256,
      actual,
      size: bytes.byteLength,
    });
    await discard(deps, expected.path);
    return fail('conflict', CHANGED_DURING_UPLOAD);
  }
  const refused = deps.inspect?.(bytes) ?? null;
  if (refused) {
    // never recorded: the object is removed so it cannot be served from storage (SA-9)
    deps.log({ outcome: 'refused', path: expected.path, reason: refused });
    await discard(deps, expected.path);
    return fail('invalid', refused);
  }
  return deps.addFile();
}

async function discard(deps: ConfirmDeps, path: string) {
  if (!deps.discard) return;
  try {
    await deps.discard(path);
  } catch (e) {
    deps.log({ outcome: 'discard_failed', path, reason: e instanceof Error ? e.message : String(e) });
  }
}
