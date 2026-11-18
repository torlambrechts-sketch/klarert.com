'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { createGroupAction } from '@/app/[org]/s/actions';
import { ActionForm } from '@/components/forms/action-form';
import { SubmitButton } from '@/components/forms/form-bits';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/** "+ New group": a button that opens a small inline form. */
export function NewGroupForm({
  org,
  sheetId,
  compact,
}: {
  org: string;
  sheetId: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={compact ? 'w-full justify-start' : undefined}
        onClick={() => setOpen(true)}
      >
        <Plus aria-hidden /> New group
      </Button>
    );
  return (
    <ActionForm
      action={createGroupAction}
      hidden={{ org, sheetId }}
      reset
      success="Group added."
      onSuccess={() => setOpen(false)}
      className="flex flex-col gap-2"
      aria-label="New group"
    >
      {(state) => (
        <>
          <Input
            name="name"
            aria-label="New group name"
            placeholder="Group name"
            autoFocus
            required
            maxLength={80}
            aria-invalid={state && !state.ok ? true : undefined}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          />
          {state && !state.ok && state.error.fieldErrors?.name ? (
            <p className="text-crit text-13">{state.error.fieldErrors.name}</p>
          ) : null}
          <div className="flex gap-2">
            <SubmitButton size="sm" pendingText="Adding…">
              Add group
            </SubmitButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
