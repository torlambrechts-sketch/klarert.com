import { buildAuditPack } from '@/server/commands/audit';
import { attachment, fromResult, refusal, sameOrigin } from '../download';

// The audit pack zip (docs/11 Audit outputs): scope, period and whether to include files come as a form POST;
// buildAuditPack authorises, reads under RLS, checks the hash chains and logs the export.

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ org: string }> }) {
  if (!sameOrigin(req)) return refusal('Export from the app.');
  const { org } = await params;
  const form = await req.formData().catch(() => null);
  const r = await buildAuditPack({
    org,
    scope: form?.get('scope'),
    from: form?.get('from'),
    to: form?.get('to'),
    files: form?.get('files') === '1',
  });
  if (!r.ok) return fromResult(r);
  return attachment(Buffer.from(r.data.bytes), r.data.filename, 'application/zip');
}
