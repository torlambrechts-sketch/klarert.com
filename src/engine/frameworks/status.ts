// Edition status of a framework version (docs/12 Standards watch): is the edition still the one to use, and if not,
// what replaces it and until when certificates stay valid. Words for the catalogue badge, the adoption warning and
// the staleness check of the monthly watch. Pure: today is passed in.
import type { EditionInfo, EditionStatus } from './types';

/** The catalogue's edition statuses must be checked at least this often (a unit test fails otherwise). */
export const STATUS_MAX_AGE_DAYS = 120;

export const EDITION_STATUS_LABEL: Record<EditionStatus, string> = {
  current: 'Current edition',
  withdrawn: 'Withdrawn',
  'superseded-in-transition': 'Superseded',
  'revision-in-progress': 'Revision in progress',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2029-04-30" → "Apr 2029". */
export function monthYear(iso: string): string {
  const [y, m] = iso.split('-');
  const month = MONTHS[Number(m) - 1];
  return month && y ? `${month} ${y}` : iso;
}

/** "2026-11-14" → "14 Nov 2026". */
export function dayMonthYear(iso: string): string {
  const [y, m, d] = iso.split('-');
  const month = MONTHS[Number(m) - 1];
  return month && y && d ? `${Number(d)} ${month} ${y}` : iso;
}

/** The successor named by `supersededBy`, split: { key, version }. */
export function successorId(e: Pick<EditionInfo, 'supersededBy'>) {
  if (!e.supersededBy) return null;
  const [key, version] = e.supersededBy.split('@');
  return key && version ? { key, version } : null;
}

/** An edition people should not start on: withdrawn, or replaced and only valid during a transition. */
export const isReplaced = (e: Pick<EditionInfo, 'status'>) =>
  e.status === 'withdrawn' || e.status === 'superseded-in-transition';

export type BadgeTone = 'current' | 'replaced' | 'revision';

export interface EditionBadge {
  tone: BadgeTone;
  /** "Withdrawn · replaced by ISO 14001:2026 · transition ends Apr 2029" */
  text: string;
}

/**
 * The badge for an edition. `successorTitle` is the title of the edition that replaces it, when the catalogue has
 * it ("ISO 14001:2026"); otherwise the key is shown. A current edition with nothing on the way has no badge.
 */
export function editionBadge(
  e: Omit<EditionInfo, 'statusCheckedOn'>,
  successorTitle: string | null,
): EditionBadge | null {
  if (isReplaced(e)) {
    const parts = [EDITION_STATUS_LABEL[e.status]];
    if (e.supersededBy) parts.push(`replaced by ${successorTitle ?? e.supersededBy}`);
    if (e.transitionEnds) parts.push(`transition ends ${monthYear(e.transitionEnds)}`);
    return { tone: 'replaced', text: parts.join(' · ') };
  }
  if (e.status === 'revision-in-progress') {
    const parts = [
      `${EDITION_STATUS_LABEL[e.status]}${e.revisionStage ? ` (${e.revisionStage})` : ''}`,
    ];
    if (e.revisionExpected) parts.push(`expected ${e.revisionExpected}`);
    return { tone: 'revision', text: parts.join(' · ') };
  }
  return null;
}

/** Days from `from` to `to` (ISO dates, whole days, UTC). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The status was checked too long ago (or is dated in the future, which is a typo). */
export function statusIsStale(
  e: Pick<EditionInfo, 'statusCheckedOn'>,
  today: string,
  maxDays = STATUS_MAX_AGE_DAYS,
): boolean {
  const age = daysBetween(e.statusCheckedOn, today);
  return Number.isNaN(age) || age > maxDays || age < 0;
}

/** "Status checked 14 Nov 2026" with the note, for the catalogue's detail line. */
export function statusCheckedText(e: Pick<EditionInfo, 'statusCheckedOn'>): string {
  return `Edition status checked ${dayMonthYear(e.statusCheckedOn)}`;
}

/** What the adoption dialog says before someone adopts a replaced edition. */
export function replacedWarning(
  e: Omit<EditionInfo, 'statusCheckedOn'> & { title: string },
  successor: { title: string; inCatalogue: boolean } | null,
): string | null {
  if (!isReplaced(e)) return null;
  const by = successor?.title ?? e.supersededBy ?? 'a newer edition';
  const until = e.transitionEnds
    ? ` Certificates to ${e.title} stay valid until about ${monthYear(e.transitionEnds)}; your certification body confirms the exact date.`
    : '';
  const advice = successor?.inCatalogue
    ? ` We recommend adopting ${by} instead, unless you need ${e.title} for an audit during the transition.`
    : '';
  return `${e.title} is ${e.status === 'withdrawn' ? 'withdrawn' : 'superseded'} and replaced by ${by}.${until}${advice}`;
}
