// Environment (ISO 14001) and health and safety (ISO 45001) at Meridian Components Ltd: earlier in the journey than
// quality, with aspects, monthly monitoring, hazards, worker consultation, contractors, drills and health checks.
import type { DemoClock } from '../clock';
import { nameOf as n } from '../people';
import { env26, item, ohs, type DemoItem, type DemoSheet } from './types';

export function ehsContent(c: DemoClock): DemoSheet[] {
  // monthly electricity readings, the last twelve months (kWh per spindle hour)
  const energy = [6.5, 6.4, 6.3, 6.4, 6.2, 6.1, 6.2, 6.0, 6.1, 6.0, 5.9, 6.05];
  const monitoring: DemoItem[] = energy.map((v, i) => {
    const monthsAgo = energy.length - i;
    return {
      name: `Electricity per spindle hour, ${monthLabel(c.month(-monthsAgo, 28))}`,
      group: monthsAgo > 1 ? 'Reviewed' : 'Recorded',
      by: 'grace',
      values: {
        parameter: 'Electricity per spindle hour',
        location: 'Leeds',
        measured_on: c.month(-monthsAgo, 28),
        value: v,
        limit: 6.4,
        unit: 'kWh',
        owner: n('grace'),
        status: monthsAgo > 1 ? 'Reviewed' : 'To review',
      },
    };
  });
  monitoring.push(
    {
      name: `Trade effluent COD, ${monthLabel(c.month(-1, 15))}`,
      group: 'Recorded',
      by: 'grace',
      values: {
        parameter: 'Chemical oxygen demand (COD)',
        location: 'Leeds outfall',
        measured_on: c.month(-1, 15),
        value: 1650,
        limit: 1500,
        unit: 'mg/l',
        owner: n('grace'),
        equipment: 'Accredited lab sample',
        status: 'Action needed',
      },
      links: { clauses: [env26('9.1.1')] },
    },
    {
      name: `Trade effluent COD, ${monthLabel(c.month(-4, 15))}`,
      group: 'Reviewed',
      by: 'grace',
      values: {
        parameter: 'Chemical oxygen demand (COD)',
        location: 'Leeds outfall',
        measured_on: c.month(-4, 15),
        value: 1180,
        limit: 1500,
        unit: 'mg/l',
        owner: n('grace'),
        status: 'Reviewed',
      },
    },
  );

  return [
    {
      sheet: 'Environmental aspects',
      items: [
        aspect(
          'Electricity use by CNC machines',
          'Machining',
          'Electricity use',
          'Climate change from grid emissions',
          4,
          5,
          'Significant',
        ),
        aspect(
          'Waste cutting fluid',
          'Machining',
          'Spent coolant',
          'Water pollution if spilled',
          4,
          3,
          'Significant',
        ),
        aspect(
          'Metal swarf',
          'Machining',
          'Swarf and offcuts',
          'Resource use; recycled',
          2,
          5,
          'Not significant',
        ),
        aspect(
          'Anodising (outsourced)',
          'Finishing',
          'Chemical use at the supplier',
          'Water pollution',
          3,
          2,
          'Not assessed',
        ),
        aspect(
          'Pallet transport UK to NL',
          'Logistics',
          'Diesel use',
          'Air emissions',
          3,
          4,
          'Significant',
        ),
      ],
    },
    { sheet: 'Environmental monitoring', items: monitoring },
    {
      sheet: 'Environmental communications',
      items: [
        {
          name: 'Neighbour asks about weekend compressor noise',
          group: 'Closed',
          by: 'grace',
          values: {
            party: 'Neighbour or the public',
            contact_name: 'A resident on the estate road',
            received_on: c.day(-62),
            topic: 'Compressor running on Sunday mornings.',
            owner: n('grace'),
            answer: 'Compressor now on a timer; off from Saturday 14:00 to Monday 05:00.',
            status: 'Answered',
          },
        },
      ],
    },
    {
      sheet: 'Emergency preparedness',
      items: [
        {
          name: 'Coolant concentrate spill',
          group: 'Tested',
          by: 'grace',
          values: {
            situation: 'IBC of coolant concentrate leaks in the delivery area.',
            response: 'Stop the leak, cover drains, use the spill kit, call the waste contractor.',
            equipment: 'Spill kits at goods-in and the coolant store; drain covers',
            owner: n('grace'),
            last_tested: c.day(-9),
            next_test: c.day(170),
            lessons: 'The Tilburg kit was empty: add kits to the monthly inspection.',
            status: 'Tested',
          },
        },
      ],
    },
    {
      sheet: 'Hazards and OH&S risks (HIRA)',
      items: [
        hazard(
          'Rotating chuck entanglement',
          'Turning cells',
          'Mechanical',
          3,
          5,
          'Accepted',
          'Interlocked guards, no gloves near rotating parts, setter training',
          1,
          5,
        ),
        hazard(
          'Coolant mist inhalation',
          'Turning cells',
          'Chemical',
          3,
          3,
          'Needs more controls',
          'Mist extraction on newer lathes; health surveillance',
          null,
          null,
        ),
        hazard(
          'Manual handling of bar stock',
          'Saw and stores',
          'Lifting and posture',
          3,
          3,
          'Accepted',
          'Bar lifter, two-person lift above 25 kg',
          2,
          2,
        ),
        hazard(
          'Forklift and pedestrians',
          'Goods-in and stores',
          'Mechanical',
          3,
          4,
          'Being assessed',
          '',
          null,
          null,
        ),
        hazard(
          'Noise from the saw and compressors',
          'Saw area',
          'Noise, vibration or heat',
          3,
          2,
          'Accepted',
          'Hearing protection zone, annual audiometry',
          2,
          2,
        ),
      ],
    },
    {
      sheet: 'Worker consultation and participation',
      items: [
        {
          name: 'Safety committee, last quarter',
          group: 'Done',
          by: 'grace',
          values: {
            channel: 'Safety committee',
            held_on: c.day(-35),
            topic: 'Near misses, mist extraction plan, new PPE supplier.',
            participants: '8, including two elected representatives',
            outcome: 'Mist extraction on lathes 2 and 5 first; PPE trial in cell 4.',
            owner: n('grace'),
            status: 'Closed',
          },
          links: { clauses: [ohs('5.4')] },
        },
        {
          name: 'Concern: walkway at the saw is too narrow',
          group: 'Open',
          by: 'grace',
          values: {
            channel: 'Concern raised',
            held_on: c.day(-3),
            topic: 'Raised after the forklift near miss.',
            raised_by: 'Saw operator, day shift',
            owner: n('grace'),
            needs_action: true,
            status: 'Being followed up',
          },
          links: { actions: [item('Actions', 'Mark walkways at the saw and add a banksman rule')] },
        },
      ],
    },
    {
      sheet: 'Contractors',
      items: [
        {
          name: 'Compressor service engineers',
          group: 'Approved',
          by: 'grace',
          values: {
            work: 'Quarterly compressor and air dryer service, Leeds.',
            owner: n('grace'),
            inducted_on: c.day(-80),
            permit: true,
            approval_expires: c.day(285),
          },
          files: [
            {
              field: 'method_statement',
              name: 'compressor-service-method-statement.pdf',
              lines: [
                'Method statement: compressor service (fictional)',
                'Isolation, lock-off, pressure release, test run.',
              ],
            },
            {
              field: 'insurance',
              name: 'compressor-service-insurance.pdf',
              lines: ['Public liability insurance (fictional example)', 'Cover GBP 5m'],
              validUntil: c.day(160),
            },
          ],
          steps: [{ by: 'grace', values: { status: 'Approved for work' } }],
        },
        {
          name: 'Roof repair contractor',
          group: 'Waiting for approval',
          by: 'grace',
          values: {
            work: 'Replace roof lights above cell 3. Work at height.',
            owner: n('grace'),
            status: 'Not approved yet',
          },
        },
      ],
    },
    {
      sheet: 'Emergency drills',
      items: [
        {
          name: 'Fire evacuation, Leeds day shift',
          group: 'Held',
          by: 'grace',
          values: {
            scenario: 'Fire evacuation',
            planned_on: c.day(-58),
            held_on: c.day(-58),
            owner: n('grace'),
            participants: 96,
            target_minutes: 4,
            actual_minutes: 3.5,
            findings: 'Everyone out in 3.5 minutes. One fire door wedged open in stores.',
            status: 'Closed',
          },
        },
        {
          name: 'Fire evacuation, Leeds night shift',
          group: 'Planned',
          by: 'grace',
          values: {
            scenario: 'Fire evacuation',
            planned_on: c.day(19),
            owner: n('grace'),
            target_minutes: 4,
            status: 'Planned',
          },
        },
      ],
    },
    {
      sheet: 'Health surveillance',
      items: [
        health('Audiometry, saw and compressor area team', ['Noise'], -300, 65, 'Up to date'),
        health(
          'Skin checks, turning cells (coolant)',
          ['Chemicals or solvents'],
          -380,
          -15,
          'Overdue',
        ),
        health(
          'Hand-arm vibration, deburring cell',
          ['Hand-arm vibration'],
          -120,
          245,
          'Up to date',
        ),
      ],
    },
  ];

  function aspect(
    name: string,
    activity: string,
    aspectText: string,
    impact: string,
    severity: number,
    frequency: number,
    significance: string,
  ) {
    return {
      name,
      group: significance === 'Not assessed' ? 'Identified' : 'Assessed',
      by: 'grace' as const,
      values: {
        activity,
        aspect: aspectText,
        impact,
        condition: 'Normal',
        life_cycle:
          activity === 'Logistics'
            ? 'Transport'
            : activity === 'Finishing'
              ? 'Materials and purchasing'
              : 'Our operations',
        severity,
        frequency,
        significance,
        owner: n('grace'),
        status: significance === 'Not assessed' ? 'Identified' : 'Under review',
        review_date: c.day(90),
      },
      links: { clauses: [env26('6.1.2')] },
    };
  }

  function hazard(
    name: string,
    location: string,
    type: string,
    likelihood: number,
    severity: number,
    status: string,
    controls: string,
    rl: number | null,
    rs: number | null,
  ) {
    const accepted = status === 'Accepted';
    return {
      name,
      group: accepted ? 'Accepted' : 'Being assessed',
      by: 'grace' as const,
      values: {
        task: name,
        location,
        hazard: name,
        hazard_type: type,
        exposed: ['Employees'],
        routine: 'Routine work',
        likelihood,
        severity,
        hierarchy: controls ? '3 Engineering controls' : undefined,
        controls: controls || undefined,
        residual_likelihood: rl ?? undefined,
        residual_severity: rs ?? undefined,
        consulted: true,
        owner: n('grace'),
        status: accepted ? 'Being assessed' : status,
        review_date: c.day(120),
      },
      links: { clauses: [ohs('6.1.2')] },
      steps: accepted ? [{ by: 'grace' as const, values: { status: 'Accepted' } }] : undefined,
    };
  }

  function health(name: string, exposure: string[], last: number, next: number, status: string) {
    return {
      name,
      group: 'Current',
      by: 'grace' as const,
      values: {
        exposure,
        provider: 'Occupational health provider (contract)',
        last_check: c.day(last),
        next_check: c.day(next),
        fitness: 'Fit for the work',
        owner: n('grace'),
        status,
      },
    };
  }
}

function monthLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
