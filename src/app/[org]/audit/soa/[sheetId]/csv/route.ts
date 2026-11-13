import { exportSoa } from '@/server/commands/audit';
import { attachment, fromResult, refusal, sameOrigin } from '../../../download';

// The statement of applicability as CSV (docs/11 Audit outputs). A form POST from the SoA page or the library's
// toolbar; exportSoa authorises, reads under RLS and logs the export.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ org: string; sheetId: string }> },
) {
  if (!sameOrigin(req)) return refusal('Export from the app.');
  const { org, sheetId } = await params;
  const form = await req.formData().catch(() => null);
  const r = await exportSoa({ org, sheetId, all: form?.get('all') === '1' }, 'csv');
  if (!r.ok) return fromResult(r);
  return attachment(r.data.csv, r.data.filename, 'text/csv; charset=utf-8');
}
