'use client';

import { AlertTriangle, Check, ExternalLink } from 'lucide-react';
import { inputClass } from '@/components/fields/shared';
import { chosen, choiceGroups } from '@/engine/packs/settings';
import type { PackSetting } from '@/engine/packs/types';
import { cn } from '@/lib/utils';

/**
 * A pack setting (docs/11 Pack settings): a picker over its choices (grouped, e.g. EU member states and EEA countries)
 * and what the chosen one says, with whether it was verified and where it comes from.
 */
export function SettingChoice({
  setting,
  value,
  disabled,
  onChange,
}: {
  setting: PackSetting;
  value: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
}) {
  const id = `pack-setting-${setting.key}`;
  const c = chosen(setting, value ? { [setting.key]: value } : {});
  return (
    <div className="flex flex-col gap-2" data-testid={`setting-${setting.key}`}>
      <label htmlFor={id} className="text-13 font-medium">
        {setting.label}
      </label>
      <select
        id={id}
        className={cn(inputClass, 'h-9 w-full sm:max-w-80')}
        value={value ?? ''}
        disabled={disabled}
        aria-describedby={`${id}-what`}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Not chosen yet</option>
        {choiceGroups(setting).map((g) =>
          g.group ? (
            <optgroup key={g.group} label={g.group}>
              {g.choices.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </optgroup>
          ) : (
            g.choices.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))
          ),
        )}
      </select>
      <p id={`${id}-what`} className="text-13 text-muted-foreground m-0">
        {setting.description}
      </p>
      {c ? (
        <div
          className="border-line flex flex-col gap-2 rounded-md border p-3"
          data-testid="setting-details"
        >
          {c.verified ? (
            <p className="text-13 m-0 flex items-center gap-1.5">
              <Check className="text-good size-4" aria-hidden /> Checked against the sources
              {c.checkedOn ? ` on ${c.checkedOn}` : ''}
            </p>
          ) : (
            <p
              className="text-13 bg-warn-soft m-0 flex items-start gap-1.5 rounded px-2 py-1"
              data-testid="setting-unverified"
            >
              <AlertTriangle className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
              Not verified yet: check these details with the authority before you rely on them.
            </p>
          )}
          <dl className="m-0 grid gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,10rem)_1fr]">
            {setting.values.map((v) =>
              c.values[v.key] ? (
                <div key={v.key} className="contents">
                  <dt className="text-13 text-muted-foreground">{v.label}</dt>
                  <dd className="text-13 m-0">{c.values[v.key]}</dd>
                </div>
              ) : null,
            )}
          </dl>
          {c.note ? <p className="text-13 text-muted-foreground m-0">{c.note}</p> : null}
          {c.sources.length ? (
            <ul className="text-13 m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Sources">
              {c.sources.map((x) => (
                <li key={x.url}>
                  <a
                    href={x.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline underline-offset-2"
                  >
                    {x.title} <ExternalLink className="size-3" aria-hidden />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
