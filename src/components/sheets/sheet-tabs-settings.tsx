'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { setSheetTabsAction } from '@/app/[org]/s/view-actions';
import type { SheetTab } from '@/engine/views/tabs';
import { TabsEditor, type TabRow } from '@/components/views/tabs-editor';

/** Sheet settings › Tabs: the same editor as the tab bar's "Customise tabs" (docs/05 §3). */
export function SheetTabsSettings({
  org,
  sheetId,
  rows,
  defaultViewId,
  templateDefault,
  canEdit,
}: {
  org: string;
  sheetId: string;
  rows: TabRow[];
  defaultViewId: string;
  templateDefault: SheetTab[] | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  return (
    <TabsEditor
      // a saved set comes back from the server as new rows: start the editor again from them
      key={JSON.stringify([rows, defaultViewId])}
      rows={rows}
      defaultViewId={defaultViewId}
      templateDefault={templateDefault}
      canEdit={canEdit}
      onSave={async (tabs, firstId) => {
        const r = await setSheetTabsAction({ org, sheetId, tabs, defaultViewId: firstId });
        if (!r.ok) {
          toast.error(r.error.message);
          return false;
        }
        toast('Tabs saved.', r.data.summary ? { description: r.data.summary } : undefined);
        if (r.data.notice) toast(r.data.notice);
        router.refresh();
        return true;
      }}
    />
  );
}
