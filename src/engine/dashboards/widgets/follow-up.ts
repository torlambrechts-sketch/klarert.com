import { evidenceStatus } from '../../evidence-library';
import { dateOf, defOf, isItemDone, kindOf } from '../../values';
import { plural, sinceDay } from '../shared';
import { DEFAULT_DAYS, type WidgetRow, type WidgetTypeDef } from '../types';

/** Sheets with a deadline that get an overdue row, at most. */
const MAX_SHEETS = 5;

/** follow_up: what needs chasing across the workspace: overdue items per sheet, evidence, failed runs. */
export const followUp: WidgetTypeDef = {
  id: 'follow_up',
  label: 'Follow-up health',
  description: 'Overdue items per sheet, expiring and expired evidence and failed automation runs.',
  needs: { sheet: 'none', field: null, conditions: false, days: false },
  data: { allSheets: true, evidence: true, runs: true },
  defaultTitle: () => 'Follow-up health',
  compute(_w, data) {
    const rows: WidgetRow[] = [];
    for (const s of data.sheets()) {
      if (rows.length >= MAX_SHEETS) break;
      const due = s.fields.find(
        (f) => kindOf(f, s.ctx) === 'date' && !!defOf(f).isDeadline?.(f.config),
      );
      if (!due) continue;
      const open = s.items.filter((i) => !isItemDone(i, s.ctx));
      const late = open.filter((i) => {
        const d = dateOf(i, due, s.ctx);
        return !!d && d < data.today;
      }).length;
      rows.push({
        key: `overdue:${s.sheet.id}`,
        label: `${s.sheet.name} overdue`,
        sub: `${late} of ${open.length} open · by ${due.name.toLowerCase()}`,
        value: String(late),
        count: late,
        tone: late > 0 ? 'crit' : 'neutral',
        link: { to: 'sheet', sheetId: s.sheet.id },
      });
    }
    const files = data.evidence.map((f) => evidenceStatus(f.validUntil, data.today));
    const expiring = files.filter((f) => f === 'expiring').length;
    const expired = files.filter((f) => f === 'expired').length;
    rows.push(
      {
        key: 'evidence:expiring',
        label: 'Evidence expiring in 30 days',
        sub: `Of ${plural(files.length, 'current file')}`,
        value: String(expiring),
        count: expiring,
        tone: expiring > 0 ? 'warn' : 'neutral',
        link: { to: 'evidence' },
      },
      {
        key: 'evidence:expired',
        label: 'Evidence expired',
        sub: 'Renew or replace these files',
        value: String(expired),
        count: expired,
        tone: expired > 0 ? 'crit' : 'neutral',
        link: { to: 'evidence' },
      },
    );
    const since = sinceDay(data.today, DEFAULT_DAYS);
    const failed = data.runs.filter(
      (r) =>
        r.date >= since &&
        r.date <= data.today &&
        (r.status === 'failed' || r.status === 'stopped'),
    ).length;
    rows.push({
      key: 'runs:failed',
      label: 'Automation runs failed',
      sub: `Last ${DEFAULT_DAYS} days, from the run log`,
      value: String(failed),
      count: failed,
      tone: failed > 0 ? 'crit' : 'neutral',
      link: { to: 'automations' },
    });
    const attention = rows.filter((r) => (r.count ?? 0) > 0).length;
    return {
      kind: 'rows',
      rows,
      meta: attention > 0 ? `${attention} need attention` : 'Nothing needs attention',
    };
  },
};
