'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { insertTemplateKey, templateKeys, templateQuery } from '@/engine/automations';
import type { Ctx } from '@/engine/types';
import { inputClass } from '@/components/fields/shared';
import { cn } from '@/lib/utils';

// A message with `{` autocomplete of the template keys (docs/04 §6, §10): typing `{` lists {name}, {id}, {sheet},
// {group}, {link}, {actor} and the sheet's field keys; arrows move, Enter or Tab inserts, Esc closes the list.

export function TemplateInput({
  value,
  onChange,
  ctx,
  label,
  placeholder,
  multiline,
  invalid,
}: {
  value: string;
  onChange(v: string): void;
  ctx: Ctx;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  invalid?: boolean;
}) {
  const listId = useId();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const keys = useMemo(() => templateKeys(ctx), [ctx]);
  const q = caret === null || dismissed ? null : templateQuery(value, caret);
  const matches = q
    ? keys
        .filter(
          (k) => k.key.toLowerCase().startsWith(q.query) || k.label.toLowerCase().includes(q.query),
        )
        .slice(0, 8)
    : [];
  const open = matches.length > 0;

  const insert = (key: string) => {
    if (caret === null) return;
    const next = insertTemplateKey(value, caret, key);
    onChange(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const props = {
    ref,
    value,
    placeholder,
    role: 'combobox' as const,
    'aria-label': label,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': open,
    'aria-controls': open ? listId : undefined,
    'aria-activedescendant': open ? `${listId}-${active}` : undefined,
    'aria-invalid': invalid || undefined,
    className: cn(inputClass, multiline && 'h-auto min-h-16 py-1.5', invalid && 'border-crit'),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value);
      setCaret(e.target.selectionStart);
      setDismissed(false);
      setActive(0);
    },
    onSelect: (e: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setCaret(e.currentTarget.selectionStart),
    onBlur: () => setTimeout(() => setCaret(null), 150),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % matches.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + matches.length) % matches.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insert(matches[active]!.key);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
      }
    },
  };

  return (
    <div className="relative w-full min-w-48 flex-1">
      {multiline ? <textarea rows={2} {...props} /> : <input type="text" {...props} />}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Template keys"
          className="border-line bg-surface shadow-menu absolute top-full left-0 z-20 mt-1 max-h-60 w-64 overflow-auto rounded-lg border p-1"
        >
          {matches.map((k, i) => (
            <li
              key={k.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cn(
                'text-13 flex cursor-pointer items-baseline justify-between gap-2 rounded px-2 py-1',
                i === active && 'bg-soft',
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(k.key);
              }}
            >
              <span className="text-13 font-mono">{`{${k.key}}`}</span>
              <span className="text-muted-foreground text-12 truncate">{k.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
