// Coverage of an adopted framework (docs/12): of the requirements in scope (not marked "Not applicable"), the share
// that has at least one implemented control linked to it or current evidence on it. Also how many are decided,
// excluded and marked implemented, for the Frameworks page and the library's summary. Pure.

export interface CoverageInput {
  /** applicability of the library item; null = not decided yet (still in scope). */
  applicability: 'applicable' | 'not_applicable' | null;
  /** The item's own implementation status is done. */
  implemented: boolean;
  /** Linked controls: done = the control's status is done; null = its sheet has no status (a link counts). */
  controls: { done: boolean | null }[];
  /** Current evidence files on the requirement. */
  evidence: number;
}

export interface Coverage {
  total: number;
  applicable: number;
  notApplicable: number;
  undecided: number;
  /** In scope (applicable or undecided) with an implemented control or evidence. */
  covered: number;
  /** In scope and marked implemented. */
  implemented: number;
  /** covered / in scope, whole percent; null when nothing is in scope. */
  percent: number | null;
}

/** Whether one requirement counts as covered. */
export function isCovered(r: CoverageInput): boolean {
  if (r.applicability === 'not_applicable') return false;
  return r.evidence > 0 || r.controls.some((c) => c.done !== false);
}

export function coverageOf(rows: readonly CoverageInput[]): Coverage {
  const c: Coverage = {
    total: rows.length,
    applicable: 0,
    notApplicable: 0,
    undecided: 0,
    covered: 0,
    implemented: 0,
    percent: null,
  };
  for (const r of rows) {
    if (r.applicability === 'applicable') c.applicable += 1;
    else if (r.applicability === 'not_applicable') c.notApplicable += 1;
    else c.undecided += 1;
    if (isCovered(r)) c.covered += 1;
    if (r.applicability !== 'not_applicable' && r.implemented) c.implemented += 1;
  }
  const scope = c.total - c.notApplicable;
  c.percent = scope > 0 ? Math.floor((c.covered / scope) * 100) : null;
  return c;
}

/** "62% covered · 80 applicable · 5 not applicable · 42 to decide" */
export function coverageText(c: Coverage): string {
  if (c.total === 0) return 'No requirements';
  const parts = [
    c.percent === null ? 'Nothing in scope' : `${c.percent}% covered`,
    `${c.applicable} applicable`,
    `${c.notApplicable} not applicable`,
  ];
  if (c.undecided) parts.push(`${c.undecided} to decide`);
  return parts.join(' · ');
}
