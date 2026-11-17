'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleDashed, Link2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { requirementContextAction } from '@/app/[org]/s/panel-actions';
import { RELATION_LABEL } from '@/engine/frameworks/types';
import type { Ctx, Field, Item, Sheet } from '@/engine/types';
import { resolveFieldType } from '@/engine/fields/resolve';
import { Button } from '@/components/ui/button';
import { OwnMappings } from './own-mappings';
import type {
  RelatedChip,
  RequirementChip,
  RequirementContext,
} from '@/server/commands/frameworks';

// Requirements on an item (docs/12, docs/05 §3.4): on a library item of an adopted framework, the controls covering it
// and "Also satisfies" (requirements of the other adopted frameworks it maps to); on any other item linked to
// requirements, "Covers" and "Suggest equivalents" with a one-click Link. The server works it out (the engine);
// this only shows it.

/** Whether the section can have anything to show for this sheet. */
export function showsRequirements(sheet: Sheet, fields: Field[]): boolean {
  return (
    !!sheet.framework || fields.some((f) => f.type === 'requirement' || f.type === 'controllink')
  );
}

function Chip({
  chip,
  relation,
  onOpen,
}: {
  chip: RequirementChip;
  relation?: RelatedChip['relation'];
  onOpen(c: RequirementChip): void;
}) {
  return (
    <li className="flex min-w-0">
      <button
        type="button"
        onClick={() => onOpen(chip)}
        title={`${chip.displayId} ${chip.name}`}
        className="border-line bg-soft text-label-12 hover:bg-sel inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-left"
      >
        <span className="text-label-12-mono shrink-0 font-medium">{chip.label}</span>
        <span className="truncate">{chip.name}</span>
        {relation ? (
          <span className="text-muted-foreground shrink-0">· {RELATION_LABEL[relation]}</span>
        ) : null}
      </button>
    </li>
  );
}

export function RequirementLinks({
  org,
  item,
  ctx,
  fields,
  onOpen,
  onLink,
}: {
  org: string;
  item: Item;
  ctx: Ctx;
  fields: Field[];
  /** Open a requirement or control in the panel (it may be on another sheet). */
  onOpen(target: { itemId: string; sheetId: string; displayId: string }): void;
  /** Replace the links of one of this item's link fields. */
  onLink(fieldId: string, to: string[]): Promise<void> | void;
}) {
  // refetch when this item's links change (a link made here or in a cell)
  const linkSig = fields
    .filter((f) => resolveFieldType(f.type)?.storage === 'links')
    .map((f) => ctx.links(item.id, f.id).join(','))
    .join('|');
  const q = useQuery({
    queryKey: ['requirement-context', org, item.id, linkSig],
    queryFn: async (): Promise<RequirementContext> => {
      const r = await requirementContextAction({ org, sheetId: item.sheetId, itemId: item.id });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    staleTime: 30_000,
  });
  const [linking, setLinking] = useState<string | null>(null);
  const headingId = `requirements-${item.id}`;
  const open = (c: { itemId: string; sheetId: string; displayId: string }) => onOpen(c);

  const link = async (s: RelatedChip, fieldId: string) => {
    setLinking(s.itemId);
    try {
      await onLink(fieldId, [...new Set([...ctx.links(item.id, fieldId), s.itemId])]);
      toast.success(`Linked ${item.displayId} to ${s.label}.`);
    } catch {
      toast.error('The link could not be saved. Try again.');
    } finally {
      setLinking(null);
    }
  };

  if (q.isPending)
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-2">
        <h3 id={headingId} className="text-heading-14 m-0">
          Requirements
        </h3>
        <div
          aria-busy="true"
          aria-label="Loading requirements"
          className="bg-soft h-9 animate-pulse rounded"
        />
      </section>
    );
  if (q.isError)
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-2">
        <h3 id={headingId} className="text-heading-14 m-0">
          Requirements
        </h3>
        <div role="alert" className="flex flex-wrap items-center gap-2">
          <p className="text-copy-13 m-0">{q.error.message}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void q.refetch()}>
            <RotateCcw aria-hidden /> Retry
          </Button>
        </div>
      </section>
    );

  const d = q.data;
  const r = d.requirement;
  if (!r && d.covers.length === 0 && !d.linkFieldId) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-heading-14 m-0">
        {r ? `Requirement · ${r.label}` : 'Requirements'}
      </h3>
      {r ? (
        <>
          <p className="text-copy-13 m-0 flex items-center gap-1.5">
            {r.covered ? (
              <CircleCheck className="text-good size-4 shrink-0" aria-hidden />
            ) : (
              <CircleDashed className="text-muted-foreground size-4 shrink-0" aria-hidden />
            )}
            {r.covered
              ? 'Covered: an implemented control or current evidence.'
              : 'Not covered yet: link an implemented control or add evidence.'}
          </p>
          <div className="flex flex-col gap-1.5">
            <h4 className="text-label-13 text-muted-foreground m-0 font-medium">
              Controls · {r.controls.length}
            </h4>
            {r.controls.length === 0 ? (
              <p className="text-muted-foreground text-copy-13 m-0">
                No controls linked. Link this requirement from a control.
              </p>
            ) : (
              <ul aria-label="Controls" className="m-0 flex list-none flex-col gap-1 p-0">
                {r.controls.map((c) => (
                  <li key={c.itemId} className="text-label-13 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="truncate text-left font-medium hover:underline"
                      onClick={() => open(c)}
                    >
                      {c.name}
                    </button>
                    <span className="text-muted-foreground text-label-12-mono">
                      {c.displayId} · {c.sheetName}
                    </span>
                    <span className="text-label-12">
                      {c.done === null ? '' : c.done ? 'Implemented' : 'Not implemented yet'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <h4 className="text-label-13 text-muted-foreground m-0 font-medium">
              Also satisfies · {r.alsoSatisfies.length}
            </h4>
            {r.alsoSatisfies.length === 0 ? (
              <p className="text-muted-foreground text-copy-13 m-0">
                No requirement of another adopted framework maps to this one.
              </p>
            ) : null}
            {/* The catalogue's mapping and the workspace's own are never mixed (docs/12 Your own frameworks) */}
            {r.alsoSatisfies.some((a) => !a.own) ? (
              <ul aria-label="Also satisfies" className="m-0 flex list-none flex-wrap gap-1 p-0">
                {r.alsoSatisfies
                  .filter((a) => !a.own)
                  .map((a) => (
                    <Chip key={a.itemId} chip={a} relation={a.relation} onOpen={open} />
                  ))}
              </ul>
            ) : null}
            {r.alsoSatisfies.some((a) => a.own) ? (
              <ul
                aria-label="Also satisfies, your mappings"
                className="m-0 flex list-none flex-col gap-1 p-0"
              >
                {r.alsoSatisfies
                  .filter((a) => a.own)
                  .map((a) => (
                    <li key={a.itemId} className="flex min-w-0 flex-col items-start gap-0.5">
                      <ul className="m-0 flex list-none p-0">
                        <Chip chip={a} relation={a.relation} onOpen={open} />
                      </ul>
                      <span className="text-label-12 text-muted-foreground pl-2">
                        Your mapping · {a.own!.by ?? 'Former member'} · {a.own!.atText}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
          {r.own ? <OwnMappings org={org} own={r.own} onChanged={() => void q.refetch()} /> : null}
          {r.licence ? (
            <p className="text-label-12 text-muted-foreground m-0">
              {r.framework}. {r.licence}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <h4 className="text-label-13 text-muted-foreground m-0 font-medium">
              Covers · {d.covers.length}
            </h4>
            {d.covers.length === 0 ? (
              <p className="text-muted-foreground text-copy-13 m-0">
                Not linked to any requirement yet.
              </p>
            ) : (
              <ul aria-label="Covers" className="m-0 flex list-none flex-wrap gap-1 p-0">
                {d.covers.map((c) => (
                  <Chip key={c.itemId} chip={c} onOpen={open} />
                ))}
              </ul>
            )}
          </div>
          {d.suggestions.length ? (
            <div className="flex flex-col gap-1.5">
              <h4 className="text-label-13 text-muted-foreground m-0 font-medium">
                Suggested equivalents · {d.suggestions.length}
              </h4>
              <ul
                aria-label="Suggested equivalents"
                className="m-0 flex list-none flex-col gap-1 p-0"
              >
                {d.suggestions.map((s) => (
                  <li
                    key={s.itemId}
                    className="border-line text-label-13 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5"
                  >
                    <span className="text-label-12-mono font-medium">{s.label}</span>
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    <span className="text-muted-foreground text-label-12">
                      {RELATION_LABEL[s.relation]} to {s.via.join(', ')}
                    </span>
                    {d.canLink && d.linkFieldId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={linking !== null}
                        aria-label={`Link ${s.label}`}
                        onClick={() => void link(s, d.linkFieldId!)}
                      >
                        <Link2 aria-hidden /> {linking === s.itemId ? 'Linking…' : 'Link'}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      {d.sources.length ? (
        <p className="text-label-12 text-muted-foreground m-0">
          Cross-walks: {d.sources.join(', ')}. Check them before you rely on them.
        </p>
      ) : null}
    </section>
  );
}
