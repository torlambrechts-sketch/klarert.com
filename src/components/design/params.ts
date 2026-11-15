// The Design pages' URL (docs/05 §4): filters and the chosen view, shared by the page, its export and the client screen.
import type { GraphFilter } from '@/engine/flow';
import type { Role } from '@/engine/types';

export interface DesignParams extends GraphFilter {
  show?: 'map' | 'table';
  focus?: string | null;
}

const one = (v: string | string[] | undefined) => (typeof v === 'string' && v ? v : null);

export function designParams(sp: Record<string, string | string[] | undefined>): DesignParams {
  return {
    app: one(sp.app),
    pack: one(sp.pack),
    group: one(sp.group),
    domain: one(sp.domain),
    differs: sp.differs === '1',
    show: sp.show === 'map' ? 'map' : 'table',
    focus: one(sp.focus),
  };
}

export function filterQuery(f: DesignParams): URLSearchParams {
  const q = new URLSearchParams();
  if (f.app) q.set('app', f.app);
  if (f.pack) q.set('pack', f.pack);
  if (f.group) q.set('group', f.group);
  if (f.domain) q.set('domain', f.domain);
  if (f.differs) q.set('differs', '1');
  if (f.show === 'map') q.set('show', 'map');
  return q;
}

/**
 * Who sees "Leaves the system" (owner open question; the safest reversible choice): owners and admins, who manage
 * where data goes, and auditors, for whom the data-flow record is made.
 */
export const canSeeLeaves = (role: Role) =>
  role === 'owner' || role === 'admin' || role === 'auditor';
