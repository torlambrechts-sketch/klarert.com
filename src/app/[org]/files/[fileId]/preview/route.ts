import { previewFile } from '@/server/commands/files';

// Inline preview of a PDF or image (docs/05 §3.4 Files tab). The person's session reads the file through previewFile
// (membership, the download log, blocked and archived files). The content type is forced from the extension, never
// the uploader's claim, with nosniff, so nothing else can render. Every other type is download-only, through a signed
// link with Content-Disposition: attachment.

const STATUS: Record<string, number> = { unauthenticated: 401, forbidden: 403, not_found: 404 };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ org: string; fileId: string }> },
) {
  const { org, fileId } = await params;
  const r = await previewFile({ org, fileId });
  if (!r.ok)
    return new Response(r.error.message, {
      status: STATUS[r.error.code] ?? 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
    });
  return new Response(Buffer.from(r.data.bytes), {
    headers: {
      'Content-Type': r.data.type,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.data.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
