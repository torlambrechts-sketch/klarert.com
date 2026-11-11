import { SheetPanel } from '@/components/shell/sheet-panel';

export default async function Panel({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; sheetId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { org, sheetId } = await params;
  const { group } = await searchParams;
  return <SheetPanel org={org} sheetId={sheetId} activeGroup={group ?? null} />;
}
