import { listAuditExports } from '@/server/commands/audit';
import { ExportsList } from './exports-list';

// The Exports list's first page, read on the server inside a Suspense boundary (the skeleton shows meanwhile); a
// refusal or a failed read reaches the list as an error with Retry.
export async function ExportsSection({ org }: { org: string }) {
  const initial = await listAuditExports({ org });
  return <ExportsList org={org} initial={initial} />;
}
