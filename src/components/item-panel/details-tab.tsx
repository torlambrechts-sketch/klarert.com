'use client';

import { hiddenFor } from '@/engine/values';
import { RestrictedValue } from '@/components/fields/registry';
import { useMemo } from 'react';
import { formatDate } from '@/engine/fields/helpers';
import {
  isChecklistField,
  linkEdges,
  itemSummary,
  statusFieldOf,
  type LinkEdge,
} from '@/engine/item-panel';
import { resolveFieldType } from '@/engine/fields/resolve';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Field, FileRow, Item } from '@/engine/types';
import { isVisible } from '@/engine/validation';
import { fieldUI } from '@/components/fields/registry';
import { Avatar, cellValue, colorVar } from '@/components/fields/shared';
import { cn } from '@/lib/utils';
import { ItemAutomations } from '@/components/automations/item-automations';
import type { EditorProps } from '@/components/fields/types';
import { FieldRow } from './field-row';
import { RequirementLinks, showsRequirements } from './requirements';
import { FilesField } from './files-field';
import { ChecklistSection } from './checklist';
import type { FileVersion } from './queries';

// Details (docs/05 §3.4, FR-28): the summary strip, linked items in both directions, the automations with per-item pause and every
// visible field, editable in place with the same editors as the Grid.

function SummaryCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-line bg-background-100 flex min-w-0 flex-col gap-1.5 rounded-lg border px-3.5 py-3">
      <span className="text-muted-foreground text-label-13 font-medium">{label}</span>
      <div className="text-label-14 min-w-0 font-medium">{children}</div>
    </div>
  );
}

function Summary({ item, ctx }: { item: Item; ctx: Ctx }) {
  const s = itemSummary(item, ctx);
  const group = ctx.groups.get(item.groupId);
  const person = s.person?.userId ? ctx.people.get(s.person.userId) : undefined;
  return (
    <section
      aria-label="Summary"
      className="grid grid-cols-2 gap-2 group-data-[wide=true]/panel:min-[760px]:grid-cols-4"
    >
      <SummaryCard label={s.status?.name ?? 'Status'}>
        {s.status ? (
          (() => {
            const ui = fieldUI(s.status.type);
            const v = cellValue(item, s.status, ctx);
            return hiddenFor(s.status, ctx) ? (
              <RestrictedValue />
            ) : resolveFieldType(s.status.type)?.isEmpty(v) ? (
              <span className="text-muted-foreground font-semibold">Not set</span>
            ) : (
              <ui.Cell value={v as never} field={s.status} item={item} ctx={ctx} density="list" />
            );
          })()
        ) : (
          <span className="text-muted-foreground font-semibold">No status field</span>
        )}
      </SummaryCard>
      <SummaryCard label={s.person?.field.name ?? 'Person'}>
        {s.person && hiddenFor(s.person.field, ctx) ? (
          <RestrictedValue />
        ) : person ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Avatar id={person.id} ctx={ctx} size={20} />
            <span className="truncate">{person.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground font-semibold">No one</span>
        )}
      </SummaryCard>
      <SummaryCard label={s.due?.field.name ?? 'Due date'}>
        {s.due ? (
          <span className="flex flex-col">
            <span>{formatDate(s.due.date)}</span>
            {s.due.relative ? (
              <em
                className={cn(
                  'text-label-12 font-semibold not-italic',
                  s.due.overdue ? 'text-crit font-extrabold' : 'text-muted-foreground',
                )}
              >
                {s.due.relative}
              </em>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground font-semibold">No date</span>
        )}
      </SummaryCard>
      <SummaryCard label="Group">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: colorVar(group?.color ?? 'grey') }}
          />
          <span className="truncate">{group?.name ?? '—'}</span>
        </span>
      </SummaryCard>
    </section>
  );
}

function LinkedItems({
  item,
  ctx,
  edges,
  fieldById,
  loading,
  onOpen,
}: {
  item: Item;
  ctx: Ctx;
  edges: LinkEdge[];
  fieldById(id: string): Field | undefined;
  loading: boolean;
  onOpen(target: Item): void;
}) {
  const rows = edges.flatMap((e) => {
    const other = ctx.item(e.otherId);
    if (!other || other.archivedAt) return [];
    return [{ edge: e, other }];
  });
  return (
    <section aria-labelledby={`linked-${item.id}`} className="flex flex-col gap-2">
      <h3 id={`linked-${item.id}`} className="text-heading-14 m-0">
        Linked items · {rows.length}
      </h3>
      {loading && rows.length === 0 ? (
        <div
          aria-busy="true"
          aria-label="Loading linked items"
          className="bg-soft h-9 animate-pulse rounded"
        />
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-copy-13 m-0">
          No linked items. Add a link field to connect this item to items on other sheets.
        </p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Linked items">
          {rows.map(({ edge, other }) => {
            const sheet = ctx.sheetOf(other.id);
            const field = fieldById(edge.fieldId);
            const chip =
              edge.direction === 'out'
                ? (field?.name ?? 'Link')
                : (sheet?.name ?? field?.name ?? 'Linked');
            const status = statusFieldOf(other.sheetId, ctx);
            const sv = status ? cellValue(other, status, ctx) : null;
            const ui = status ? fieldUI(status.type) : null;
            return (
              <li
                key={`${edge.direction}:${edge.fieldId}:${other.id}`}
                className="border-line text-label-13 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
              >
                <span
                  className="bg-soft border-line text-label-12-mono shrink-0 rounded-md border px-2 py-0.5"
                  title={edge.direction === 'out' ? 'Links from this item' : 'Links to this item'}
                >
                  {edge.direction === 'in' ? '← ' : ''}
                  {chip}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <button
                    type="button"
                    className="truncate text-left font-medium hover:underline"
                    onClick={() => onOpen(other)}
                  >
                    {other.name}
                  </button>
                  <span className="text-muted-foreground text-label-12-mono">
                    {other.displayId} · {sheet?.name ?? ''}
                  </span>
                </span>
                {status && ui && !resolveFieldType(status.type)?.isEmpty(sv) ? (
                  <ui.Cell
                    value={sv as never}
                    field={status}
                    item={other}
                    ctx={ctx}
                    density="list"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function DetailsTab({
  org,
  data,
  item,
  ctx,
  canEditItem,
  canPause,
  readOnlyReason,
  incoming,
  incomingLoading,
  versions,
  onCommit,
  onButton,
  fieldProps,
  onOpenLinked,
  onFileSaved,
}: {
  org: string;
  data: SheetData;
  item: Item;
  ctx: Ctx;
  canEditItem: boolean;
  /** Editors pause automations for this item, also on locked items. */
  canPause: boolean;
  readOnlyReason: string;
  incoming: { fieldId: string; fromItem: string }[];
  incomingLoading: boolean;
  versions: FileVersion[];
  onCommit(item: Item, fieldId: string, raw: unknown): Promise<void> | void;
  onButton(field: Field): void;
  /** "Add …" and "Edit options" for a field's editor; `close` closes it first. */
  fieldProps?(field: Field, close: () => void): Pick<EditorProps, 'onAddOption' | 'onEditField'>;
  onOpenLinked(target: Item): void;
  onFileSaved(file: FileRow, replaces: string | null): void;
}) {
  const fieldById = useMemo(() => {
    const m = new Map<string, Field>();
    for (const f of [...data.related.fields, ...data.fields]) m.set(f.id, f);
    return (id: string) => m.get(id);
  }, [data.fields, data.related.fields]);
  // link fields shown as their own checklist section are left out of Linked items (with their mirror rows)
  const checklists = useMemo(() => data.fields.filter(isChecklistField), [data.fields]);
  const edges = useMemo(() => {
    const skip = new Set(
      checklists.flatMap((f) => [
        f.id,
        ...((f.config as { inverseFieldId?: string | null }).inverseFieldId
          ? [(f.config as { inverseFieldId: string }).inverseFieldId]
          : []),
      ]),
    );
    return linkEdges({
      itemId: item.id,
      outgoing: data.fields
        .filter((f) => resolveFieldType(f.type)?.storage === 'links')
        .map((f) => ({ field: f, targetIds: ctx.links(item.id, f.id) })),
      incoming,
      fieldById,
    }).filter((e) => !skip.has(e.fieldId));
  }, [checklists, ctx, data.fields, fieldById, incoming, item.id]);
  const visible = data.fields.filter((f) => isVisible(f, item, ctx));

  return (
    <div className="flex flex-col gap-5">
      <Summary item={item} ctx={ctx} />
      <LinkedItems
        item={item}
        ctx={ctx}
        edges={edges}
        fieldById={fieldById}
        loading={incomingLoading}
        onOpen={onOpenLinked}
      />
      {checklists.map((f) => (
        <ChecklistSection
          key={f.id}
          org={org}
          item={item}
          field={f}
          ctx={ctx}
          onOpen={(t) =>
            onOpenLinked(
              ctx.item(t.id) ?? ({ id: t.id, sheetId: t.sheetId, displayId: t.displayId } as Item),
            )
          }
        />
      ))}
      {showsRequirements(data.sheet, data.fields) ? (
        <RequirementLinks
          org={org}
          item={item}
          ctx={ctx}
          fields={data.fields}
          onOpen={(t) =>
            onOpenLinked(
              ctx.item(t.itemId) ??
                ({ id: t.itemId, sheetId: t.sheetId, displayId: t.displayId } as Item),
            )
          }
          onLink={(fieldId, to) => onCommit(item, fieldId, to)}
        />
      ) : null}
      <ItemAutomations org={org} item={item} ctx={ctx} canPause={canPause} />
      <section aria-labelledby={`fields-${item.id}`} className="flex flex-col gap-2">
        <h3 id={`fields-${item.id}`} className="text-heading-14 m-0">
          All fields
        </h3>
        {!canEditItem ? (
          <p className="text-muted-foreground text-copy-13 m-0">{readOnlyReason}</p>
        ) : null}
        {visible.length === 0 ? (
          <p className="text-muted-foreground text-copy-13 m-0">
            This sheet has no fields yet. Add one from the Grid’s “+” column.
          </p>
        ) : (
          <dl className="m-0 grid grid-cols-[minmax(110px,150px)_minmax(0,1fr)] items-start gap-x-3 gap-y-1 group-data-[wide=true]/panel:min-[760px]:grid-cols-[170px_minmax(0,1fr)_170px_minmax(0,1fr)]">
            {visible.map((f) => (
              <FieldRow
                key={f.id}
                item={item}
                field={f}
                ctx={ctx}
                editable={canEditItem}
                readOnlyReason={readOnlyReason}
                onCommit={onCommit}
                onButton={() => onButton(f)}
                fieldProps={fieldProps ? (close) => fieldProps(f, close) : undefined}
              >
                {resolveFieldType(f.type)?.storage === 'files' ? (
                  <FilesField
                    org={org}
                    item={item}
                    field={f}
                    ctx={ctx}
                    editable={canEditItem}
                    versions={versions}
                    onSaved={onFileSaved}
                  />
                ) : undefined}
              </FieldRow>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
