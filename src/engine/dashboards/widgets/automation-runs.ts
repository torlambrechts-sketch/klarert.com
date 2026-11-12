import { DEFAULT_DAYS } from '../types';
import { plural, sinceDay } from '../shared';
import type { Tone, WidgetTypeDef } from '../types';

/** The run statuses of docs/04 §8, in the order the bars show them. */
const STATUSES: { id: string; label: string; tone: Tone }[] = [
  { id: 'done', label: 'Done', tone: 'good' },
  { id: 'partial', label: 'Partly done', tone: 'warn' },
  { id: 'failed', label: 'Failed', tone: 'crit' },
  { id: 'stopped', label: 'Stopped by the loop guard', tone: 'crit' },
  { id: 'skipped', label: 'Skipped', tone: 'neutral' },
];

/** automation_runs: runs by status in the last N days (all sheets, or one). */
export const automationRuns: WidgetTypeDef = {
  id: 'automation_runs',
  label: 'Automation runs',
  description: 'Runs by outcome in the last days, from the run log.',
  needs: { sheet: 'optional', field: null, conditions: false, days: true },
  data: { runs: true },
  defaultTitle: ({ days }) => `Automation runs, last ${plural(days ?? DEFAULT_DAYS, 'day')}`,
  compute(w, data) {
    if (w.sheetId && !data.sheet(w.sheetId))
      return { kind: 'problem', message: 'The sheet of this widget no longer exists.' };
    const days = w.days ?? DEFAULT_DAYS;
    const since = sinceDay(data.today, days);
    const runs = data.runs.filter(
      (r) => r.date >= since && r.date <= data.today && (!w.sheetId || r.sheetId === w.sheetId),
    );
    const bars = STATUSES.map((s) => ({
      key: s.id,
      label: s.label,
      value: runs.filter((r) => r.status === s.id).length,
      tone: s.tone,
    }));
    return {
      kind: 'bars',
      bars,
      total: runs.length,
      caption: `${plural(runs.length, 'run')} in the last ${plural(days, 'day')}`,
    };
  },
};
