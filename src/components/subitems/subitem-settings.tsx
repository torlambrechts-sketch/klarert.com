'use client';

import { useId, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Plus, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { enableSubitemsAction, updateSubitemSettingsAction } from '@/app/[org]/s/actions';
import type { Json, SubitemSettings } from '@/engine/types';
import { SheetFields } from '@/components/sheets/sheet-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// The Sub-items section of the sheet settings (docs/05 §4): turn them on, name them ("Actions", "Clauses", "Test
// steps"), the gates (closing the parent, locking with the parent), the template set "From template" adds, the
// sub-items' own fields (the field manager of the child sheet) and their automations.

export interface SubitemSettingsProps {
  org: string;
  sheetId: string;
  userId: string;
  timeZone: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer' | 'auditor';
  archived: boolean;
  /** null: sub-items are off. */
  childSheetId: string | null;
  settings: SubitemSettings | null;
  /** Key of the sub-items' due date field, for "Due in N days" in the template. */
  dueKey: string | null;
}

type Row = { key: number; name: string; due: string; values: Record<string, Json> };

const dueOf = (values: Record<string, Json>, key: string | null) => {
  const v = key ? values[key] : undefined;
  const m = typeof v === 'string' ? v.match(/^\$in:(-?\d{1,4})$/) : null;
  return m ? m[1]! : v === '$today' ? '0' : '';
};

export function SubitemSettingsSection(p: SubitemSettingsProps) {
  const canEdit = p.role !== 'viewer' && p.role !== 'auditor' && !p.archived;
  return p.childSheetId && p.settings ? (
    <Enabled {...p} childSheetId={p.childSheetId} settings={p.settings} canEdit={canEdit} />
  ) : (
    <TurnOn {...p} canEdit={canEdit} />
  );
}

function TurnOn({ org, sheetId, canEdit }: SubitemSettingsProps & { canEdit: boolean }) {
  const router = useRouter();
  const [label, setLabel] = useState('Sub-items');
  const [pending, start] = useTransition();
  const id = useId();
  if (!canEdit)
    return (
      <p className="text-muted-foreground text-copy-13 m-0">Sub-items are off for this sheet.</p>
    );
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Turn on sub-items"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await enableSubitemsAction({ org, sheetId, label });
          if (!r.ok) return void toast.error(r.error.message);
          toast('Sub-items turned on. Add them under any item.');
          router.refresh();
        });
      }}
    >
      <p className="text-muted-foreground text-copy-13 m-0">
        Break an item into steps with their own owner, status, due date and evidence. Each one gets
        an ID like CA-014.1 and its own activity log.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id}>Call them</Label>
          <Input
            id={id}
            value={label}
            maxLength={40}
            onChange={(e) => setLabel(e.target.value)}
            className="w-56"
          />
        </div>
        <Button type="submit" disabled={pending || !label.trim()}>
          Turn on sub-items
        </Button>
      </div>
    </form>
  );
}

function Enabled(
  p: SubitemSettingsProps & { childSheetId: string; settings: SubitemSettings; canEdit: boolean },
) {
  const router = useRouter();
  const [label, setLabel] = useState(p.settings.label);
  const [blockClose, setBlockClose] = useState(p.settings.blockClose);
  const [lockCascade, setLockCascade] = useState(p.settings.lockCascade);
  const [rows, setRows] = useState<Row[]>(() =>
    p.settings.template.map((t, i) => ({
      key: i,
      name: t.name,
      due: dueOf(t.values, p.dueKey),
      values: t.values,
    })),
  );
  const [next, setNext] = useState(rows.length);
  const [pending, start] = useTransition();
  const ids = { label: useId(), block: useId(), lock: useId() };

  const save = () =>
    start(async () => {
      const template = rows
        .filter((r) => r.name.trim())
        .map((r) => {
          const values = { ...r.values };
          if (p.dueKey) {
            if (r.due.trim() === '') delete values[p.dueKey];
            else values[p.dueKey] = `$in:${Math.trunc(Number(r.due))}`;
          }
          return { name: r.name.trim(), values };
        });
      const res = await updateSubitemSettingsAction({
        org: p.org,
        sheetId: p.sheetId,
        label,
        blockClose,
        lockCascade,
        template,
      });
      if (!res.ok) return void toast.error(res.error.message);
      toast('Sub-item settings saved.');
      router.refresh();
    });

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: -1 | 1) =>
    setRows((rs) => {
      const out = [...rs];
      const [r] = out.splice(i, 1);
      out.splice(i + by, 0, r!);
      return out;
    });

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-4"
        aria-label="Sub-item settings"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.label}>Call them</Label>
          <Input
            id={ids.label}
            value={label}
            maxLength={40}
            disabled={!p.canEdit}
            onChange={(e) => setLabel(e.target.value)}
            className="w-56"
          />
        </div>
        <fieldset className="flex flex-col gap-2" disabled={!p.canEdit}>
          <legend className="text-label-14 mb-1 font-semibold">Rules</legend>
          <label htmlFor={ids.block} className="text-label-13 flex items-start gap-2">
            <input
              id={ids.block}
              type="checkbox"
              className="mt-0.5"
              checked={blockClose}
              onChange={(e) => setBlockClose(e.target.checked)}
            />
            <span>
              An item cannot close while {label.toLowerCase() || 'sub-items'} are open
              <span className="text-muted-foreground block">
                Setting its status to a done value is refused, for people, imports and automations.
              </span>
            </span>
          </label>
          <label htmlFor={ids.lock} className="text-label-13 flex items-start gap-2">
            <input
              id={ids.lock}
              type="checkbox"
              className="mt-0.5"
              checked={lockCascade}
              onChange={(e) => setLockCascade(e.target.checked)}
            />
            <span>
              A locked item locks its {label.toLowerCase() || 'sub-items'}
              <span className="text-muted-foreground block">
                Only owners and admins can change them while the item is locked.
              </span>
            </span>
          </label>
        </fieldset>
        <fieldset className="flex flex-col gap-2" disabled={!p.canEdit}>
          <legend className="text-label-14 mb-1 font-semibold">Template</legend>
          <p className="text-muted-foreground text-copy-13 m-0">
            From template adds these to an item in one go.
            {p.dueKey ? ' Due dates count from the day they are added.' : ''}
          </p>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-copy-13 m-0">No template yet.</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Template">
              {rows.map((r, i) => (
                <li key={r.key} className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`Name of template row ${i + 1}`}
                    value={r.name}
                    maxLength={500}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    className="min-w-40 flex-1"
                  />
                  {p.dueKey ? (
                    <label className="text-label-13 flex items-center gap-1.5">
                      Due in
                      <Input
                        type="number"
                        aria-label={`Due in days, row ${i + 1}`}
                        value={r.due}
                        onChange={(e) => update(r.key, { due: e.target.value })}
                        className="w-20"
                      />
                      days
                    </label>
                  ) : null}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move row ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move row ${i + 1} down`}
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove row ${i + 1}`}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => {
              setRows((rs) => [...rs, { key: next, name: '', due: '', values: {} }]);
              setNext((n) => n + 1);
            }}
          >
            <Plus aria-hidden /> Add a row
          </Button>
        </fieldset>
        {p.canEdit ? (
          <Button type="submit" className="w-fit" disabled={pending || !label.trim()}>
            Save sub-item settings
          </Button>
        ) : null}
      </form>
      <section className="flex flex-col gap-2" aria-label={`Fields of the ${label.toLowerCase()}`}>
        <h3 className="text-label-14 m-0 font-semibold">Fields of the {label.toLowerCase()}</h3>
        <SheetFields
          org={p.org}
          sheetId={p.childSheetId}
          userId={p.userId}
          timeZone={p.timeZone}
          role={p.role}
          archived={p.archived}
        />
      </section>
      <Link
        href={`/${p.org}/automations?sheet=${p.childSheetId}`}
        className="text-label-13 text-info flex w-fit items-center gap-1.5 hover:underline"
      >
        <Zap className="size-4" aria-hidden /> Automations on the {label.toLowerCase()}
      </Link>
    </div>
  );
}
