'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { setNewItemFormAction } from '@/app/[org]/s/view-actions';
import { Button } from '@/components/ui/button';

// Sheet settings › New item form (docs/05 §3.7, Phase B): what the sheet's New item dialog asks. The standard dialog
// (the name, required fields and the fields marked "Ask when adding"), or one of the sheet's forms, a step at a time
// when the form has steps. A pack may ship one of its forms as the intake form; the sheet follows it until someone
// chooses here. A closed or deleted form falls back to the standard dialog. Owners and admins choose.

export interface NewItemFormChoice {
  id: string;
  name: string;
  /** "Internal · 3 steps · Draft". */
  summary: string;
  /** The form is closed: the dialog would ask the standard questions. */
  closed: boolean;
  /** A pack's intake form. */
  intake: boolean;
}

export function NewItemFormSetting({
  org,
  sheetId,
  setting,
  forms,
  canChange,
}: {
  org: string;
  sheetId: string;
  /** sheets.settings.newItemForm: a form id, false for the standard dialog, null to follow the pack. */
  setting: string | false | null;
  forms: NewItemFormChoice[];
  canChange: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(setting);
  const [busy, setBusy] = useState(false);
  const packForm = forms.find((f) => f.intake) ?? null;
  // what the dialog asks now: the chosen form, else the pack's, else the standard dialog
  const chosen =
    value === false
      ? null
      : typeof value === 'string'
        ? (forms.find((f) => f.id === value) ?? null)
        : packForm;
  const current = chosen && !chosen.closed ? chosen.id : 'standard';

  const save = async (next: string | false | null) => {
    const before = value;
    setBusy(true);
    setValue(next);
    const r = await setNewItemFormAction({ org, sheetId, formId: next });
    setBusy(false);
    if (!r.ok) {
      setValue(before);
      return toast.error(r.error.message);
    }
    toast('New item form saved.');
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset
        className="flex flex-col gap-2"
        disabled={!canChange || busy}
        aria-describedby={`${id}-help`}
      >
        <legend className="sr-only">What the New item dialog asks</legend>
        <label className="border-line has-[:checked]:border-ink flex items-start gap-3 rounded-md border p-3">
          <input
            type="radio"
            name={`${id}-form`}
            className="mt-1"
            checked={current === 'standard'}
            onChange={() => void save(false)}
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-label-14 font-medium">Standard dialog</span>
            <span className="text-muted-foreground text-copy-13">
              The name, the required fields and the fields marked Ask when adding. Other fields are
              under More fields.
            </span>
          </span>
        </label>
        {forms.map((f) => (
          <label
            key={f.id}
            className="border-line has-[:checked]:border-ink flex items-start gap-3 rounded-md border p-3"
          >
            <input
              type="radio"
              name={`${id}-form`}
              className="mt-1"
              checked={current === f.id}
              disabled={f.closed}
              onChange={() => void save(f.id)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-label-14 font-medium">{f.name}</span>
              <span className="text-muted-foreground text-copy-13">
                {f.summary}
                {f.intake ? ' · Chosen by the pack' : ''}
                {f.closed ? ' · Closed: open it again to use it here' : ''}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p id={`${id}-help`} className="text-muted-foreground text-copy-13 m-0">
        {forms.length === 0
          ? 'This sheet has no forms yet. Make one on the Forms tab to ask its questions, a step at a time.'
          : 'A form asks its own questions, labels and required answers, a step at a time when it has steps. A form that is closed or deleted falls back to the standard dialog.'}
        {canChange ? '' : ' Only owners and admins can change this.'}
      </p>
      {canChange && packForm && value !== null ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void save(null)}
          >
            Use the pack’s choice ({packForm.name})
          </Button>
        </div>
      ) : null}
    </div>
  );
}
