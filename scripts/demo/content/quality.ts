// The ISO 9001 pack's sheets at Meridian Components Ltd: processes, customer feedback and complaints, external
// providers and their evaluations, measuring equipment and calibration, release records, the management reviews and
// the supplier reviews of the supplier management pack. Fictional throughout; dates from the demo clock.
import type { DemoClock } from '../clock';
import { nameOf as n, type PersonRef } from '../people';
import { item, q15, type DemoSheet } from './types';

export function qualityContent(c: DemoClock): DemoSheet[] {
  return [
    {
      sheet: 'Processes',
      items: [
        proc(
          'Quotation and contract review',
          'Core processes',
          'hannah',
          {
            inputs: 'Customer enquiry, drawing, specification, quantities and dates',
            outputs: 'Quotation, confirmed order, contract review record',
            kpis: 'Quote turnaround (target 3 working days); orders with a contract review record (100%)',
          },
          [q15('8.2')],
        ),
        proc(
          'Production planning',
          'Core processes',
          'ellie',
          {
            inputs: 'Confirmed orders, capacity, material availability',
            outputs: 'Weekly schedule, works orders, material calls',
            kpis: 'Schedule adherence; on-time delivery',
          },
          [q15('8.1')],
        ),
        proc(
          'Machining and finishing',
          'Core processes',
          'ellie',
          {
            inputs: 'Works order, released CNC program, material with certificate',
            outputs: 'Parts to drawing with traceability to the bar',
            kpis: 'Scrap cost; first-pass yield by cell',
          },
          [q15('8.5'), q15('4.4')],
        ),
        proc(
          'Inspection and release',
          'Core processes',
          'priya',
          {
            inputs: 'Parts, drawing, inspection plan',
            outputs: 'Inspection record, certificate of conformity, released batch',
            kpis: 'Customer ppm; release records complete (100%)',
          },
          [q15('8.6')],
        ),
        proc(
          'Purchasing and supplier control',
          'Support processes',
          'marcus',
          {
            inputs: 'Material requirements, approved supplier list',
            outputs: 'Purchase orders, supplier evaluations',
            kpis: 'Supplier on-time delivery; supplier ppm',
          },
          [q15('8.4')],
        ),
        proc(
          'Calibration and measurement',
          'Support processes',
          'priya',
          {
            inputs: 'Gauge register, calibration intervals',
            outputs: 'Calibration certificates, gauge status tags',
            kpis: 'Gauges in date (100%)',
          },
          [q15('7.1.5')],
        ),
        proc('Training and competence', 'Support processes', 'grace', {
          inputs: 'Skills matrix, job descriptions',
          outputs: 'Training records, competence sign-off',
          kpis: 'Skills matrix coverage per cell',
        }),
        proc(
          'Internal audit and management review',
          'Management processes',
          'priya',
          {
            inputs: 'Audit programme, KPIs, customer feedback',
            outputs: 'Audit reports, review minutes, actions',
            kpis: 'Audit programme on schedule; actions closed on time',
          },
          [q15('9.2'), q15('9.3')],
        ),
        {
          name: 'Customer returns handling',
          group: 'Core processes',
          by: 'priya',
          values: { owner: n('priya'), status: 'Draft', next_review: c.day(30) },
        },
      ],
    },
    {
      sheet: 'Customer feedback and complaints',
      items: [
        complaint(
          'Manifold blocks shipped without inspection record',
          'Kestrelmoor Pumps',
          'Being handled',
          {
            kind: 'Complaint',
            received_on: c.day(-17),
            channel: 'Email',
            product: 'MB-40 manifold block, batch 2611',
            description:
              'Certificate of conformity received but no inspection record. Goods-in put the batch on hold.',
            seriousness: 'High',
            owner: n('priya'),
            nc_needed: true,
            status: 'Investigating',
          },
        ),
        complaint('Burrs on cross-drilled holes', 'Orrin Hydraulics', 'Closed', {
          kind: 'Complaint',
          received_on: c.day(-80),
          channel: 'Phone',
          product: 'Valve body VB-12',
          description: 'Burrs found on 6 parts in a delivery of 250.',
          seriousness: 'Medium',
          owner: n('ellie'),
          response:
            'Parts replaced in 48 hours. Deburring added as a separate operation with a check sheet (WI-044).',
          status: 'Closed',
        }),
        complaint('Late delivery of pump shafts', 'Kestrelmoor Pumps', 'Closed', {
          kind: 'Complaint',
          received_on: c.day(-120),
          channel: 'Email',
          product: 'Pump shaft PS-220',
          description: 'Order delivered nine days after the confirmed date.',
          seriousness: 'Medium',
          owner: n('marcus'),
          response:
            'Bar supplier missed its date. Safety stock raised and a second source is being approved.',
          status: 'Closed',
        }),
        complaint('Praise for the quick turnaround on prototypes', 'Varnley Medical', 'Closed', {
          kind: 'Praise',
          received_on: c.day(-44),
          channel: 'Visit or meeting',
          description: 'Engineering team thanked us for prototype housings delivered in five days.',
          owner: n('hannah'),
          response: 'Shared with the Leeds prototype cell.',
          status: 'Closed',
        }),
        complaint('Customer survey, spring', 'All key accounts', 'Closed', {
          kind: 'Survey result',
          received_on: c.day(-190),
          channel: 'Survey',
          description:
            '14 of 18 customers answered. Average 4.2 of 5. Lowest score: delivery reliability (3.6).',
          owner: n('priya'),
          response: 'Delivery reliability set as a quality objective (on-time delivery 96%).',
          status: 'Closed',
        }),
        complaint(
          'Question about material certificates for 17-4PH',
          'Tamsett Aero Components',
          'Being handled',
          {
            kind: 'Suggestion',
            received_on: c.day(-4),
            channel: 'Web form',
            description:
              'Asks whether we can supply 3.1 certificates with every batch, not on request.',
            owner: n('marcus'),
            status: 'New',
          },
        ),
      ],
    },
    {
      sheet: 'External providers',
      items: [
        provider(
          'Brackwell Bar & Tube',
          'Approved',
          'Materials and components',
          'High',
          4,
          -320,
          40,
        ),
        provider('Quenby Heat Treatment', 'Approved', 'Outsourced process', 'High', 4, -250, 120),
        provider(
          'Pennock Anodising',
          'Approved with conditions',
          'Outsourced process',
          'High',
          3,
          -60,
          10,
        ),
        provider(
          'Lindqvar Tooling',
          'Approved',
          'Materials and components',
          'Medium',
          5,
          -150,
          210,
        ),
        provider(
          'Calverley Calibration Services',
          'Approved',
          'Calibration or testing',
          'High',
          5,
          -210,
          150,
        ),
        provider('Fernmoor Logistics', 'Approved', 'Service', 'Medium', 3, -385, -20),
        {
          name: 'Osgrove Castings',
          group: 'Being evaluated',
          by: 'marcus',
          values: {
            category: 'Materials and components',
            provides: 'Aluminium castings for pump housings (second source)',
            criticality: 'High',
            owner: n('marcus'),
            criteria:
              'Sample batch of 50 to drawing; ISO 9001 certificate; capacity 2,000 a month.',
            status: 'Under evaluation',
            next_evaluation: c.day(30),
          },
        },
      ],
    },
    {
      sheet: 'Measuring equipment',
      items: [
        gauge(
          'CMM-01 Coordinate measuring machine',
          'CMM-01',
          'Leeds gauge room',
          '700 x 1000 x 600 mm',
          12,
          -150,
          'In use',
        ),
        gauge(
          'MIC-14 Outside micrometer 25-50 mm',
          'MIC-14',
          'Leeds cell 1',
          '25-50 mm',
          12,
          -330,
          'In use',
        ),
        gauge('BG-07 Bore gauge 18-35 mm', 'BG-07', 'Leeds cell 2', '18-35 mm', 6, -197, 'Due'),
        gauge(
          'CAL-22 Digital caliper 150 mm',
          'CAL-22',
          'Leeds cell 4',
          '0-150 mm',
          12,
          -340,
          'In use',
        ),
        gauge('HT-03 Hardness tester', 'HT-03', 'Leeds lab', 'HRC 20-70', 12, -60, 'In use'),
        gauge(
          'SRT-02 Surface roughness tester',
          'SRT-02',
          'Tilburg QC',
          'Ra 0.05-10 µm',
          12,
          -100,
          'In use',
        ),
        gauge(
          'TW-11 Torque wrench 5-60 Nm',
          'TW-11',
          'Tilburg assembly',
          '5-60 Nm',
          6,
          -170,
          'In use',
        ),
        gauge(
          'PG-09 Thread plug gauge M8x1.25',
          'PG-09',
          'Leeds cell 3',
          'M8x1.25 6H',
          12,
          -380,
          'Due',
        ),
        gauge('HG-05 Height gauge 300 mm', 'HG-05', 'Tilburg QC', '0-300 mm', 12, -20, 'In use'),
        gauge(
          'MIC-02 Outside micrometer 0-25 mm',
          'MIC-02',
          'Retired, Leeds',
          '0-25 mm',
          12,
          -500,
          'Retired',
        ),
      ],
    },
    {
      sheet: 'Release records',
      items: [
        release('Batch 2598, PS-220 pump shafts', 'Released', -30),
        release('Batch 2604, VB-12 valve bodies', 'Released', -22),
        release('Batch 2611, MB-40 manifold blocks', 'Released', -18),
        release('Batch 2630, PS-220 pump shafts', 'Released', -6),
        release('Batch 2633, H-75 anodised housings', 'Held', -2),
        release('Batch 2637, VB-12 valve bodies', 'Waiting', 0),
      ],
    },
    {
      sheet: 'Management reviews',
      items: [
        {
          name: 'Management review, last year',
          group: 'Held',
          by: 'priya',
          values: {
            chair: n('hannah'),
            meeting_date: c.month(-12, 12),
            status: 'Actions agreed',
            inputs:
              'KPIs for the year, audit results, customer survey, supplier performance, risks and opportunities.',
            decisions:
              'Set on-time delivery as a quality objective; approve a second bar source; budget for mist extraction; start ISO 27001.',
            input_actions: true,
            input_issues: true,
            input_parties: true,
            input_nonconformities: true,
            input_monitoring: true,
            input_audits: true,
            input_objectives: true,
            input_risks: true,
            input_resources: true,
            input_improvement: true,
            standards: ['All standards'],
          },
        },
      ],
    },
    {
      sheet: 'Supplier reviews',
      items: [
        sreview(
          'Brackwell Bar & Tube: annual review',
          'Brackwell Bar & Tube',
          'marcus',
          -45,
          'Pass with conditions',
          'On-time delivery 88% against a 95% target. Agreed a weekly call and six weeks of safety stock.',
        ),
        sreview(
          'Pennock Anodising: audit after missing certificates',
          'Pennock Anodising',
          'priya',
          -12,
          'Pass with conditions',
          'Certificates now printed with the delivery note. Coating thickness checks sampled at goods-in for three months.',
        ),
        sreview(
          'Tallis ERP Cloud: security review',
          'Tallis ERP Cloud',
          'daniel',
          -70,
          'Pass',
          'ISO 27001 certificate current; EU hosting confirmed; backups restored in their annual test.',
        ),
        sreview(
          'Calverley Calibration Services: annual review',
          'Calverley Calibration Services',
          'priya',
          -200,
          'Pass',
          'UKAS scope covers all our gauge types. Turnaround 6 days on average.',
        ),
        sreview('Fernmoor Logistics: annual review', 'Fernmoor Logistics', 'marcus', 20, null, ''),
      ],
    },
  ];

  function proc(
    name: string,
    group: string,
    owner: PersonRef,
    values: { inputs: string; outputs: string; kpis: string },
    clauses?: string[],
  ) {
    return {
      name,
      group,
      by: 'priya' as const,
      values: { owner: n(owner), ...values, next_review: c.day(60 + name.length * 3) },
      links: clauses ? { clauses } : undefined,
      steps: [{ by: 'priya' as const, values: { status: 'Defined' } }],
    };
  }

  function complaint(
    name: string,
    customer: string,
    group: string,
    values: Record<string, unknown>,
  ) {
    const { status, ...rest } = values;
    return {
      name,
      group,
      by: 'priya' as const,
      values: { customer, ...rest, status: status === 'Closed' ? 'Answered' : status },
      links: { clauses: [q15('9.1.2')] },
      steps:
        status === 'Closed' ? [{ by: 'priya' as const, values: { status: 'Closed' } }] : undefined,
    };
  }

  function provider(
    name: string,
    status: string,
    category: string,
    criticality: string,
    score: number,
    last: number,
    next: number,
  ) {
    return {
      name,
      group: 'Approved',
      by: 'marcus' as const,
      values: {
        category,
        criticality,
        owner: n(category === 'Calibration or testing' ? 'priya' : 'marcus'),
        criteria:
          'Quality: certificate and ppm. Delivery: on time against confirmed date. Service: response to problems within 2 days.',
        score,
        last_evaluated: c.day(last),
        next_evaluation: c.day(next),
      },
      links: { clauses: [q15('8.4')] },
      steps: [{ by: 'priya' as const, values: { status } }],
      files: [
        {
          field: 'certificate',
          name: `${name.split(' ')[0]}-ISO-9001-certificate.pdf`,
          lines: [
            `${name}`,
            'Certificate of registration (fictional example)',
            'Management system: ISO 9001:2015',
            'Issued by: Example Certification Body',
          ],
          validUntil: c.day(next > 0 ? next + 200 : 25),
          description: 'Supplier ISO 9001 certificate',
        },
      ],
    };
  }

  function gauge(
    name: string,
    id: string,
    location: string,
    range: string,
    interval: number,
    last: number,
    state: 'In use' | 'Due' | 'Retired',
  ) {
    const lastDate = c.day(last);
    const next = c.day(last + Math.round(interval * 30.4));
    return {
      name,
      group: state === 'Retired' ? 'Retired' : 'In use',
      by: 'priya' as const,
      values: {
        equipment_id: id,
        location,
        owner: n(location.startsWith('Tilburg') ? 'ellie' : 'priya'),
        range,
        interval,
        last_calibrated: lastDate,
        next_calibration: next,
        traceable: true,
      },
      links: { clauses: [q15('7.1.5')] },
      steps: [
        {
          by: 'priya' as const,
          values: {
            status:
              state === 'Retired' ? 'Retired' : state === 'Due' ? 'Calibration due' : 'Calibrated',
          },
        },
      ],
      files:
        state === 'Retired'
          ? []
          : [
              {
                field: 'certificate',
                name: `${id}-calibration-certificate.pdf`,
                lines: [
                  `Calibration certificate for ${id}`,
                  `Range ${range}. Calibrated ${lastDate}. Within tolerance at all points.`,
                  'Laboratory: Calverley Calibration Services (fictional)',
                ],
                validUntil: next,
              },
            ],
    };
  }

  function release(name: string, status: 'Released' | 'Held' | 'Waiting', day: number) {
    return {
      name,
      group: status === 'Released' ? 'Released' : status === 'Held' ? 'Held' : 'Waiting',
      by: 'ellie' as const,
      values: {
        batch: name.split(',')[0]!.replace('Batch ', ''),
        criteria:
          'All drawing dimensions in tolerance; surface finish Ra 0.8; material certificate on file.',
        inspector: n('ellie'),
        released_on: status === 'Released' ? c.day(day) : undefined,
      },
      links: { clauses: [q15('8.6')] },
      steps: [{ by: 'priya' as const, values: { status } }],
    };
  }

  function sreview(
    name: string,
    supplier: string,
    reviewer: PersonRef,
    day: number,
    result: string | null,
    findings: string,
  ) {
    return {
      name,
      group: result ? 'Done' : 'Planned',
      by: reviewer,
      values: {
        reviewer: n(reviewer),
        review_date: c.day(day),
        result: result ?? undefined,
        findings: findings || undefined,
      },
      links: { supplier: [item('Suppliers', supplier)] },
    };
  }
}
