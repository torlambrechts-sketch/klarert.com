'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { fieldType, typesByFamily } from '@/engine/fields/registry';
import { fieldUI } from '@/components/fields/registry';
import { inputClass } from '@/components/fields/shared';

// The add-field picker (docs/05 §3.5, FR-15): search, the 12 essentials, and every type grouped by family.

const ESSENTIALS = [
  'text',
  'longtext',
  'number',
  'status',
  'dropdown',
  'people',
  'date',
  'timeline',
  'yesno',
  'link',
  'evidence',
  'formula',
] as const;

export function FieldPicker({ onPick }: { onPick(type: string): void }) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const q = query.trim().toLowerCase();
  const families = useMemo(
    () =>
      typesByFamily(
        (t) => !q || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
      ),
    [q],
  );
  return (
    <div className="flex flex-col gap-3">
      <input
        autoFocus
        className={inputClass}
        placeholder="Search field types"
        aria-label="Search field types"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {!q ? (
        <div>
          <p className="text-muted-foreground mb-1.5 text-xs font-semibold">Essentials</p>
          <ul className="grid grid-cols-3 gap-1.5">
            {ESSENTIALS.map((id) => {
              const Icon = fieldUI(id).icon;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onPick(id)}
                    className="border-line hover:bg-sel flex w-full flex-col items-center gap-1 rounded-md border px-1 py-2 text-xs font-semibold"
                  >
                    <Icon className="size-4" aria-hidden />
                    {fieldType(id)!.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div>
        {!q ? (
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll((a) => !a)}
            className="hover:bg-soft flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-sm font-semibold"
          >
            {all ? (
              <ChevronDown className="size-4" aria-hidden />
            ) : (
              <ChevronRight className="size-4" aria-hidden />
            )}
            All field types
          </button>
        ) : null}
        {all || q ? (
          <div className="flex max-h-72 flex-col gap-3 overflow-auto pt-1">
            {families.length === 0 ? (
              <p className="text-muted-foreground text-sm">No field type matches.</p>
            ) : null}
            {families.map((f) => (
              <section key={f.family} aria-label={f.label}>
                <p className="text-muted-foreground mb-1 text-[10.5px] font-bold tracking-wide uppercase">
                  {f.label}
                </p>
                <ul className="flex flex-col">
                  {f.types.map((t) => {
                    const Icon = fieldUI(t.id).icon;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => onPick(t.id)}
                          className="hover:bg-sel flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left"
                        >
                          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                          <span className="flex flex-col">
                            <span className="text-sm font-semibold">{t.label}</span>
                            <span className="text-muted-foreground text-xs">{t.description}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
