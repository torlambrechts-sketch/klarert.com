import {
  EVIDENCE_STATUSES,
  EVIDENCE_STATUS_LABEL,
  evidenceStatus,
  type EvidenceStatus,
} from '../../evidence-library';
import { plural } from '../shared';
import type { Tone, WidgetTypeDef } from '../types';

const TONE: Record<EvidenceStatus, Tone> = {
  valid: 'good',
  expiring: 'warn',
  expired: 'crit',
  none: 'neutral',
};

/** evidence_status: current files by validity (all sheets, or one). */
export const evidenceStatusWidget: WidgetTypeDef = {
  id: 'evidence_status',
  label: 'Evidence status',
  description: 'Current files by validity: valid, expiring within 30 days, expired, no expiry.',
  needs: { sheet: 'optional', field: null, conditions: false, days: false },
  data: { evidence: true },
  defaultTitle: ({ sheet }) => (sheet ? `${sheet}: evidence status` : 'Evidence status'),
  compute(w, data) {
    if (w.sheetId && !data.sheet(w.sheetId))
      return { kind: 'problem', message: 'The sheet of this widget no longer exists.' };
    const files = w.sheetId ? data.evidence.filter((f) => f.sheetId === w.sheetId) : data.evidence;
    const counts = new Map<EvidenceStatus, number>(EVIDENCE_STATUSES.map((s) => [s, 0]));
    for (const f of files) {
      const s = evidenceStatus(f.validUntil, data.today);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return {
      kind: 'bars',
      bars: EVIDENCE_STATUSES.map((s) => ({
        key: s,
        label: EVIDENCE_STATUS_LABEL[s],
        value: counts.get(s) ?? 0,
        tone: TONE[s],
      })),
      total: files.length,
      caption: plural(files.length, 'current file'),
    };
  },
};
