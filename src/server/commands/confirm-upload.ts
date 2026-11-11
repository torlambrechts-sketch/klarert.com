// The heart of confirmUpload (docs/02 §8, FR-30): read the uploaded object back, hash it on the server, compare with
// the browser's checksum and size, and only then record the file. Kept free of `server-only` and of Supabase so the
// mismatch path is unit-tested; the command in ./files.ts supplies the real dependencies.
import type { FileRow } from '@/engine/types';
import { fail, type Result } from '@/server/result';

export const CHANGED_DURING_UPLOAD = 'The file changed during upload. Try again.';

export interface ConfirmDeps {
  /** The object's bytes, read with the person's own client (storage RLS), or null when it is not there. */
  download(path: string): Promise<Uint8Array | null>;
  sha256(bytes: Uint8Array): string;
  /** Writes the files row and the activity entry in one transaction (add_file RPC). */
  addFile(): Promise<Result<FileRow>>;
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
    // Nothing is deleted (files are immutable, no delete policy): the object stays unreferenced and the attempt is
    // recorded as failed in the command log.
    deps.log({
      outcome: 'hash_mismatch',
      path: expected.path,
      expected: expected.sha256,
      actual,
      size: bytes.byteLength,
    });
    return fail('conflict', CHANGED_DURING_UPLOAD);
  }
  return deps.addFile();
}
