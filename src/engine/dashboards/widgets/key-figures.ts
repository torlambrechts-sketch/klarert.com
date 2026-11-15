import { monthPoints, periodLabel, sheetHistory, type SheetHistory } from '../history';
import { plural } from '../shared';
import type { Figure, SheetSource, Tone, WidgetTypeDef } from '../types';
import { countItems } from '../../nouns';

/** Open items in up to this many sheets follow the done figure (all sheets). */
const MAX_OPEN = 3;

const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);

/** The change from the first point to the last: arrow direction, words and whether it is good. */
function deltaOf(
  first: number,
  last: number,
  unit: Figure['unit'],
  better: 'up' | 'down' | null,
  since: string,
): Figure['delta'] {
  const diff = last - first;
  if (diff === 0)
    return {
      direction: 'flat',
      text: 'No change',
      spoken: `no change since ${since}`,
      tone: 'neutral',
    };
  const direction = diff > 0 ? 'up' : 'down';
  const text =
    unit === 'percent'
      ? `${Math.abs(diff)} pts`
      : first > 0
        ? `${Math.round((Math.abs(diff) / first) * 100)}%`
        : String(Math.abs(diff));
  const tone: Tone = better === null ? 'neutral' : better === direction ? 'good' : 'crit';
  return {
    direction,
    text,
    spoken: `${direction} ${text.replace('pts', 'points')} since ${since}`,
    tone,
  };
}

function figure(
  key: string,
  label: string,
  unit: Figure['unit'],
  better: 'up' | 'down' | null,
  points: { date: string; label: string }[],
  valueAt: (date: string) => number,
  note: string,
  link?: Figure['link'],
): Figure {
  const series = points.map((p) => ({ ...p, value: valueAt(p.date) }));
  const first = series[0]?.value ?? 0;
  const value = series[series.length - 1]?.value ?? 0;
  const since = points[0] ? `the end of ${points[0].label}` : 'the start';
  return {
    key,
    label,
    unit,
    value,
    display: unit === 'percent' ? `${value}%` : String(value),
    delta: deltaOf(first, value, unit, better, since),
    series,
    note,
    link,
  };
}

/** key_figures: done and open items over the period, as tabs over one line chart. */
export const keyFigures: WidgetTypeDef = {
  id: 'key_figures',
  label: 'Key figures',
  description: 'Share of items done and open items over the months, as a line you can switch.',
  needs: { sheet: 'optional', field: null, conditions: false, days: false },
  data: { items: true, allSheets: true, history: true },
  wide: true,
  usesPeriod: true,
  defaultTitle: ({ sheet }) => (sheet ? `${sheet}: key figures` : 'Key figures'),
  compute(w, data) {
    const one = w.sheetId ? data.sheet(w.sheetId) : undefined;
    if (w.sheetId && !one)
      return {
        kind: 'problem',
        message: data.noAccess?.(w.sheetId)
          ? 'No access: this widget reads a sheet you cannot see.'
          : 'The sheet of this widget no longer exists.',
      };
    const points = monthPoints(data.today, data.months);
    const period = periodLabel(points);
    const start = points[0] ? `${points[0].date.slice(0, 8)}01` : data.today;
    const all = one ? [one] : data.sheets();
    const histories = all.map((s) => ({ s, h: sheetHistory(s, data) }));
    const deciding = histories.filter((x) => x.h.decides);
    if (all.length === 0)
      return {
        kind: 'figures',
        figures: [],
        period,
        empty: 'No sheets yet. Create a sheet to see figures here.',
      };

    const sum =
      (list: { h: SheetHistory }[], pick: (a: ReturnType<SheetHistory['at']>) => number) =>
      (date: string) =>
        list.reduce((n, x) => n + pick(x.h.at(date)), 0);
    const link = (s: SheetSource) => ({ to: 'sheet' as const, sheetId: s.sheet.id });
    const figures: Figure[] = [];
    const notOpen = (h: SheetHistory, label: string) => {
      const a = h.at(data.today);
      return `${a.open} of ${countItems(a.total, label)} not done`;
    };

    if (deciding.length > 0) {
      const done = sum(deciding, (a) => a.done);
      const total = sum(deciding, (a) => a.total);
      const now = { done: done(data.today), total: total(data.today) };
      figures.push(
        figure(
          'done',
          'Done',
          'percent',
          'up',
          points,
          (d) => pct(done(d), total(d)),
          `${one ? one.sheet.name : `Across ${plural(deciding.length, 'sheet')}`} · ${now.done} of ${plural(now.total, 'item')} done`,
          one ? link(one) : undefined,
        ),
      );
    }
    if (one) {
      const h = histories[0]!.h;
      const label = one.sheet.itemLabel;
      if (h.decides)
        figures.push(
          figure(
            'open',
            'Open',
            'count',
            'down',
            points,
            (d) => h.at(d).open,
            notOpen(h, label),
            link(one),
          ),
        );
      else
        figures.push(
          figure(
            'items',
            'Items',
            'count',
            null,
            points,
            (d) => h.at(d).total,
            `${countItems(h.at(data.today).total, label)} in ${one.sheet.name}`,
            link(one),
          ),
        );
      figures.push(
        figure(
          'added',
          'Added',
          'count',
          null,
          points,
          (d) => h.at(d).added(start),
          `${countItems(h.at(data.today).added(start), label)} added since 1 ${points[0]?.label ?? ''}`,
          link(one),
        ),
      );
    } else {
      const list = (deciding.length > 0 ? deciding : histories).slice(0, MAX_OPEN);
      for (const { s, h } of list) {
        const label = s.sheet.itemLabel;
        figures.push(
          h.decides
            ? figure(
                `open:${s.sheet.id}`,
                `Open in ${s.sheet.name}`,
                'count',
                'down',
                points,
                (d) => h.at(d).open,
                notOpen(h, label),
                link(s),
              )
            : figure(
                `items:${s.sheet.id}`,
                s.sheet.name,
                'count',
                null,
                points,
                (d) => h.at(d).total,
                `${countItems(h.at(data.today).total, label)} in ${s.sheet.name}`,
                link(s),
              ),
        );
      }
    }
    return { kind: 'figures', figures, period };
  },
};
