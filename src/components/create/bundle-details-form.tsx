'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { selectionCounts } from '@/engine/packs/select';
import { cn } from '@/lib/utils';
import type { BundleDetails, CreateOptions, CreatePack } from '@/server/commands/bundles';

// Step 3 of a ready-made set (docs/05 §4 Create): its name, the owner who reviews it (required), the review date
// (required), the folder and, under More options, the level (Starter by default).

export interface DetailsState {
  name: string;
  ownerId: string;
  /** yyyy-mm-dd */
  reviewBy: string;
  /** 'pack' (its own folders), 'none' or 'folder:<name>' */
  folder: string;
}

/** Three months from today, as yyyy-mm-dd in the browser's calendar. */
export function defaultReviewDate(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const input =
  'border-line hover:border-line-strong focus-visible:border-focus text-label-14 h-10 w-full rounded-md border bg-background-100 px-3 outline-none focus-visible:shadow-[0_0_0_3px_rgb(161_161_170/0.25)]';

export function BundleDetailsForm({
  details,
  pack,
  opts,
  value,
  onChange,
  level,
  onLevel,
  excluded,
  error,
}: {
  details: BundleDetails;
  pack: CreatePack;
  opts: CreateOptions;
  value: DetailsState;
  onChange: (v: DetailsState) => void;
  level: string | null;
  onLevel: (l: string) => void;
  excluded: string[];
  error: string | null;
}) {
  const id = useId();
  const [more, setMore] = useState(level !== null && level !== details.levels[0]?.key);
  const set = (patch: Partial<DetailsState>) => onChange({ ...value, ...patch });
  const c = selectionCounts(details.parts, excluded);
  const own = details.packFolders.length ? details.packFolders.join(', ') : null;
  return (
    <div className="flex max-w-[640px] flex-col gap-5">
      <div>
        <h2 data-step-heading tabIndex={-1} className="text-heading-20 outline-none">
          Name it and choose who owns it
        </h2>
        <p className="text-copy-14 text-muted-foreground mt-1">
          {pack.title}: {c.sheets} {c.sheets === 1 ? 'sheet' : 'sheets'}, {c.fields} fields
          {c.automations ? `, ${c.automations} automations` : ''}. Its sheets show &ldquo;Generated
          from template, not yet reviewed&rdquo; until the owner marks it reviewed.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-label-14 font-medium">
          Name
        </label>
        <input
          id={`${id}-name`}
          className={input}
          value={value.name}
          maxLength={120}
          onChange={(e) => set({ name: e.target.value })}
          aria-invalid={!value.name.trim()}
          data-testid="create-name"
        />
        {!value.name.trim() ? <p className="text-copy-13 text-crit">Give it a name.</p> : null}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-owner`} className="text-label-14 font-medium">
            Owner
          </label>
          <select
            id={`${id}-owner`}
            className={input}
            value={value.ownerId}
            onChange={(e) => set({ ownerId: e.target.value })}
            required
            data-testid="create-owner"
          >
            <option value="" disabled>
              Choose an owner
            </option>
            {opts.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.id === opts.me ? ' (you)' : ''}
              </option>
            ))}
          </select>
          <p className="text-copy-13 text-muted-foreground">Reviews it and marks it reviewed.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-review`} className="text-label-14 font-medium">
            Review by
          </label>
          <input
            id={`${id}-review`}
            type="date"
            className={input}
            value={value.reviewBy}
            onChange={(e) => set({ reviewBy: e.target.value })}
            required
            aria-invalid={!value.reviewBy}
            data-testid="create-review"
          />
          {!value.reviewBy ? (
            <p className="text-copy-13 text-crit">Choose a review date.</p>
          ) : (
            <p className="text-copy-13 text-muted-foreground">
              When the owner checks it fits how you work.
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-folder`} className="text-label-14 font-medium">
          Folder
        </label>
        {details.canChooseFolder ? (
          <select
            id={`${id}-folder`}
            className={input}
            value={value.folder}
            onChange={(e) => set({ folder: e.target.value })}
          >
            {own ? (
              <option value="pack">Its own: {own}</option>
            ) : (
              <option value="pack">No folder</option>
            )}
            {opts.folders
              .filter((f) => !details.packFolders.includes(f))
              .map((f) => (
                <option key={f} value={`folder:${f}`}>
                  {f}
                </option>
              ))}
            {own ? <option value="none">No folder</option> : null}
          </select>
        ) : (
          <p id={`${id}-folder`} className="text-copy-14 text-muted-foreground">
            {own}. This set keeps its own restricted folder.
          </p>
        )}
      </div>
      {details.levels.length ? (
        <div className="border-line rounded-lg border">
          <button
            type="button"
            aria-expanded={more}
            aria-controls={`${id}-more`}
            onClick={() => setMore((m) => !m)}
            className="text-label-14 flex w-full items-center gap-2 px-3 py-2.5 font-medium"
          >
            <ChevronDown
              className={cn('size-4 transition-transform', more ? '' : '-rotate-90')}
              aria-hidden
            />
            More options
            <span className="text-muted-foreground ml-auto font-normal">
              {details.levels.find((l) => l.key === (level ?? details.levels[0]?.key))?.name}
            </span>
          </button>
          {more ? (
            <fieldset id={`${id}-more`} className="flex flex-col gap-2 border-t px-3 py-3">
              <legend className="sr-only">Level</legend>
              {details.levels.map((l) => (
                <label key={l.key} className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="radio"
                    name={`${id}-level`}
                    checked={(level ?? details.levels[0]?.key) === l.key}
                    onChange={() => onLevel(l.key)}
                    className="mt-[3px] accent-[var(--ink)]"
                  />
                  <span>
                    <span className="text-label-14 block font-medium">{l.name}</span>
                    <span className="text-copy-13 text-muted-foreground">
                      {l.description} {l.sheets.length} sheets.
                    </span>
                  </span>
                </label>
              ))}
              <p className="text-copy-13 text-muted-foreground">
                Changing the level resets the parts you left out. Go back to check them.
              </p>
            </fieldset>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="border-crit/40 bg-crit-soft text-copy-14 rounded-lg border p-3"
          data-testid="create-error"
        >
          {error} Nothing was created.
        </p>
      ) : null}
    </div>
  );
}
