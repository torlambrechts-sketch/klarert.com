'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { setColumnGroupsAction } from '@/app/[org]/s/actions';
import { arrangeFields, groupByKey, type ColumnGroup } from '@/engine/views/column-groups';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// The column group editor (docs/05 §3.1): owners and admins create, rename and delete a sheet's column groups and
// assign columns to them. Used in the Table's Columns menu and in Sheet settings. Each change saves at once through
// setColumnGroups, which also moves the assigned columns next to the rest of their group.

export interface GroupEditorField {
  id: string;
  key: string;
  name: string;
  position: string;
}

const newGroupId = () => `cg-${Math.random().toString(36).slice(2, 10)}`;

export function ColumnGroupsEditor({
  org,
  sheetId,
  fields,
  groups,
  onSaved,
}: {
  org: string;
  sheetId: string;
  fields: GroupEditorField[];
  groups: ColumnGroup[];
  /** After a save: the groups as stored (reload the sheet: field positions may have moved). */
  onSaved(groups: ColumnGroup[]): void;
}) {
  const id = useId();
  // the editor holds the groups while it is open: each save answers with the groups as stored. Following the prop
  // as well let a reload started by an earlier save land after a later one and put back the older groups, so the
  // next change saved without the column just added.
  const [list, setList] = useState(groups);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ordered = arrangeFields(fields, list);
  const of = groupByKey(list);
  const byKey = new Map(fields.map((f) => [f.key, f]));

  const save = async (next: ColumnGroup[]) => {
    setBusy(true);
    setError(null);
    const before = list;
    setList(next);
    const r = await setColumnGroupsAction({ org, sheetId, groups: next });
    setBusy(false);
    if (!r.ok) {
      setList(before);
      setError(r.error.message);
      return toast.error(r.error.message);
    }
    setList(r.data.groups);
    toast(r.data.summary ?? 'Column groups saved.');
    onSaved(r.data.groups);
  };

  const assign = (groupId: string, key: string) =>
    save(
      list.map((g) =>
        g.id === groupId
          ? { ...g, fieldKeys: [...g.fieldKeys.filter((k) => k !== key), key] }
          : { ...g, fieldKeys: g.fieldKeys.filter((k) => k !== key) },
      ),
    );

  return (
    <div className="flex flex-col gap-3">
      {list.length === 0 ? (
        <p className="text-muted-foreground text-13">
          No column groups yet. Group columns into sections such as Identify, Assess and Treat; each
          view can then collapse a section into one narrow column.
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.map((g) => {
          const members = ordered.filter((f) => of.get(f.key)?.id === g.id);
          const others = ordered.filter((f) => of.get(f.key)?.id !== g.id);
          return (
            <li key={g.id} className="border-line flex flex-col gap-2 rounded-md border p-2.5">
              <div className="flex items-center gap-1.5">
                <GroupName
                  value={g.name}
                  disabled={busy}
                  onRename={(n) =>
                    void save(list.map((x) => (x.id === g.id ? { ...x, name: n } : x)))
                  }
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Delete group ${g.name}`}
                  disabled={busy}
                  onClick={() => void save(list.filter((x) => x.id !== g.id))}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              {members.length ? (
                <ul
                  aria-label={`Columns in ${g.name}`}
                  className="m-0 flex list-none flex-wrap gap-1 p-0"
                >
                  {members.map((f) => (
                    <li
                      key={f.key}
                      className="bg-soft text-12 flex h-6 items-center gap-1 rounded-full pr-0.5 pl-2.5"
                    >
                      {f.name}
                      <button
                        type="button"
                        aria-label={`Remove ${f.name} from ${g.name}`}
                        disabled={busy}
                        className="hover:bg-surface focus-visible:outline-focus grid size-5 place-items-center rounded-full text-[var(--muted)] focus-visible:outline-2"
                        onClick={() =>
                          void save(
                            list.map((x) =>
                              x.id === g.id
                                ? { ...x, fieldKeys: x.fieldKeys.filter((k) => k !== f.key) }
                                : x,
                            ),
                          )
                        }
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-12">No columns yet.</p>
              )}
              {others.length ? (
                <select
                  aria-label={`Add a column to ${g.name}`}
                  className={cn(inputClass, 'text-13 h-8')}
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.value) void assign(g.id, e.target.value);
                  }}
                >
                  <option value="">Add a column…</option>
                  {others.map((f) => {
                    const in_ = of.get(f.key);
                    return (
                      <option key={f.key} value={f.key}>
                        {f.name}
                        {in_ ? ` (in ${in_.name})` : ''}
                      </option>
                    );
                  })}
                </select>
              ) : null}
            </li>
          );
        })}
      </ul>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (!n) return setError('A group needs a name.');
          if (list.some((g) => g.name.toLowerCase() === n.toLowerCase()))
            return setError(`There is already a group called ${n}.`);
          setName('');
          void save([...list, { id: newGroupId(), name: n, fieldKeys: [] }]);
        }}
      >
        <label htmlFor={`${id}-new`} className="text-13 flex flex-1 flex-col gap-1 font-medium">
          New group
          <input
            id={`${id}-new`}
            className={cn(inputClass, 'h-8 font-normal')}
            placeholder="For example Assess"
            maxLength={60}
            value={name}
            aria-invalid={!!error}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
        </label>
        <Button type="submit" variant="outline" size="sm" className="h-8" disabled={busy}>
          <Plus aria-hidden /> Add group
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-crit text-13">
          {error}
        </p>
      ) : null}
      {byKey.size === 0 ? (
        <p className="text-muted-foreground text-13">Add fields to the sheet first.</p>
      ) : null}
    </div>
  );
}

function GroupName({
  value,
  disabled,
  onRename,
}: {
  value: string;
  disabled: boolean;
  onRename(name: string): void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const n = draft.trim();
    if (!n) return setDraft(value);
    if (n !== value) onRename(n);
  };
  return (
    <input
      aria-label={`Group name ${value}`}
      className={cn(inputClass, 'text-13 h-8 min-w-0 flex-1 font-medium')}
      value={draft}
      maxLength={60}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

/** Sheet settings' "Column groups" card body: the editor, reloading the page after each save. */
export function SheetColumnGroups(props: {
  org: string;
  sheetId: string;
  fields: GroupEditorField[];
  groups: ColumnGroup[];
}) {
  const router = useRouter();
  return <ColumnGroupsEditor {...props} onSaved={() => router.refresh()} />;
}
