'use client';

import { useId, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { sheetKey } from '@/components/grid/use-sheet';
import { Button } from '@/components/ui/button';
import { ROLE_LABEL } from '@/engine/access';
import type { Ctx, Field, Role } from '@/engine/types';
import { setFieldRestrictionAction } from '@/app/[org]/access-actions';

// Field settings › Restricted field (docs/02 §16): who sees this field's values besides the owners. Owners and admins
// with edit access change it; the database moves the values into the restricted store and logs the change. Everyone
// else sees that the field is restricted and who may see it.

const ROLES: Role[] = ['admin', 'editor', 'viewer', 'auditor'];

export function RestrictedFieldSection({
  field,
  ctx,
  canManage,
}: {
  field: Field;
  ctx: Ctx;
  canManage: boolean;
}) {
  const { org } = useParams<{ org: string }>();
  const qc = useQueryClient();
  const id = useId();
  const current = field.restrictedTo ?? null;
  const [on, setOn] = useState(!!current);
  const [users, setUsers] = useState<string[]>(current?.userIds ?? []);
  const [roles, setRoles] = useState<Role[]>(current?.roles ?? []);
  const [busy, setBusy] = useState(false);
  const people = [...ctx.people.values()].sort((a, b) => a.name.localeCompare(b.name, 'en-GB'));
  const names = (current?.userIds ?? []).map((u) => ctx.people.get(u)?.name ?? 'Former member');
  const roleNames = (current?.roles ?? []).map((r) => `${ROLE_LABEL[r].toLowerCase()}s`);
  const summary = [...names, ...roleNames];

  const save = async () => {
    setBusy(true);
    const r = await setFieldRestrictionAction({
      org,
      fieldId: field.id,
      restricted: on,
      userIds: users,
      roles,
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error.message);
    toast(on ? `${field.name} is restricted.` : `${field.name} is no longer restricted.`);
    await qc.invalidateQueries({ queryKey: sheetKey(field.sheetId) });
  };

  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  if (!canManage)
    return current ? (
      <p className="text-13 bg-subtle border-line m-0 flex items-start gap-2 rounded-lg border p-3">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Restricted field. Its values are seen by{' '}
          {summary.length ? `${summary.join(', ')} and ` : ''}the workspace owners.
          {field.hidden ? ' You cannot see them.' : null}
        </span>
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      <label className="text-13 flex items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Restricted field: only chosen people and roles, and the owners, see its values
      </label>
      {on ? (
        <>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-13 mb-1 font-semibold">Roles</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {ROLES.map((r) => (
                <label key={r} className="text-13 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={roles.includes(r)}
                    onChange={() => setRoles((l) => toggle(l, r))}
                  />
                  {ROLE_LABEL[r]}s
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-13 mb-1 font-semibold">People</legend>
            {people.length === 0 ? (
              <p className="text-muted-foreground text-13 m-0">No members yet.</p>
            ) : (
              <ul
                aria-labelledby={`${id}-people`}
                className="border-line flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2"
              >
                {people.map((p) => (
                  <li key={p.id}>
                    <label className="text-13 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={users.includes(p.id)}
                        onChange={() => setUsers((l) => toggle(l, p.id))}
                      />
                      {p.name}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </>
      ) : null}
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || (!on && !current)}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : on ? 'Save who can see it' : 'Lift the restriction'}
        </Button>
      </div>
    </div>
  );
}
