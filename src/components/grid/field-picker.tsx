'use client';

import { useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { fieldType, typesByFamily } from '@/engine/fields/registry';
import { fieldUI } from '@/components/fields/registry';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';

// The add-field picker (docs/05 §3.5, FR-15): search, the 12 essentials, and every type grouped by family; then the
// field's name. The key is made from the name when the field is created and never changes afterwards (CLAUDE.md
// rule 5), so the name is asked for here: a Formula named "Priority score" gets the key {priority_score}.

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

export function FieldPicker({ onPick }: { onPick(type: string, name: string): void }) {
  const [type, setType] = useState<string | null>(null);
  if (type)
    return (
      <NameStep type={type} onBack={() => setType(null)} onAdd={(name) => onPick(type, name)} />
    );
  return <TypeStep onPick={setType} />;
}

function NameStep(p: { type: string; onBack(): void; onAdd(name: string): void }) {
  const label = fieldType(p.type)?.label ?? 'Field';
  const [name, setName] = useState(label);
  const id = useId();
  const Icon = fieldUI(p.type).icon;
  const trimmed = name.trim();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed) p.onAdd(trimmed);
      }}
    >
      <p className="text-copy-13 flex items-center gap-1.5 font-semibold">
        <Icon className="size-4" aria-hidden /> {label}
      </p>
      <label htmlFor={id} className="text-label-13 flex flex-col gap-1 font-semibold">
        Field name
        <input
          id={id}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          className={inputClass}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className="text-muted-foreground text-label-12">
        Formulas and templates use its key, made from this name. Renaming it later keeps the key.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={p.onBack}>
          Back
        </Button>
        <Button type="submit" size="sm" disabled={!trimmed}>
          Add field
        </Button>
      </div>
    </form>
  );
}

function TypeStep({ onPick }: { onPick(type: string): void }) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const q = query.trim().toLowerCase();
  const families = useMemo(
    () =>
      typesByFamily(
        (t) =>
          t.addable !== false &&
          (!q || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)),
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
          <p className="text-muted-foreground text-label-12 mb-1.5 font-semibold">Essentials</p>
          <ul className="grid grid-cols-3 gap-1.5">
            {ESSENTIALS.map((id) => {
              const Icon = fieldUI(id).icon;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onPick(id)}
                    className="border-line hover:bg-sel text-label-12 flex w-full flex-col items-center gap-1 rounded-md border px-1 py-2 font-semibold"
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
            className="hover:bg-soft text-label-13 flex w-full items-center gap-1 rounded-md px-1 py-1 text-left font-semibold"
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
              <p className="text-muted-foreground text-copy-13">No field type matches.</p>
            ) : null}
            {families.map((f) => (
              <section key={f.family} aria-label={f.label}>
                <p className="text-muted-foreground text-label-12 mb-1 font-bold tracking-wide uppercase">
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
                            <span className="text-label-13 font-semibold">{t.label}</span>
                            <span className="text-muted-foreground text-label-12">
                              {t.description}
                            </span>
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
