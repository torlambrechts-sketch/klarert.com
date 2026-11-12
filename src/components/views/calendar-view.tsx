'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate } from '@/engine/fields/helpers';
import { itemStatusField } from '@/engine/fields/item-status';
import { resolveFieldType } from '@/engine/fields/resolve';
import { dayInput } from '@/engine/fields/view-support';
import type { SheetData } from '@/engine/sheet-data';
import type { Ctx, Item } from '@/engine/types';
import { keysOf } from '@/engine/values';
import {
  calendarEntries,
  entriesByDay,
  MONTH_NAMES,
  monthGrid,
  monthOf,
  shiftMonth,
} from '@/engine/views/calendar';
import type { ViewConfig } from '@/engine/views/config';
import { optionsOf } from '@/components/fields/kit';
import { actionNeeded, colorVar } from '@/components/fields/shared';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { NewItemRequest } from './new-item-dialog';

// Calendar (docs/05 §3.3, FR-24): a month grid, Monday first, by any calendar-capable field chosen per view. Items
// are chips coloured by status (timelines span their days); clicking a day adds an item with that date.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHOWN = 3;

export function CalendarView({
  data,
  ctx,
  items,
  config,
  setConfig,
  canEdit,
  onOpenItem,
  onNew,
}: {
  data: SheetData;
  ctx: Ctx;
  items: Item[];
  config: ViewConfig;
  setConfig(update: (c: ViewConfig) => ViewConfig): void;
  canEdit: boolean;
  onOpenItem(item: Item): void;
  onNew(req: NewItemRequest): void;
}) {
  const choices = data.fields.filter((f) => resolveFieldType(f.type)?.calendarCapable);
  const field = choices.find((f) => f.key === config.dateFieldKey) ?? choices[0] ?? null;
  const [month, setMonth] = useState(() => monthOf(ctx.today));
  const weeks = useMemo(() => monthGrid(month.year, month.month), [month]);
  const byDay = useMemo(
    () => (field ? entriesByDay(calendarEntries(items, field, ctx), weeks) : new Map()),
    [field, items, ctx, weeks],
  );
  const status = itemStatusField(ctx);
  const chipOption = (item: Item) => {
    if (!status) return null;
    const key = keysOf(item, status, ctx)[0];
    return optionsOf(status, ctx).find((o) => o.id === key) ?? null;
  };

  if (!field)
    return (
      <div className="border-line text-label-13 rounded-lg border border-dashed p-6">
        The calendar needs a date field (date, date and time, timeline, recurrence, evidence expiry,
        clock or retention). Add one to this sheet first.
      </div>
    );

  const settable = dayInput(field, ctx.today) !== undefined;
  const title = `${MONTH_NAMES[month.month - 1]} ${month.year}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setMonth(shiftMonth(month.year, month.month, -1))}
          >
            <ChevronLeft aria-hidden /> Previous
          </Button>
          <h2 className="text-heading-14 min-w-36 text-center" aria-live="polite">
            {title}
          </h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setMonth(shiftMonth(month.year, month.month, 1))}
          >
            Next <ChevronRight aria-hidden />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setMonth(monthOf(ctx.today))}
          >
            Today
          </Button>
        </div>
        <label className="text-label-13 flex items-center gap-2">
          <span className="text-muted-foreground">Dates from</span>
          <select
            className="border-input bg-background-100 h-8 rounded-md border px-2"
            value={field.key}
            onChange={(e) => setConfig((c) => ({ ...c, dateFieldKey: e.target.value }))}
          >
            {choices.map((f) => (
              <option key={f.id} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {canEdit && !settable ? (
        <p className="text-muted-foreground text-label-12">
          {field.name} is set by the app, so new items cannot be placed on a day here.
        </p>
      ) : null}
      <div className="border-line min-h-0 flex-1 overflow-auto rounded-lg border">
        <table
          className="text-label-12 w-full min-w-[340px] table-fixed border-collapse"
          aria-label={`${title}, by ${field.name}`}
        >
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th
                  key={d}
                  scope="col"
                  className="bg-soft border-line border-b px-1 py-1.5 text-center font-semibold"
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]!.date}>
                {week.map((day) => (
                  <DayCell
                    key={day.date}
                    date={day.date}
                    day={day.day}
                    inMonth={day.inMonth}
                    today={day.date === ctx.today}
                    entries={(byDay.get(day.date) ?? []).map((e: { item: Item }) => e.item)}
                    chipOption={chipOption}
                    ctx={ctx}
                    onOpenItem={onOpenItem}
                    onAdd={
                      canEdit && settable
                        ? () =>
                            onNew({
                              note: `${field.name}: ${formatDate(day.date)}`,
                              values: { [field.id]: dayInput(field, day.date) },
                            })
                        : undefined
                    }
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DayCell({
  date,
  day,
  inMonth,
  today,
  entries,
  chipOption,
  ctx,
  onOpenItem,
  onAdd,
}: {
  date: string;
  day: number;
  inMonth: boolean;
  today: boolean;
  entries: Item[];
  chipOption(item: Item): ReturnType<typeof optionsOf>[number] | null;
  ctx: Ctx;
  onOpenItem(item: Item): void;
  onAdd?: () => void;
}) {
  const label = formatDate(date);
  const chips = entries.slice(0, SHOWN);
  return (
    <td
      data-date={date}
      aria-current={today ? 'date' : undefined}
      className={cn(
        'border-line relative h-24 border p-1 align-top',
        !inMonth && 'bg-soft/60 text-muted-foreground',
        today && 'bg-info-soft',
      )}
    >
      {onAdd ? (
        <button
          type="button"
          aria-label={`Add an item on ${label}`}
          className="hover:bg-sel/60 focus-visible:outline-focus absolute inset-0 z-0 focus-visible:outline-2 focus-visible:-outline-offset-2"
          onClick={onAdd}
        />
      ) : null}
      <div className="pointer-events-none relative z-[1] flex flex-col gap-0.5">
        <span
          className={cn(
            'self-start px-0.5 font-semibold tabular-nums',
            today && 'bg-ink rounded-full px-1.5 text-white',
          )}
        >
          {day}
          {today ? <span className="sr-only"> (today)</span> : null}
        </span>
        {chips.map((item) => (
          <Chip
            key={item.id}
            item={item}
            option={chipOption(item)}
            ctx={ctx}
            onOpen={() => onOpenItem(item)}
          />
        ))}
        {entries.length > SHOWN ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="pointer-events-auto self-start px-0.5 font-semibold underline"
              >
                +{entries.length - SHOWN} more
              </button>
            </PopoverTrigger>
            <PopoverContent className="flex w-64 flex-col gap-1">
              <p className="text-copy-13 font-semibold">{label}</p>
              {entries.map((item) => (
                <Chip
                  key={item.id}
                  item={item}
                  option={chipOption(item)}
                  ctx={ctx}
                  onOpen={() => onOpenItem(item)}
                />
              ))}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </td>
  );
}

function Chip({
  item,
  option,
  ctx,
  onOpen,
}: {
  item: Item;
  option: { label: string; color: string; done?: boolean } | null;
  ctx: Ctx;
  onOpen(): void;
}) {
  const group = ctx.groups.get(item.groupId);
  const color = colorVar(option?.color ?? group?.color ?? 'grey');
  const solid = option ? actionNeeded(option as never) : false;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${item.displayId} ${item.name}${option ? ` · ${option.label}` : ''}`}
      className="text-label-12 pointer-events-auto block w-full truncate rounded border px-1 py-0.5 text-left font-semibold"
      style={
        solid
          ? { background: color, borderColor: color, color: 'var(--background-100)' }
          : {
              background: `color-mix(in srgb, ${color} 13%, white)`,
              borderColor: color,
              color: 'var(--ink)',
            }
      }
    >
      {option?.done ? '✓ ' : solid ? '! ' : ''}
      {item.name}
      {option ? <span className="sr-only"> ({option.label})</span> : null}
    </button>
  );
}
