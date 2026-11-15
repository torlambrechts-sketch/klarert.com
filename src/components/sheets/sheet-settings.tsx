'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { archiveSheetAction, updateSheetAction } from '@/app/[org]/s/actions';
import { ActionForm } from '@/components/forms/action-form';
import { FormError, SubmitButton, TextField } from '@/components/forms/form-bits';
import { Label } from '@/components/ui/label';
import { FolderSelect, type Folder } from './wizard/fields';

export type SheetSettingsValue = {
  id: string;
  name: string;
  description: string | null;
  itemLabel: string;
  idPrefix: string;
  prefixLocked: boolean;
  folderId: string | null;
  isLibrary: boolean;
  /** Automations wait until a row is finished (on unless switched off). */
  holdAutomations: boolean;
  archived: boolean;
};

/** FR-7: name, description, item label, ID prefix (only while there are no items), folder, library flag. */
export function SheetSettingsForm({
  org,
  sheet,
  folders,
}: {
  org: string;
  sheet: SheetSettingsValue;
  folders: Folder[];
}) {
  const descId = useId();
  const libId = useId();
  const holdId = useId();
  return (
    <ActionForm
      action={updateSheetAction}
      hidden={{ org, sheetId: sheet.id, isLibrary: 'false', holdAutomations: 'false' }}
      success="Sheet settings saved."
      className="flex flex-col gap-4"
      aria-label="Sheet settings"
    >
      {(state) => (
        <>
          <TextField
            label="Sheet name"
            name="name"
            defaultValue={sheet.name}
            maxLength={120}
            state={state}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descId}>Description</Label>
            <textarea
              id={descId}
              name="description"
              defaultValue={sheet.description ?? ''}
              rows={3}
              maxLength={2000}
              className="border-input focus-visible:ring-focus/25 bg-background-100 text-label-13 rounded-md border p-2 outline-none focus-visible:ring-[3px]"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Items are called"
              name="itemLabel"
              defaultValue={sheet.itemLabel}
              maxLength={40}
              state={state}
            />
            <TextField
              label="ID prefix"
              name="idPrefix"
              defaultValue={sheet.idPrefix}
              maxLength={7}
              disabled={sheet.prefixLocked}
              className="font-mono uppercase"
              hint={
                sheet.prefixLocked
                  ? 'Fixed once the sheet has items, so ids never change.'
                  : `Items will get ids like ${sheet.idPrefix}001.`
              }
              state={state}
            />
          </div>
          <FolderSelect folders={folders} value={sheet.folderId ?? ''} name="folderId" />
          <div className="flex items-start gap-2">
            <input
              id={libId}
              type="checkbox"
              name="isLibrary"
              value="true"
              defaultChecked={sheet.isLibrary}
              className="mt-0.5 size-4"
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={libId}>Library sheet</Label>
              <p className="text-muted-foreground text-copy-13">
                Requirement and control link fields of other sheets can point at its items.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <input
              id={holdId}
              type="checkbox"
              name="holdAutomations"
              value="true"
              defaultChecked={sheet.holdAutomations}
              className="mt-0.5 size-4"
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor={holdId}>Run automations when an item is finished</Label>
              <p className="text-muted-foreground text-copy-13">
                Edits in the table and the item panel wait until you move to another item, press Done
                or close the item. Switch off to run automations on every saved change.
              </p>
            </div>
          </div>
          <FormError state={state} />
          <div>
            <SubmitButton>Save settings</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Archive hides the sheet from the side menu; restore brings it back. */
export function ArchiveSheet({
  org,
  sheetId,
  archived,
}: {
  org: string;
  sheetId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  if (!archived && !confirming)
    return (
      <div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="border-crit text-crit hover:bg-crit/5 text-label-14 h-[40px] rounded-md border px-4 font-medium"
        >
          Archive sheet
        </button>
      </div>
    );
  return (
    <ActionForm
      action={archiveSheetAction}
      hidden={{ org, sheetId, archived: archived ? 'false' : 'true' }}
      success={archived ? 'Sheet restored.' : 'Sheet archived.'}
      onSuccess={(d) => {
        setConfirming(false);
        if (d.archived) router.push(`/${org}/home`);
      }}
      className="flex flex-wrap items-center gap-2"
      aria-label={archived ? 'Restore sheet' : 'Archive sheet'}
    >
      {archived ? (
        <SubmitButton variant="outline" pendingText="Restoring…">
          Restore sheet
        </SubmitButton>
      ) : (
        <>
          <span className="text-label-13">Archive this sheet? Its items are kept.</span>
          <SubmitButton variant="destructive" pendingText="Archiving…">
            Archive sheet
          </SubmitButton>
          <button
            type="button"
            className="hover:bg-soft text-label-14 h-[40px] rounded-md px-3"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </>
      )}
    </ActionForm>
  );
}
