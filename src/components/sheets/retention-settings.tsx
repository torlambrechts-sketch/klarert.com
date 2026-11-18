'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { saveRetentionRulesAction } from '@/app/[org]/settings/actions';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/fields/shared';
import {
  describeRule,
  RETENTION_ACTIONS,
  RETENTION_UNITS,
  type RetentionRule,
  type RetentionSettings,
} from '@/engine/retention';
import type { Field } from '@/engine/types';

// Sheet settings › Retention (docs/02 §18): the sheet's retention rules as data. Owners and admins edit them; due
// records go to Workspace admin › Retention, where a person approves each erasure.

export interface RetentionFieldOption {
  key: string;
  name: string;
  personal: boolean;
  date: boolean;
}

const ACTION_LABEL = {
  erase: 'Erase the personal data',
  anonymise: 'Anonymise the item',
  archive: 'Archive the item',
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30) || 'rule';

function blank(fields: RetentionFieldOption[]): RetentionRule {
  const date = fields.find((f) => f.date);
  return {
    id: '',
    name: '',
    from: date ? { kind: 'field', fieldKey: date.key } : { kind: 'created' },
    period: { n: 3, unit: 'years' },
    action: 'erase',
  };
}

export function RetentionSettingsSection({
  org,
  sheetId,
  initial,
  fields,
  groups,
  canEdit,
}: {
  org: string;
  sheetId: string;
  initial: RetentionSettings;
  fields: RetentionFieldOption[];
  groups: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState<RetentionSettings>(initial);
  const [draft, setDraft] = useState<{ index: number | null; rule: RetentionRule } | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  const asFields = fields.map(
    (f) =>
      ({
        key: f.key,
        name: f.name,
        config: f.personal ? { personalData: true } : {},
      }) as unknown as Field,
  );
  const personal = fields.filter((f) => f.personal);

  function save(next: RetentionSettings, done?: () => void) {
    start(async () => {
      const r = await saveRetentionRulesAction({ org, sheetId, retention: next });
      if (!r.ok) {
        toast.error(r.error.message);
        return;
      }
      setSettings(next);
      toast('Retention rules saved.');
      done?.();
      router.refresh();
    });
  }

  function commit() {
    if (!draft) return;
    const name = draft.rule.name.trim();
    if (!name) return toast.error('Name the rule.');
    const taken = new Set(settings.rules.filter((_, i) => i !== draft.index).map((r) => r.id));
    let ruleId = draft.rule.id || slug(name);
    for (let n = 2; taken.has(ruleId); n += 1) ruleId = `${slug(name).slice(0, 27)}_${n}`;
    const rule: RetentionRule = { ...draft.rule, id: ruleId, name };
    const rules =
      draft.index === null
        ? [...settings.rules, rule]
        : settings.rules.map((r, i) => (i === draft.index ? rule : r));
    save({ ...settings, rules }, () => setDraft(null));
  }

  const set = (patch: Partial<RetentionRule>) =>
    setDraft((d) => (d ? { ...d, rule: { ...d.rule, ...patch } } : d));
  const rule = draft?.rule;
  const toggle = (list: string[] | undefined, v: string, on: boolean) => {
    const s = new Set(list ?? []);
    if (on) s.add(v);
    else s.delete(v);
    return [...s];
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-13 text-muted-foreground m-0">
        Personal data:{' '}
        {personal.length ? personal.map((f) => f.name).join(', ') : 'no field is marked yet'}. Mark
        a field in its settings (Edit field › Personal data).
      </p>
      <label className="text-13 flex items-center gap-2">
        <input
          type="checkbox"
          disabled={!canEdit || pending}
          checked={settings.personalNames === true}
          onChange={(e) => {
            const rest = { ...settings };
            delete rest.personalNames;
            save(e.target.checked ? { ...rest, personalNames: true } : rest);
          }}
        />
        Item names may hold personal data (kept out of the activity log in clear; anonymise replaces
        them)
      </label>
      {settings.rules.length === 0 ? (
        <p className="text-13 text-muted-foreground m-0">No retention rule yet.</p>
      ) : (
        <ul className="divide-line flex flex-col divide-y" aria-label="Retention rules">
          {settings.rules.map((r, i) => (
            <li
              key={r.id}
              className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">{r.name}</span>
                <span className="text-13">{describeRule(r, asFields)}</span>
                {r.note ? <span className="text-12 text-muted-foreground">{r.note}</span> : null}
              </div>
              {canEdit ? (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Edit rule ${r.name}`}
                    onClick={() => setDraft({ index: i, rule: { ...r } })}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    aria-label={`Delete rule ${r.name}`}
                    onClick={() =>
                      save({ ...settings, rules: settings.rules.filter((_, j) => j !== i) })
                    }
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit && !draft ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => setDraft({ index: null, rule: blank(fields) })}
        >
          Add a rule
        </Button>
      ) : null}
      {!canEdit ? (
        <p className="text-muted-foreground text-13 m-0">
          Only owners and admins can change retention rules.
        </p>
      ) : null}
      {draft && rule ? (
        <form
          aria-label={draft.index === null ? 'New retention rule' : `Edit rule ${rule.name}`}
          className="border-line flex flex-col gap-3 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-13 font-semibold">Rule name</span>
            <input
              className={inputClass}
              value={rule.name}
              maxLength={80}
              required
              placeholder="Requests: 3 years after closing"
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-13 font-semibold">Keep for</span>
              <input
                type="number"
                min={1}
                max={1200}
                className={inputClass}
                value={rule.period.n}
                onChange={(e) =>
                  set({
                    period: {
                      ...rule.period,
                      n: Math.max(1, Math.min(1200, Number(e.target.value) || 1)),
                    },
                  })
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-13 font-semibold">Unit</span>
              <select
                className={inputClass}
                value={rule.period.unit}
                onChange={(e) =>
                  set({
                    period: {
                      ...rule.period,
                      unit: e.target.value as RetentionRule['period']['unit'],
                    },
                  })
                }
              >
                {RETENTION_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u.charAt(0).toUpperCase() + u.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-13 font-semibold">Counted from</span>
              <select
                className={inputClass}
                value={rule.from.kind === 'field' ? `field:${rule.from.fieldKey}` : rule.from.kind}
                onChange={(e) => {
                  const v = e.target.value;
                  set({
                    from: v.startsWith('field:')
                      ? { kind: 'field', fieldKey: v.slice(6) }
                      : { kind: v as 'created' | 'updated' },
                  });
                }}
              >
                {fields
                  .filter((f) => f.date)
                  .map((f) => (
                    <option key={f.key} value={`field:${f.key}`}>
                      {f.name}
                    </option>
                  ))}
                <option value="created">When the item was created</option>
                <option value="updated">The item&apos;s last change</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-13 font-semibold">Then</span>
            <select
              className={inputClass}
              value={rule.action}
              onChange={(e) => set({ action: e.target.value as RetentionRule['action'] })}
            >
              {RETENTION_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          {rule.action !== 'archive' ? (
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="text-13 mb-1 p-0 font-semibold">Fields to erase</legend>
              {personal.length === 0 ? (
                <p className="text-13 text-muted-foreground m-0">
                  No field is marked personal data: mark fields first, or nothing is erased.
                </p>
              ) : (
                personal.map((f) => (
                  <label key={f.key} className="text-13 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!rule.fieldKeys?.length || rule.fieldKeys.includes(f.key)}
                      onChange={(e) => {
                        const all = rule.fieldKeys?.length
                          ? rule.fieldKeys
                          : personal.map((p) => p.key);
                        const next = toggle(all, f.key, e.target.checked);
                        set({ fieldKeys: next.length === personal.length ? undefined : next });
                      }}
                    />
                    {f.name}
                  </label>
                ))
              )}
              {rule.action === 'erase' ? (
                <>
                  <label className="text-13 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!rule.files}
                      onChange={(e) => set({ files: e.target.checked || undefined })}
                    />
                    Also the item files marked personal data
                  </label>
                  <label className="text-13 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!rule.comments}
                      onChange={(e) => set({ comments: e.target.checked || undefined })}
                    />
                    Also the comments
                  </label>
                </>
              ) : (
                <p className="text-12 text-muted-foreground m-0">
                  Anonymising also removes the personal item files and the comments, and replaces
                  the name.
                </p>
              )}
              <label className="text-13 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!rule.archiveItem}
                  onChange={(e) => set({ archiveItem: e.target.checked || undefined })}
                />
                Archive the item afterwards
              </label>
            </fieldset>
          ) : null}
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="text-13 mb-1 p-0 font-semibold">Which items</legend>
            <label className="text-13 flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!rule.onlyDone}
                onChange={(e) => set({ onlyDone: e.target.checked || undefined })}
              />
              Only items that are done
            </label>
            {groups.map((g) => (
              <label key={g.id} className="text-13 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!rule.groupIds?.length || rule.groupIds.includes(g.id)}
                  onChange={(e) => {
                    const all = rule.groupIds?.length ? rule.groupIds : groups.map((x) => x.id);
                    const next = toggle(all, g.id, e.target.checked);
                    set({ groupIds: next.length === groups.length ? undefined : next });
                  }}
                />
                In {g.name}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1">
            <span className="text-13 font-semibold">Why this period</span>
            <textarea
              id={`${id}-note`}
              className={`${inputClass} min-h-16 py-2`}
              maxLength={500}
              value={rule.note ?? ''}
              onChange={(e) => set({ note: e.target.value || undefined })}
            />
          </label>
          <p className="text-13 m-0">{describeRule(rule, asFields)}</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : 'Save rule'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
