'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { createFolderAction, deleteFolderAction, renameFolderAction } from '@/app/[org]/s/actions';
import { ActionForm } from '@/components/forms/action-form';
import { SubmitButton, TextField } from '@/components/forms/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Folder = { id: string; name: string; sheetCount: number };

/** Folders card on Home: create, rename, delete when empty (docs/05 §2.1). */
export function FolderManager({ org, folders }: { org: string; folders: Folder[] }) {
  return (
    <div className="flex flex-col gap-4">
      <ActionForm
        action={createFolderAction}
        hidden={{ org }}
        reset
        success="Folder added."
        className="flex items-end gap-2"
        aria-label="New folder"
      >
        {(state) => (
          <>
            <div className="flex-1">
              <TextField
                label="New folder"
                name="name"
                placeholder="Health and safety"
                state={state}
              />
            </div>
            <SubmitButton variant="outline" pendingText="Adding…">
              Add folder
            </SubmitButton>
          </>
        )}
      </ActionForm>
      {folders.length === 0 ? (
        <p className="text-muted-foreground text-sm">No folders yet. Add the first one above.</p>
      ) : (
        <ul className="divide-line flex flex-col divide-y" aria-label="Folders">
          {folders.map((f) => (
            <FolderRow key={f.id} org={org} folder={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FolderRow({ org, folder }: { org: string; folder: Folder }) {
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  if (mode === 'rename')
    return (
      <li className="py-2">
        <ActionForm
          action={renameFolderAction}
          hidden={{ org, folderId: folder.id }}
          success="Folder renamed."
          onSuccess={() => setMode('view')}
          className="flex items-center gap-2"
          aria-label={`Rename ${folder.name}`}
        >
          <Input
            name="name"
            defaultValue={folder.name}
            aria-label={`New name for ${folder.name}`}
            autoFocus
            maxLength={80}
            onKeyDown={(e) => e.key === 'Escape' && setMode('view')}
          />
          <SubmitButton size="sm">Save</SubmitButton>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode('view')}>
            Cancel
          </Button>
        </ActionForm>
      </li>
    );
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="font-semibold">
        {folder.name}{' '}
        <span className="text-muted-foreground font-normal">
          · {folder.sheetCount === 1 ? '1 sheet' : `${folder.sheetCount} sheets`}
        </span>
      </span>
      {mode === 'delete' ? (
        <ActionForm
          action={deleteFolderAction}
          hidden={{ org, folderId: folder.id }}
          success="Folder deleted."
          onSuccess={() => setMode('view')}
          className="flex items-center gap-2"
          aria-label={`Delete ${folder.name}`}
        >
          <span className="text-sm">Delete this folder?</span>
          <SubmitButton size="sm" variant="destructive" pendingText="Deleting…">
            Delete folder
          </SubmitButton>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode('view')}>
            Cancel
          </Button>
        </ActionForm>
      ) : (
        <span className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setMode('rename')}
            aria-label={`Rename ${folder.name}`}
          >
            <Pencil aria-hidden /> Rename
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setMode('delete')}
            disabled={folder.sheetCount > 0}
            title={folder.sheetCount > 0 ? 'Move its sheets to another folder first' : undefined}
            aria-label={`Delete ${folder.name}`}
          >
            <Trash2 aria-hidden /> Delete
          </Button>
        </span>
      )}
    </li>
  );
}
