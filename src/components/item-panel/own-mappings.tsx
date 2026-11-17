'use client';

import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plus, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  mapOwnRequirementAction,
  ownMappingOptionsAction,
  retireOwnMappingAction,
} from '@/app/[org]/s/panel-actions';
import { inputClass } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { OWN_LIMITS } from '@/engine/frameworks/own';
import { RELATIONS, RELATION_LABEL, type Relation } from '@/engine/frameworks/types';
import { cn } from '@/lib/utils';
import type { OwnMapping } from '@/server/commands/frameworks';
import type { MappingOption } from '@/server/commands/own-frameworks';

// "Map to …" on a requirement of the workspace's own framework (docs/12 Your own frameworks): the person picks a
// catalogue requirement (adopted or not), the relation (related unless they choose otherwise) and a note. Each mapping
// is the workspace's, shown as "Your mapping · person · date" and never mixed with the catalogue's mapping. Nothing here
// suggests or makes a mapping by itself.

const MAX_SHOWN = 12;

function matches(o: MappingOption, words: string[]) {
  const hay = `${o.label} ${o.title} ${o.framework}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function MapForm({
  org,
  from,
  taken,
  onDone,
  onCancel,
}: {
  org: string;
  from: string;
  taken: Set<string>;
  onDone(): void;
  onCancel(): void;
}) {
  const ids = { search: useId(), list: useId(), relation: useId(), note: useId() };
  const options = useQuery({
    queryKey: ['own-mapping-options', org],
    queryFn: async () => {
      const r = await ownMappingOptionsAction({ org });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    staleTime: 5 * 60_000,
  });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<MappingOption | null>(null);
  const [relation, setRelation] = useState<Relation>('related');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const found = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!options.data || words.length === 0) return [];
    return options.data.filter((o) => !taken.has(o.key) && matches(o, words)).slice(0, MAX_SHOWN);
  }, [options.data, query, taken]);

  const pick = (o: MappingOption) => {
    setPicked(o);
    setQuery('');
    setActive(0);
  };

  async function save() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const r = await mapOwnRequirementAction({ org, from, to: picked.key, relation, note });
      if (!r.ok) {
        setError(r.error.fieldErrors ? Object.values(r.error.fieldErrors)[0]! : r.error.message);
        return;
      }
      toast.success(`Mapped to ${picked.label}.`);
      onDone();
    } catch {
      setError('The mapping could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="border-line flex flex-col gap-2.5 rounded-lg border p-3"
      role="group"
      aria-label="Map to a catalogue requirement"
    >
      {picked ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label-13">
            <span className="text-label-12-mono font-medium">{picked.label}</span> {picked.title}
          </span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={`Choose another requirement than ${picked.label}`}
            onClick={() => setPicked(null)}
          >
            Change
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.search} className="text-label-13 font-medium">
            Catalogue requirement
          </label>
          <input
            id={ids.search}
            role="combobox"
            aria-expanded={found.length > 0}
            aria-controls={ids.list}
            aria-autocomplete="list"
            aria-activedescendant={found[active] ? `${ids.list}-${active}` : undefined}
            className={cn(inputClass, 'h-9')}
            placeholder={
              options.isPending ? 'Loading the catalogue…' : 'Search: 27001 A.5.15, access control'
            }
            value={query}
            disabled={options.isPending || options.isError}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, Math.max(found.length - 1, 0)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter' && found[active]) {
                e.preventDefault();
                pick(found[active]!);
              } else if (e.key === 'Escape') setQuery('');
            }}
          />
          {options.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-2">
              <p className="text-copy-13 m-0">{options.error.message}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void options.refetch()}
              >
                <RotateCcw aria-hidden /> Retry
              </Button>
            </div>
          ) : null}
          <ul
            id={ids.list}
            role="listbox"
            aria-label="Catalogue requirements"
            className={cn(
              'border-line m-0 max-h-64 list-none overflow-y-auto rounded-md border p-1',
              found.length === 0 && 'hidden',
            )}
          >
            {found.map((o, i) => (
              <li
                key={o.key}
                id={`${ids.list}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  'text-label-13 flex cursor-pointer flex-col rounded px-2 py-1',
                  i === active ? 'bg-sel' : 'hover:bg-soft',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
              >
                <span>
                  <span className="text-label-12-mono font-medium">{o.label}</span> {o.title}
                </span>
                <span className="text-label-12 text-muted-foreground">{o.framework}</span>
              </li>
            ))}
          </ul>
          {query.trim() && options.data && found.length === 0 ? (
            <p className="text-copy-13 text-muted-foreground m-0">
              No catalogue requirement matches.
            </p>
          ) : null}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.relation} className="text-label-13 font-medium">
            Relation
          </label>
          <select
            id={ids.relation}
            className={cn(inputClass, 'h-9')}
            value={relation}
            onChange={(e) => setRelation(e.target.value as Relation)}
          >
            {RELATIONS.map((r) => (
              <option key={r} value={r}>
                {RELATION_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.note} className="text-label-13 font-medium">
            Note (optional)
          </label>
          <input
            id={ids.note}
            className={cn(inputClass, 'h-9')}
            value={note}
            maxLength={OWN_LIMITS.note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <p className="text-label-12 text-muted-foreground m-0">
        Equivalent: asks for the same thing. Partly: part of it. Related: worth looking at together.
        When in doubt, related.
      </p>
      {error ? (
        <p role="alert" className="text-copy-13 m-0 flex items-center gap-1.5">
          <X className="text-crit size-4 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={busy || !picked} onClick={() => void save()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {busy ? 'Mapping…' : 'Map'}
        </Button>
      </div>
    </div>
  );
}

export function OwnMappings({
  org,
  own,
  onChanged,
}: {
  org: string;
  own: { key: string; mappings: OwnMapping[]; canMap: boolean };
  onChanged(): void;
}) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const taken = useMemo(() => new Set(own.mappings.map((m) => m.to)), [own.mappings]);

  async function remove(m: OwnMapping) {
    setRemoving(m.id);
    try {
      const r = await retireOwnMappingAction({ org, id: m.id });
      if (!r.ok) toast.error(r.error.message);
      else {
        toast.success(`Removed the mapping to ${m.label}.`);
        onChanged();
      }
    } catch {
      toast.error('The mapping could not be removed. Try again.');
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="own-mappings">
      <h4 className="text-label-13 text-muted-foreground m-0 font-medium">
        Your mappings · {own.mappings.length}
      </h4>
      {own.mappings.length === 0 ? (
        <p className="text-muted-foreground text-copy-13 m-0">
          Not mapped to a catalogue requirement yet.
          {own.canMap ? ' Map it to see where one control covers both.' : ''}
        </p>
      ) : (
        <ul aria-label="Your mappings" className="m-0 flex list-none flex-col gap-1 p-0">
          {own.mappings.map((m) => (
            <li
              key={m.id}
              className="border-line text-label-13 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border px-3 py-1.5"
            >
              <span className="text-label-12-mono font-medium">{m.label}</span>
              <span className="min-w-0 flex-1 truncate">{m.title}</span>
              <span className="text-label-12">{RELATION_LABEL[m.relation]}</span>
              {own.canMap ? (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  disabled={removing !== null}
                  aria-label={`Remove the mapping to ${m.label}`}
                  onClick={() => void remove(m)}
                >
                  {removing === m.id ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <X aria-hidden />
                  )}
                </Button>
              ) : null}
              <span className="text-label-12 text-muted-foreground basis-full">
                Your mapping · {m.by ?? 'Former member'} · {m.atText}
                {m.note ? ` · ${m.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {own.canMap ? (
        open ? (
          <MapForm
            org={org}
            from={own.key}
            taken={taken}
            onCancel={() => setOpen(false)}
            onDone={() => {
              setOpen(false);
              onChanged();
            }}
          />
        ) : (
          <div>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Plus aria-hidden /> Map to …
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
