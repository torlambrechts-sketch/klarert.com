import { SheetPanel } from '@/components/shell/sheet-panel';

export default async function Panel({
  params,
}: {
  params: Promise<{ org: string; sheetId: string }>;
}) {
  const { org, sheetId } = await params;
  return <SheetPanel org={org} sheetId={sheetId} activeGroup={null} />;
}
