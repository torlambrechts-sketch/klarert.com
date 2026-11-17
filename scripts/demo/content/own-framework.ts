// The demo's own framework (docs/12 Your own frameworks, P8): a customer's supplier quality requirements, written by
// the workspace in its own words and mapped to ISO 9001:2015. "Acme" is the customary placeholder name; the
// requirements are fictional.

export const OWN_FRAMEWORK = {
  title: 'Acme customer quality requirements',
  shortTitle: 'Acme CQR',
  source: 'Acme Industrial supplier quality manual, revision F (fictional example)',
};

type Row = {
  ref: string;
  parent: string;
  kind: string;
  title: string;
  text: string;
  map?: string;
  relation?: 'equivalent' | 'partial' | 'related';
};

const ROWS: Row[] = [
  { ref: 'Q', parent: '', kind: 'theme', title: 'Quality system', text: '' },
  {
    ref: 'Q1',
    parent: 'Q',
    kind: 'clause',
    title: 'Certified quality management system',
    text: 'The supplier keeps a quality management system certified by an accredited body and tells Acme within 10 days if the certificate is suspended.',
    map: '4.4',
    relation: 'partial',
  },
  {
    ref: 'Q2',
    parent: 'Q',
    kind: 'clause',
    title: 'Named quality contact',
    text: 'The supplier names a quality contact who answers Acme within one working day.',
    map: '5.3',
    relation: 'related',
  },
  { ref: 'P', parent: '', kind: 'theme', title: 'Product and process', text: '' },
  {
    ref: 'P1',
    parent: 'P',
    kind: 'clause',
    title: 'First-article inspection',
    text: 'A full first-article inspection report goes with the first delivery of a new part or a new drawing revision.',
    map: '8.6',
    relation: 'partial',
  },
  {
    ref: 'P2',
    parent: 'P',
    kind: 'clause',
    title: 'Traceability to material batch',
    text: 'Every part can be traced to its material batch and certificate for 10 years.',
    map: '8.5',
    relation: 'partial',
  },
  {
    ref: 'P3',
    parent: 'P',
    kind: 'clause',
    title: 'Change notification',
    text: 'The supplier tells Acme before changing a process, a site or a sub-supplier for Acme parts.',
    map: '8.5',
    relation: 'related',
  },
  {
    ref: 'P4',
    parent: 'P',
    kind: 'clause',
    title: 'Calibrated gauges',
    text: 'Gauges used to accept Acme parts are calibrated against traceable standards.',
    map: '7.1.5',
    relation: 'equivalent',
  },
  { ref: 'N', parent: '', kind: 'theme', title: 'Nonconformity', text: '' },
  {
    ref: 'N1',
    parent: 'N',
    kind: 'clause',
    title: '8D report within 10 working days',
    text: 'For a rejected delivery, the supplier sends containment in 24 hours and an 8D report within 10 working days.',
    map: '10.2',
    relation: 'partial',
  },
  {
    ref: 'N2',
    parent: 'N',
    kind: 'clause',
    title: 'Concessions only in writing',
    text: 'Nonconforming parts are shipped only with a written concession from Acme.',
    map: '8.7',
    relation: 'partial',
  },
  { ref: 'S', parent: '', kind: 'theme', title: 'Sub-suppliers', text: '' },
  {
    ref: 'S1',
    parent: 'S',
    kind: 'clause',
    title: 'Approved special processes',
    text: 'Heat treatment and surface finishing are bought only from sources approved by the supplier and listed for Acme.',
    map: '8.4',
    relation: 'partial',
  },
];

export function ownFrameworkDraft() {
  return {
    title: OWN_FRAMEWORK.title,
    shortTitle: OWN_FRAMEWORK.shortTitle,
    kind: 'standard' as const,
    requirements: ROWS.map((r) => ({
      ref: r.ref,
      parent: r.parent,
      kind: r.kind,
      title: r.title,
      text: r.text,
      guidance: '',
      questions: [],
      evidence: [],
      tags: [],
    })),
    mappings: ROWS.filter((r) => r.map).map((r) => ({
      ref: r.ref,
      to: `iso-9001@2015#${r.map}`,
      relation: r.relation ?? 'related',
    })),
    copiedFrom: null,
  };
}

/** Requirements of the own framework the workspace already meets (implemented), and the ones in progress. */
export const OWN_STATUS = {
  implemented: ['Q1', 'Q2', 'P2', 'P4', 'S1'],
  partial: ['P1', 'N1', 'N2'],
  planned: ['P3'],
};
