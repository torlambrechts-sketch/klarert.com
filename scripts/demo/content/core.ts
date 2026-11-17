// The shared registers (Core) of Meridian Components Ltd: context, documents, objectives, legal register, training,
// internal audits, risks and opportunities, assets, incidents, nonconformities and CAPA, actions and suppliers.
// Fictional throughout. Dates come from the demo clock, so the workspace looks current whenever it is seeded.
import type { DemoClock } from '../clock';
import { nameOf as n } from '../people';
import { env26, gdpr, isms, item, ohs, q15, type DemoSheet } from './types';

export function coreContent(c: DemoClock): DemoSheet[] {
  return [
    {
      sheet: 'Context and interested parties',
      items: [
        {
          name: 'Aerospace and medical customers tightening supplier quality terms',
          group: 'External issues',
          by: 'priya',
          values: {
            kind: 'External issue',
            details:
              'Two of our five largest customers asked for first-article inspection reports and full material traceability on every batch from next year.',
            relevant: true,
            owner: n('priya'),
            status: 'Agreed',
            review_date: c.day(120),
            standards: ['ISO 9001'],
          },
          links: { requirements: [q15('4.1')] },
        },
        {
          name: 'Skills shortage for CNC setters in West Yorkshire',
          group: 'External issues',
          by: 'hannah',
          values: {
            kind: 'External issue',
            details:
              'Three setter vacancies were open for more than four months last year. Overtime covers the gap but raises the risk of set-up errors.',
            relevant: true,
            owner: n('hannah'),
            status: 'Agreed',
            review_date: c.day(64),
            standards: ['ISO 9001', 'ISO 45001'],
          },
        },
        {
          name: 'Energy prices and the customer push for lower-carbon parts',
          group: 'External issues',
          by: 'grace',
          values: {
            kind: 'External issue',
            details:
              'Electricity is our second largest cost after materials. Customers now ask for a carbon figure per part in tenders.',
            relevant: true,
            owner: n('grace'),
            status: 'In review',
            review_date: c.day(21),
            standards: ['ISO 14001'],
          },
        },
        {
          name: 'Move from paper job cards to the ERP shop-floor module',
          group: 'Internal issues',
          by: 'ellie',
          values: {
            kind: 'Internal issue',
            details:
              'Leeds moves to electronic job cards in the next two quarters; Tilburg follows. Training and data migration are the main risks.',
            relevant: true,
            owner: n('ellie'),
            status: 'Agreed',
            review_date: c.day(45),
            standards: ['ISO 9001', 'ISO 27001'],
          },
        },
        {
          name: 'Customers',
          group: 'Interested parties',
          by: 'priya',
          values: {
            kind: 'Interested party',
            details: 'OEMs in pumps, hydraulics, medical devices and aerospace sub-assemblies.',
            needs:
              'Parts to drawing, on time, with certificates of conformity, material certificates and traceability to the bar.',
            relevant: true,
            owner: n('priya'),
            status: 'Agreed',
            review_date: c.day(150),
            standards: ['ISO 9001'],
          },
          links: { requirements: [q15('4.2')] },
        },
        {
          name: 'Employees and the works council in Tilburg',
          group: 'Interested parties',
          by: 'grace',
          values: {
            kind: 'Interested party',
            needs:
              'Safe machines, clear instructions, training on the new ERP screens, and a say in shift patterns.',
            relevant: true,
            owner: n('grace'),
            status: 'Agreed',
            review_date: c.day(98),
            standards: ['ISO 45001', 'ISO 9001'],
          },
        },
        {
          name: 'Environment Agency and the local council',
          group: 'Interested parties',
          by: 'grace',
          values: {
            kind: 'Interested party',
            needs:
              'Trade effluent within consent limits, waste carried by registered carriers, no noise complaints from neighbours.',
            relevant: true,
            owner: n('grace'),
            status: 'Agreed',
            review_date: c.day(200),
            standards: ['ISO 14001'],
          },
        },
        {
          name: 'Scope of the management system',
          group: 'Scope',
          by: 'hannah',
          values: {
            kind: 'Scope',
            details:
              'Contract machining, finishing and assembly of precision metal components at Leeds (UK) and Tilburg (NL), from quotation to delivery. Design and development is excluded: we make parts to customer drawings.',
            relevant: true,
            owner: n('hannah'),
            status: 'Agreed',
            review_date: c.day(240),
            standards: ['All standards'],
          },
          links: { requirements: [q15('4.3')] },
        },
      ],
    },
    {
      sheet: 'Documents and policies',
      items: [
        doc('QP-001 Quality policy', 'Approved', {
          document_id: 'QP-001',
          doc_type: 'Policy',
          owner: n('hannah'),
          approver: n('hannah'),
          version: 4,
          approved_on: c.day(-140),
          next_review: c.day(225),
          standards: ['ISO 9001'],
        }),
        doc('ISP-001 Information security policy', 'Approved', {
          document_id: 'ISP-001',
          doc_type: 'Policy',
          owner: n('daniel'),
          approver: n('hannah'),
          version: 3,
          approved_on: c.day(-95),
          next_review: c.day(270),
          standards: ['ISO 27001', 'NIS2'],
        }),
        doc('HSE-001 Health, safety and environment policy', 'Approved', {
          document_id: 'HSE-001',
          doc_type: 'Policy',
          owner: n('grace'),
          approver: n('hannah'),
          version: 5,
          approved_on: c.day(-300),
          next_review: c.day(18),
          standards: ['ISO 14001', 'ISO 45001'],
        }),
        doc('PR-007 Control of nonconforming product', 'Approved', {
          document_id: 'PR-007',
          doc_type: 'Procedure',
          owner: n('priya'),
          approver: n('hannah'),
          version: 6,
          approved_on: c.day(-210),
          next_review: c.day(155),
          standards: ['ISO 9001'],
        }),
        doc('PR-012 Calibration of measuring equipment', 'Approved', {
          document_id: 'PR-012',
          doc_type: 'Procedure',
          owner: n('priya'),
          approver: n('ellie'),
          version: 3,
          approved_on: c.day(-380),
          next_review: c.day(-15),
          standards: ['ISO 9001'],
        }),
        doc('PR-015 Supplier evaluation and approval', 'Approved', {
          document_id: 'PR-015',
          doc_type: 'Procedure',
          owner: n('marcus'),
          approver: n('priya'),
          version: 2,
          approved_on: c.day(-160),
          next_review: c.day(205),
          standards: ['ISO 9001'],
        }),
        doc('WI-031 First-article inspection on the CMM', 'Approved', {
          document_id: 'WI-031',
          doc_type: 'Work instruction',
          owner: n('ellie'),
          approver: n('priya'),
          version: 2,
          approved_on: c.day(-60),
          next_review: c.day(305),
          standards: ['ISO 9001'],
        }),
        doc('PR-021 Access control and joiners, movers and leavers', 'Approved', {
          document_id: 'PR-021',
          doc_type: 'Procedure',
          owner: n('daniel'),
          approver: n('hannah'),
          version: 2,
          approved_on: c.day(-120),
          next_review: c.day(245),
          standards: ['ISO 27001'],
        }),
        doc('PR-024 Incident response plan', 'Approved', {
          document_id: 'PR-024',
          doc_type: 'Plan',
          owner: n('daniel'),
          approver: n('hannah'),
          version: 2,
          approved_on: c.day(-75),
          next_review: c.day(290),
          standards: ['ISO 27001', 'NIS2'],
        }),
        // approvals in progress (submitted through the Document approval workflow by the build)
        {
          name: 'PR-008 Corrective action procedure, 2026 edition update',
          group: 'Draft',
          by: 'priya',
          values: {
            document_id: 'PR-008',
            doc_type: 'Procedure',
            owner: n('priya'),
            approve_by: n('hannah'),
            version: 5,
            next_review: c.day(365),
            standards: ['ISO 9001'],
          },
          files: [docFile('PR-008 Corrective action procedure, 2026 edition update', 1)],
          approval: { workflow: 'document-approval', by: 'priya' },
          comments: [
            {
              by: 'priya',
              body: 'Rewritten for ISO 9001:2026: risk-based action, and an effectiveness check before closing.',
            },
          ],
        },
        {
          name: 'WI-044 Deburring and edge finishing, cell 3',
          group: 'Draft',
          by: 'ellie',
          values: {
            document_id: 'WI-044',
            doc_type: 'Work instruction',
            owner: n('ellie'),
            approve_by: n('priya'),
            version: 1,
            next_review: c.day(365),
            standards: ['ISO 9001', 'ISO 45001'],
          },
          files: [docFile('WI-044 Deburring and edge finishing, cell 3', 1)],
          approval: { workflow: 'document-approval', by: 'ellie' },
        },
        {
          name: 'PR-030 Supplier security requirements',
          group: 'Draft',
          by: 'daniel',
          values: {
            document_id: 'PR-030',
            doc_type: 'Procedure',
            owner: n('daniel'),
            approve_by: n('hannah'),
            version: 1,
            next_review: c.day(365),
            standards: ['ISO 27001', 'NIS2'],
          },
          files: [docFile('PR-030 Supplier security requirements', 1)],
          approval: {
            workflow: 'document-approval',
            by: 'daniel',
            decisions: [
              {
                by: 'hannah',
                decision: 'rejected',
                comment:
                  'Add the cloud providers to the scope and say who checks the evidence each year.',
              },
            ],
          },
        },
        {
          name: 'Environmental aspects procedure (draft)',
          group: 'Draft',
          by: 'grace',
          values: {
            document_id: 'PR-040',
            doc_type: 'Procedure',
            owner: n('grace'),
            version: 1,
            standards: ['ISO 14001'],
          },
        },
        {
          name: 'QM-001 Quality manual (2019)',
          group: 'Obsolete',
          by: 'priya',
          values: {
            document_id: 'QM-001',
            doc_type: 'Plan',
            owner: n('priya'),
            version: 7,
            status: 'Obsolete',
            standards: ['ISO 9001'],
          },
        },
      ],
    },
    {
      sheet: 'Objectives and KPIs',
      items: [
        {
          name: 'On-time delivery at or above 96%',
          group: 'Active',
          by: 'priya',
          values: {
            owner: n('ellie'),
            kpi: 'Order lines delivered on or before the confirmed date',
            target: '96%',
            result: '91.8%',
            status: 'At risk',
            due: c.month(1, 31),
            review_date: c.day(9),
            standards: ['ISO 9001'],
          },
          links: { iso9001_clauses: [q15('6.2')] },
          // a monthly figure, entered by the owner: the KPI's history in the activity log
          steps: [
            { by: 'ellie', values: { result: '92.6%' } },
            { by: 'ellie', values: { result: '93.4%' } },
            { by: 'ellie', values: { result: '94.9%', status: 'On track' } },
            { by: 'ellie', values: { result: '95.2%' } },
            { by: 'ellie', values: { result: '93.7%', status: 'At risk' } },
          ],
          comments: [
            {
              by: 'ellie',
              body: 'Last month dipped to 93.7%: two late bar deliveries from Brackwell held up the pump shafts.',
            },
          ],
        },
        {
          name: 'Customer ppm below 450',
          group: 'Active',
          by: 'priya',
          values: {
            owner: n('priya'),
            kpi: 'Parts rejected by customers per million delivered, rolling 12 months',
            target: '< 450 ppm',
            result: '610 ppm',
            status: 'Off track',
            due: c.month(3, 31),
            review_date: c.day(-3),
            standards: ['ISO 9001'],
          },
          steps: [
            { by: 'priya', values: { result: '590 ppm' } },
            { by: 'priya', values: { result: '540 ppm', status: 'At risk' } },
            { by: 'priya', values: { result: '520 ppm' } },
            { by: 'priya', values: { result: '575 ppm', status: 'Off track' } },
          ],
        },
        {
          name: 'Scrap cost below 1.8% of sales',
          group: 'Active',
          by: 'ellie',
          values: {
            owner: n('ellie'),
            kpi: 'Scrap and rework cost as a share of sales',
            target: '1.8%',
            result: '2.1%',
            status: 'On track',
            due: c.month(5, 30),
            review_date: c.day(25),
            standards: ['ISO 9001'],
          },
          steps: [
            { by: 'ellie', values: { result: '2.4%' } },
            { by: 'ellie', values: { result: '2.2%' } },
            { by: 'ellie', values: { result: '1.9%' } },
          ],
        },
        {
          name: 'Electricity per machine hour down 8%',
          group: 'Active',
          by: 'grace',
          values: {
            owner: n('grace'),
            kpi: 'kWh per spindle hour against last year',
            target: '-8%',
            result: '-5.5%',
            status: 'On track',
            due: c.month(7, 31),
            review_date: c.day(40),
            standards: ['ISO 14001'],
            iso14001_baseline: '6.4 kWh per spindle hour (last year)',
          },
        },
        {
          name: 'Phishing test click rate under 5%',
          group: 'Active',
          by: 'daniel',
          values: {
            owner: n('daniel'),
            kpi: 'Share of staff who click the quarterly test email',
            target: '< 5%',
            result: '7%',
            status: 'At risk',
            due: c.month(2, 28),
            review_date: c.day(12),
            standards: ['ISO 27001'],
          },
          steps: [
            { by: 'daniel', values: { result: '11%' } },
            { by: 'daniel', values: { result: '7%' } },
          ],
        },
        {
          name: 'Zero lost-time injuries',
          group: 'Achieved',
          by: 'grace',
          values: {
            owner: n('grace'),
            kpi: 'Injuries with time off work, calendar year',
            target: '0',
            result: '0 for 412 days',
            status: 'Achieved',
            due: c.day(-48),
            standards: ['ISO 45001'],
          },
        },
      ],
    },
    {
      sheet: 'Legal register',
      items: [
        legal(
          'UK GDPR and the Data Protection Act 2018',
          'National',
          'tomasz',
          'Compliant',
          -70,
          295,
        ),
        legal(
          'EU GDPR (Tilburg site and EU customers)',
          'European Union',
          'tomasz',
          'Compliant',
          -70,
          295,
        ),
        legal(
          'Health and Safety at Work etc. Act 1974',
          'National',
          'grace',
          'Compliant',
          -110,
          255,
        ),
        legal(
          'PUWER 1998: provision and use of work equipment',
          'National',
          'grace',
          'Partly compliant',
          -40,
          50,
        ),
        legal(
          'COSHH 2002: cutting fluids and degreasers',
          'National',
          'grace',
          'Compliant',
          -150,
          215,
        ),
        legal(
          'Trade effluent consent, Leeds site',
          'Local or regional',
          'grace',
          'Compliant',
          -30,
          335,
        ),
        legal(
          'Waste duty of care and waste carrier checks',
          'National',
          'grace',
          'Compliant',
          -200,
          -12,
        ),
        legal(
          'NIS2 transposition in the Netherlands (Cyberbeveiligingswet)',
          'European Union',
          'daniel',
          'Not evaluated',
          null,
          30,
        ),
        legal(
          'REACH and RoHS declarations for supplied parts',
          'European Union',
          'priya',
          'Compliant',
          -90,
          275,
        ),
        legal(
          'Customer contract: Kestrelmoor Pumps quality agreement',
          'Contract or customer',
          'priya',
          'Compliant',
          -55,
          310,
        ),
      ].map((l) => ({
        ...l,
        values: {
          ...l.values,
          last_evaluated:
            l.values.last_evaluated === null ? undefined : c.day(l.values.last_evaluated as number),
          next_evaluation: c.day(l.values.next_evaluation as number),
        },
      })),
    },
    {
      sheet: 'Competence and training',
      items: [
        training('ellie', 'CMM programming (Level 2)', 'Valid', -210, 520),
        training('ellie', 'Internal auditor, ISO 9001', 'Valid', -400, 330),
        training('priya', 'Lead auditor, ISO 9001:2015', 'Valid', -480, 400),
        training('priya', 'ISO 9001:2026 transition briefing', 'Planned', null, null, 14),
        training('daniel', 'ISO/IEC 27001 lead implementer', 'Valid', -320, 410),
        training('daniel', 'Incident handling for NIS2 reporting', 'Valid', -60, 670),
        training('grace', 'NEBOSH General Certificate', 'Valid', -500, null),
        training('grace', 'First aid at work', 'Expiring', -520, 25),
        training('marcus', 'Supplier auditing basics', 'Valid', -180, 550),
        training('tomasz', 'Certified data protection officer', 'Valid', -500, 230),
        training(
          'hannah',
          'Cyber security for directors (NIS2 Art. 20)',
          'Valid',
          -95,
          635,
          undefined,
          true,
        ),
        training('marcus', 'Forklift operator refresher', 'Expired', -530, -35),
        training('ellie', 'Abrasive wheel mounting', 'Expiring', -525, 12),
      ],
    },
    {
      sheet: 'Internal audits',
      items: [
        {
          name: 'IA-2025-03 Purchasing and supplier control',
          group: 'Completed',
          by: 'priya',
          values: {
            lead: n('priya'),
            scope: 'PR-015, approved supplier list, incoming inspection at Leeds.',
            start: c.month(-14, 10),
            end: c.month(-14, 11),
            status: 'Closed',
            findings: 2,
            standards: ['All standards'],
          },
          links: { requirements: [q15('8.4')] },
        },
        {
          name: 'IA-2026-01 Production and release, Leeds',
          group: 'Completed',
          by: 'priya',
          values: {
            lead: n('ellie'),
            scope:
              'Turning and milling cells, first-article inspection, final release and certificates of conformity.',
            start: c.month(-8, 3),
            end: c.month(-8, 5),
            status: 'Closed',
            findings: 3,
            standards: ['All standards'],
          },
          links: { requirements: [q15('8.5'), q15('8.6')] },
        },
        {
          name: 'IA-2026-02 Access control and IT operations',
          group: 'Completed',
          by: 'daniel',
          values: {
            lead: n('priya'),
            scope: 'Joiners, movers and leavers; privileged accounts; backups and restore tests.',
            start: c.month(-5, 14),
            end: c.month(-5, 15),
            status: 'Reported',
            findings: 2,
            standards: ['ISO 27001'],
          },
          links: {
            iso27001_in_scope: [isms('A.5.15'), isms('A.5.18'), isms('A.8.2'), isms('A.8.13')],
          },
        },
        {
          name: 'IA-2026-03 Calibration, measurement and nonconforming product',
          group: 'In progress',
          by: 'priya',
          values: {
            lead: n('priya'),
            scope: 'PR-012 and PR-007 at Leeds and Tilburg; the gauge room; the quarantine cage.',
            start: c.day(-6),
            end: c.day(3),
            status: 'In progress',
            findings: 2,
            standards: ['All standards'],
          },
          links: { requirements: [q15('7.1.5'), q15('8.7')] },
          comments: [
            {
              by: 'priya',
              body: 'Day one at Leeds done. Two findings so far: a gauge out of date in cell 2 and a quarantine label missing. Tilburg on Thursday.',
            },
          ],
        },
        {
          name: 'IA-2026-04 Environmental compliance and waste',
          group: 'Planned',
          by: 'grace',
          values: {
            lead: n('grace'),
            scope: 'Trade effluent sampling, waste transfer notes, spill kits.',
            start: c.day(24),
            end: c.day(25),
            status: 'Planned',
            standards: ['All standards'],
          },
        },
        {
          name: 'IA-2026-05 Supplier security and cloud services',
          group: 'Planned',
          by: 'daniel',
          values: {
            lead: n('priya'),
            scope: 'Supplier security clauses, the ERP provider, cloud backups.',
            start: c.day(52),
            end: c.day(52),
            status: 'Planned',
            standards: ['ISO 27001'],
          },
        },
      ],
    },
    {
      sheet: 'Risk register',
      items: [
        risk(
          'Key bar supplier fails to deliver',
          'Being treated',
          {
            owner: n('marcus'),
            cause: 'Single approved source for 316 stainless bar',
            consequence: 'Pump-shaft orders late by two to four weeks',
            likelihood: 3,
            impact: 4,
            treatment: 'Reduce',
            review_date: c.day(20),
            standards: ['ISO 9001'],
            iso9001_effective: 'Second source being approved; safety stock raised to six weeks.',
          },
          { iso9001_clauses: [q15('6.1'), q15('8.4')] },
        ),
        risk(
          'Set-up errors on night shift',
          'Being treated',
          {
            owner: n('ellie'),
            cause: 'Fewer experienced setters on nights',
            consequence: 'Batch scrap and customer escapes',
            likelihood: 3,
            impact: 3,
            treatment: 'Reduce',
            review_date: c.day(-4),
            standards: ['ISO 9001', 'ISO 45001'],
          },
          { iso9001_clauses: [q15('6.1')] },
        ),
        risk(
          'Gauge used past its calibration date',
          'Accepted',
          {
            owner: n('priya'),
            cause: 'Gauges move between cells and the due date is not checked',
            consequence: 'Parts released on an unverified measurement',
            likelihood: 2,
            impact: 3,
            treatment: 'Reduce',
            review_date: c.day(160),
            residual_likelihood: 1,
            residual_impact: 3,
            standards: ['ISO 9001'],
            iso9001_effective:
              'Colour-coded tags and the 30-day reminder; no expired gauge found in the last two audits.',
          },
          { iso9001_clauses: [q15('6.1'), q15('7.1.5')] },
          'Residual risk accepted by the quality manager after the tag scheme.',
        ),
        risk('Opportunity: win medical-device work with ISO 13485 later', 'Identified', {
          owner: n('hannah'),
          cause: 'Two medical customers asked about it',
          consequence: 'New sales of about GBP 1.2m a year',
          likelihood: 3,
          impact: 4,
          treatment: 'Pursue (opportunity)',
          review_date: c.day(75),
          standards: ['ISO 9001'],
        }),
        risk(
          'Ransomware stops the ERP and the CNC programs',
          'Being treated',
          {
            owner: n('daniel'),
            cause: 'Phishing, unpatched remote access',
            consequence: 'Production stopped for days; data lost',
            likelihood: 3,
            impact: 5,
            treatment: 'Reduce',
            review_date: c.day(14),
            standards: ['ISO 27001', 'NIS2'],
            iso27001_asset: 'ERP, CNC program server',
            iso27001_threat: 'Ransomware',
            iso27001_vulnerability: 'Shared admin account on the program server',
            iso27001_cia: ['Availability', 'Integrity'],
          },
          { iso27001_controls: [isms('A.8.7'), isms('A.8.13'), isms('A.8.8')] },
        ),
        risk(
          'Customer drawings shared by personal email',
          'Identified',
          {
            owner: n('daniel'),
            cause: 'Large files and no shared transfer tool',
            consequence: 'Customer IP disclosed; contract breach',
            likelihood: 3,
            impact: 3,
            treatment: 'Reduce',
            review_date: c.day(30),
            standards: ['ISO 27001'],
            iso27001_cia: ['Confidentiality'],
          },
          { iso27001_controls: [isms('A.5.14')] },
        ),
        risk(
          'Coolant mist exposure in the turning cells',
          'Being treated',
          {
            owner: n('grace'),
            cause: 'Older machines without mist extraction',
            consequence: 'Respiratory ill health',
            likelihood: 2,
            impact: 4,
            treatment: 'Reduce',
            review_date: c.day(33),
            standards: ['ISO 45001'],
          },
          { iso45001_clauses: [ohs('6.1.2')] },
        ),
        risk(
          'Effluent consent breach after a coolant spill',
          'Accepted',
          {
            owner: n('grace'),
            cause: 'Bulk coolant delivered next to a drain',
            consequence: 'Fine and a consent review',
            likelihood: 1,
            impact: 4,
            treatment: 'Reduce',
            review_date: c.day(190),
            standards: ['ISO 14001'],
          },
          { iso14001_clauses: [env26('6.1.4')] },
          'Drain covers and the bunded delivery bay are in place; residual risk accepted.',
        ),
        risk('Payroll data sent to the wrong address', 'Identified', {
          owner: n('tomasz'),
          cause: 'Manual payslip emails in Tilburg',
          consequence: 'Personal data breach, staff trust',
          likelihood: 2,
          impact: 3,
          treatment: 'Reduce',
          review_date: c.day(50),
          standards: ['GDPR'],
        }),
      ],
    },
    {
      sheet: 'Assets',
      items: [
        asset(
          'ERP (cloud)',
          'Systems and services',
          'System',
          'daniel',
          'Confidential',
          'Tallis ERP Cloud, EU region',
        ),
        asset(
          'CNC program server',
          'Systems and services',
          'System',
          'ellie',
          'Confidential',
          'Leeds server room',
        ),
        asset(
          'Microsoft 365 tenant',
          'Systems and services',
          'Service',
          'daniel',
          'Internal',
          'Cloud',
        ),
        asset('CMM, Leeds gauge room', 'Devices', 'Device', 'ellie', 'Internal', 'Leeds'),
        asset('Laptops (52)', 'Devices', 'Device', 'daniel', 'Internal', 'Both sites'),
        asset(
          'Customer drawings and specifications',
          'Information',
          'Information',
          'priya',
          'Restricted',
          'ERP and program server',
        ),
        asset(
          'HR and payroll records',
          'Information',
          'Information',
          'tomasz',
          'Restricted',
          'Payroll provider',
        ),
        asset('Leeds factory', 'Sites', 'Site', 'hannah', 'Internal', 'Leeds, UK'),
        asset('Tilburg assembly site', 'Sites', 'Site', 'hannah', 'Internal', 'Tilburg, NL'),
      ],
    },
    {
      sheet: 'Incidents',
      items: [
        {
          name: 'Hand laceration while changing an insert',
          group: 'Closed',
          by: 'grace',
          values: {
            what_happened:
              'Setter cut a finger on a new insert in cell 4. First aid given, back at work the same shift.',
            incident_type: 'Injury',
            occurred_on: c.day(-96),
            reported_by: 'Cell 4 team leader',
            severity: 'Low',
            owner: n('grace'),
            status: 'Closed',
            root_cause: 'Cut-resistant gloves not available at the cell.',
            standards: ['ISO 45001'],
            iso45001_outcome: 'First aid',
          },
        },
        {
          name: 'Phishing email led to one mailbox compromise',
          group: 'Closed',
          by: 'daniel',
          values: {
            what_happened:
              'A buyer entered their password on a fake sign-in page. The account sent 40 spam emails before it was locked.',
            incident_type: 'Security',
            occurred_on: c.day(-130),
            severity: 'Medium',
            owner: n('daniel'),
            status: 'Closed',
            root_cause: 'No phishing-resistant sign-in for purchasing staff.',
            standards: ['ISO 27001', 'NIS2'],
            nis2_significant: 'Not significant',
          },
        },
        {
          name: 'Coolant leak at the Tilburg goods-in bay',
          group: 'Open',
          by: 'grace',
          values: {
            what_happened:
              'About 20 litres of coolant concentrate leaked from a damaged IBC. Contained with a spill kit.',
            incident_type: 'Environmental',
            occurred_on: c.day(-9),
            severity: 'Medium',
            owner: n('grace'),
            status: 'Action set',
            standards: ['ISO 14001'],
            iso14001_released: 'About 20 l coolant concentrate, none to drain',
          },
        },
        {
          name: 'Batch of manifold blocks shipped without final inspection record',
          group: 'Open',
          by: 'priya',
          values: {
            what_happened:
              'Customer found the CoC but no inspection record for batch 2611. Parts measured good on return.',
            incident_type: 'Quality',
            occurred_on: c.day(-17),
            severity: 'Medium',
            owner: n('priya'),
            status: 'Investigating',
            standards: ['All standards'],
          },
        },
        {
          name: 'Near miss: forklift reversing near the saw',
          group: 'Open',
          by: 'grace',
          values: {
            what_happened: 'A forklift reversed into the walkway beside the bandsaw. Nobody hurt.',
            incident_type: 'Near miss',
            occurred_on: c.day(-3),
            severity: 'High',
            owner: n('grace'),
            status: 'New',
            standards: ['ISO 45001'],
            iso45001_outcome: 'No harm (near miss)',
          },
        },
      ],
    },
    {
      sheet: 'Actions',
      items: [
        action(
          'Approve a second source for 316 stainless bar',
          'marcus',
          'Working on it',
          21,
          'Risk: key bar supplier',
        ),
        action(
          'Fit mist extraction on lathes 2 and 5',
          'grace',
          'Working on it',
          40,
          'Risk: coolant mist',
        ),
        action(
          'Re-train night-shift setters on the set-up checklist',
          'ellie',
          'Done',
          -20,
          'NC-2026-014',
        ),
        action(
          'Add the inspection record to the CoC pack check',
          'priya',
          'Working on it',
          -2,
          'NC-2026-019',
        ),
        action('Replace worn collet chuck on lathe 4', 'ellie', 'Done', -40, 'NC-2026-011'),
        action(
          'Roll out phishing-resistant sign-in to purchasing',
          'daniel',
          'Done',
          -60,
          'Incident: phishing',
        ),
        action(
          'Move the bulk coolant delivery to the bunded bay',
          'grace',
          'Not started',
          10,
          'Incident: coolant leak',
        ),
        action('Quarantine cage labels and a sign-out sheet', 'ellie', 'Stuck', -8, 'IA-2026-03'),
        action(
          'Update the approved supplier list after the Pennock audit',
          'marcus',
          'Not started',
          18,
          'Supplier review',
        ),
        action(
          'Mark walkways at the saw and add a banksman rule',
          'grace',
          'Not started',
          5,
          'Near miss: forklift',
        ),
      ],
    },
    {
      sheet: 'Nonconformities and CAPA',
      items: [
        {
          name: 'NC-2026-011 Bore oversize on pump shafts, batch 2544',
          group: 'Closed',
          by: 'ellie',
          values: {
            details:
              '38 of 400 shafts with the bore 0.02 mm over the upper limit. Found at final inspection.',
            found_on: c.day(-150),
            source: 'Process or product',
            grade: 'Minor',
            owner: n('ellie'),
            stage: 'Containment',
            due_date: c.day(-110),
            verifier: n('priya'),
            standards: ['ISO 9001'],
            iso9001_product: 'Pump shaft PS-220, batch 2544',
            iso9001_disposition: 'Scrapped',
            iso9001_correction: '38 shafts scrapped; the rest re-measured 100%.',
          },
          links: { iso9001_clauses: [q15('10.2'), q15('8.7')] },
          steps: [
            {
              by: 'ellie',
              values: {
                stage: 'Root cause',
                root_cause: 'Worn collet chuck on lathe 4 let the bar move under load.',
              },
            },
            { by: 'ellie', values: { stage: 'Action plan' } },
            { by: 'priya', values: { stage: 'Verification' } },
            { by: 'priya', values: { effective: true, stage: 'Closed' } },
          ],
        },
        {
          name: 'NC-2026-014 Wrong offset used after set-up, night shift',
          group: 'Closed',
          by: 'ellie',
          values: {
            details: 'Tool offset from the previous job left in. 60 brackets machined undersize.',
            found_on: c.day(-95),
            source: 'Process or product',
            grade: 'Minor',
            owner: n('ellie'),
            stage: 'Containment',
            due_date: c.day(-50),
            verifier: n('priya'),
            standards: ['ISO 9001'],
            iso9001_disposition: 'Scrapped',
          },
          links: { iso9001_clauses: [q15('10.2')] },
          steps: [
            {
              by: 'ellie',
              values: {
                stage: 'Root cause',
                root_cause: 'The set-up checklist did not ask for an offset reset.',
              },
            },
            { by: 'ellie', values: { stage: 'Action plan' } },
            { by: 'priya', values: { stage: 'Verification' } },
            { by: 'priya', values: { effective: true, stage: 'Closed' } },
          ],
        },
        {
          name: 'NC-2026-017 Supplier certificate missing for anodised housings',
          group: 'Open',
          by: 'marcus',
          values: {
            details:
              'Delivery from Pennock Anodising arrived without the coating thickness certificate.',
            found_on: c.day(-38),
            source: 'Supplier',
            grade: 'Minor',
            owner: n('marcus'),
            stage: 'Containment',
            due_date: c.day(6),
            verifier: n('priya'),
            standards: ['ISO 9001'],
            iso9001_disposition: 'Held or segregated',
          },
          links: { iso9001_clauses: [q15('8.4')] },
          steps: [{ by: 'marcus', values: { stage: 'Root cause' } }],
        },
        {
          name: 'NC-2026-019 Inspection record missing for manifold batch 2611',
          group: 'Open',
          by: 'priya',
          values: {
            details:
              'Customer complaint: CoC shipped without the final inspection record. Parts measured good on return.',
            found_on: c.day(-16),
            source: 'Complaint',
            grade: 'Major',
            owner: n('priya'),
            stage: 'Containment',
            due_date: c.day(-1),
            verifier: n('hannah'),
            standards: ['ISO 9001'],
            iso9001_product: 'Manifold block MB-40, batch 2611',
            iso9001_disposition: 'No output affected',
            iso9001_correction:
              'Record recreated from the CMM file and sent to the customer within 24 hours.',
          },
          links: { iso9001_clauses: [q15('8.6'), q15('10.2')] },
          steps: [
            {
              by: 'priya',
              values: {
                stage: 'Root cause',
                root_cause:
                  'The release check lists the CoC but not the inspection record; the packer did not know it was needed.',
              },
            },
            { by: 'priya', values: { stage: 'Action plan' } },
          ],
          comments: [
            {
              by: 'priya',
              body: 'Customer accepted the recreated record. Action plan agreed with Ellie; due end of next week.',
            },
            {
              by: 'hannah',
              body: 'Please bring the effectiveness check to the next management review.',
            },
          ],
        },
        {
          name: 'NC-2026-020 Gauge past its calibration date in cell 2',
          group: 'Open',
          by: 'priya',
          values: {
            details: 'Bore gauge BG-07 found in use 12 days past its due date during IA-2026-03.',
            found_on: c.day(-5),
            source: 'Internal audit',
            grade: 'Minor',
            owner: n('ellie'),
            stage: 'Containment',
            due_date: c.day(25),
            verifier: n('priya'),
            standards: ['ISO 9001'],
            iso9001_disposition: 'Held or segregated',
          },
          links: { iso9001_clauses: [q15('7.1.5')] },
        },
        {
          name: 'NC-2026-021 Quarantine cage label missing',
          group: 'Open',
          by: 'priya',
          values: {
            details: 'Two held batches in the cage had no hold label or reason.',
            found_on: c.day(-5),
            source: 'Internal audit',
            grade: 'Observation',
            owner: n('ellie'),
            stage: 'Containment',
            due_date: c.day(-1),
            standards: ['ISO 9001'],
          },
        },
        {
          name: 'NC-2026-016 Leaver account still active after six weeks',
          group: 'Open',
          by: 'daniel',
          values: {
            details:
              'IA-2026-02 found an active ERP account for a buyer who left six weeks earlier.',
            found_on: c.day(-150),
            source: 'Internal audit',
            grade: 'Minor',
            owner: n('daniel'),
            stage: 'Containment',
            due_date: c.day(-30),
            verifier: n('priya'),
            standards: ['ISO 27001'],
            iso27001_details: 'HR leaver notice did not reach IT.',
          },
          steps: [
            {
              by: 'daniel',
              values: {
                stage: 'Root cause',
                root_cause: 'The leaver form went to a shared mailbox nobody owned.',
              },
            },
            { by: 'daniel', values: { stage: 'Action plan' } },
            { by: 'daniel', values: { stage: 'Verification' } },
          ],
        },
        {
          name: 'NC-2026-018 Spill kit empty at the Tilburg goods-in bay',
          group: 'Open',
          by: 'grace',
          values: {
            details: 'Found during the coolant leak; the kit had been used and not refilled.',
            found_on: c.day(-9),
            source: 'Incident',
            grade: 'Minor',
            owner: n('grace'),
            stage: 'Action plan',
            due_date: c.day(12),
            standards: ['ISO 14001'],
          },
        },
      ],
    },
    {
      sheet: 'Suppliers',
      items: [
        supplier(
          'Brackwell Bar & Tube',
          'Stainless and alloy bar',
          'marcus',
          'Critical',
          'Approved',
          40,
          'Parts and materials',
        ),
        supplier(
          'Quenby Heat Treatment',
          'Hardening and stress relieving',
          'marcus',
          'High',
          'Approved',
          120,
          'Services',
        ),
        supplier(
          'Pennock Anodising',
          'Anodising and passivation',
          'marcus',
          'High',
          'Under review',
          10,
          'Services',
        ),
        supplier(
          'Lindqvar Tooling',
          'Inserts, drills and holders',
          'marcus',
          'Medium',
          'Approved',
          210,
          'Parts and materials',
        ),
        supplier(
          'Calverley Calibration Services',
          'UKAS-accredited calibration',
          'priya',
          'High',
          'Approved',
          150,
          'Services',
        ),
        supplier(
          'Fernmoor Logistics',
          'Pallet transport UK and EU',
          'marcus',
          'Medium',
          'Approved',
          -20,
          'Services',
        ),
        supplier(
          'Tallis ERP Cloud',
          'ERP software as a service',
          'daniel',
          'Critical',
          'Approved',
          95,
          'IT and cloud',
        ),
        supplier(
          'Brightmesh IT Support',
          'Managed IT and backups',
          'daniel',
          'High',
          'Approved',
          60,
          'IT and cloud',
        ),
        supplier(
          'Keelson Payroll Services',
          'Payroll, Tilburg',
          'tomasz',
          'Medium',
          'Approved',
          180,
          'Services',
          true,
        ),
        supplier(
          'Osgrove Castings',
          'Aluminium castings (new source)',
          'marcus',
          'High',
          'New',
          30,
          'Parts and materials',
        ),
      ],
    },
  ];

  function doc(name: string, status: string, values: Record<string, unknown>) {
    const group = status === 'Approved' ? 'Approved' : status === 'Obsolete' ? 'Obsolete' : 'Draft';
    return {
      name,
      group,
      by: 'priya' as const,
      values: { ...values },
      files: [docFile(name, values.version as number)],
      steps: [
        {
          by: 'hannah' as const,
          values: { status },
          note:
            status === 'Approved'
              ? 'Reviewed and approved for issue.'
              : 'Replaced; kept for the record.',
        },
      ],
    };
  }

  function docFile(name: string, version: number) {
    const id = name.split(' ')[0]!;
    return {
      field: null,
      name: `${id}-v${version}.pdf`,
      lines: [name, `Version ${version}`, 'Controlled copy. Printed copies are uncontrolled.'],
    };
  }

  function legal(
    name: string,
    jurisdiction: string,
    owner: 'tomasz' | 'grace' | 'daniel' | 'priya',
    evaluation: string,
    last: number | null,
    next: number,
  ) {
    return {
      name,
      group: evaluation === 'Not evaluated' ? 'Under review' : 'Current',
      by: owner,
      values: {
        jurisdiction,
        owner: n(owner),
        evaluation,
        last_evaluated: last,
        next_evaluation: next,
        standards:
          owner === 'grace' ? ['ISO 14001'] : owner === 'daniel' ? ['ISO 27001'] : undefined,
      } as Record<string, unknown>,
    };
  }

  function training(
    who: 'ellie' | 'priya' | 'daniel' | 'grace' | 'marcus' | 'tomasz' | 'hannah',
    course: string,
    status: string,
    done: number | null,
    expires: number | null,
    plannedIn?: number,
    managementBody?: boolean,
  ) {
    const group = status === 'Planned' ? 'Planned' : status === 'Expired' ? 'Expired' : 'Valid';
    return {
      name: `${n(who)}: ${course}`,
      group,
      by: 'priya' as const,
      values: {
        person: n(who),
        competence: course,
        course,
        status,
        completed_on: done === null ? undefined : c.day(done),
        expires_on: expires === null ? (plannedIn ? c.day(plannedIn) : undefined) : c.day(expires),
        standards: managementBody ? ['NIS2'] : undefined,
        nis2_management_body: managementBody ? true : undefined,
      },
    };
  }

  function risk(
    name: string,
    status: string,
    values: Record<string, unknown>,
    links?: Record<string, string[]>,
    note?: string,
  ) {
    const group =
      status === 'Being treated'
        ? 'Being treated'
        : status === 'Accepted'
          ? 'Accepted'
          : 'Identified';
    const first =
      status === 'Accepted' ? 'Being treated' : status === 'Identified' ? 'Open' : status;
    return {
      name,
      group,
      by: (values.owner === n('daniel') ? 'daniel' : 'priya') as 'daniel' | 'priya',
      values: { ...values, status: first },
      links,
      steps:
        status === 'Accepted'
          ? [{ by: 'hannah' as const, values: { status: 'Accepted' }, note }]
          : undefined,
    };
  }

  function asset(
    name: string,
    group: string,
    type: string,
    owner: 'daniel' | 'ellie' | 'priya' | 'tomasz' | 'hannah',
    classification: string,
    location: string,
  ) {
    return {
      name,
      group,
      by: 'daniel' as const,
      values: {
        asset_type: type,
        owner: n(owner),
        classification,
        location,
        status: 'In use',
        review_date: c.day(120),
        standards: ['ISO 27001'],
      },
    };
  }

  function action(
    name: string,
    owner: 'marcus' | 'grace' | 'ellie' | 'priya' | 'daniel',
    status: string,
    due: number,
    origin: string,
  ) {
    return {
      name,
      group: status === 'Done' ? 'Done' : 'Open',
      by: owner,
      values: { owner: n(owner), status, due: c.day(due), origin },
    };
  }

  function supplier(
    name: string,
    supplies: string,
    owner: 'marcus' | 'priya' | 'daniel' | 'tomasz',
    criticality: string,
    status: string,
    reviewIn: number,
    category: string,
    personalData = false,
  ) {
    return {
      name,
      group: status === 'New' || status === 'Under review' ? 'Onboarding' : 'In use',
      by: owner,
      values: {
        supplies,
        owner: n(owner),
        criticality,
        status,
        next_review: c.day(reviewIn),
        standards: category === 'IT and cloud' ? ['GDPR'] : ['ISO 9001'],
        suppliermanagement_category: category,
        suppliermanagement_personal_data: personalData || category === 'IT and cloud',
      },
    };
  }
}

/** Items the build links after everything exists: the links between registers. */
export function coreLinks() {
  return [
    {
      from: item(
        'Nonconformities and CAPA',
        'NC-2026-011 Bore oversize on pump shafts, batch 2544',
      ),
      field: 'actions',
      to: [item('Actions', 'Replace worn collet chuck on lathe 4')],
    },
    {
      from: item(
        'Nonconformities and CAPA',
        'NC-2026-014 Wrong offset used after set-up, night shift',
      ),
      field: 'actions',
      to: [item('Actions', 'Re-train night-shift setters on the set-up checklist')],
    },
    {
      from: item(
        'Nonconformities and CAPA',
        'NC-2026-019 Inspection record missing for manifold batch 2611',
      ),
      field: 'actions',
      to: [item('Actions', 'Add the inspection record to the CoC pack check')],
    },
    {
      from: item(
        'Nonconformities and CAPA',
        'NC-2026-019 Inspection record missing for manifold batch 2611',
      ),
      field: 'incident',
      to: [item('Incidents', 'Batch of manifold blocks shipped without final inspection record')],
    },
    {
      from: item('Nonconformities and CAPA', 'NC-2026-021 Quarantine cage label missing'),
      field: 'actions',
      to: [item('Actions', 'Quarantine cage labels and a sign-out sheet')],
    },
    {
      from: item(
        'Nonconformities and CAPA',
        'NC-2026-018 Spill kit empty at the Tilburg goods-in bay',
      ),
      field: 'incident',
      to: [item('Incidents', 'Coolant leak at the Tilburg goods-in bay')],
    },
    {
      from: item(
        'Nonconformities and CAPA',
        'NC-2026-018 Spill kit empty at the Tilburg goods-in bay',
      ),
      field: 'actions',
      to: [item('Actions', 'Move the bulk coolant delivery to the bunded bay')],
    },
    {
      from: item(
        'Nonconformities and CAPA',
        'NC-2026-017 Supplier certificate missing for anodised housings',
      ),
      field: 'suppliermanagement_supplier',
      to: [item('Suppliers', 'Pennock Anodising')],
    },
    {
      from: item('Risk register', 'Key bar supplier fails to deliver'),
      field: 'suppliermanagement_supplier',
      to: [item('Suppliers', 'Brackwell Bar & Tube')],
    },
    {
      from: item('Risk register', 'Payroll data sent to the wrong address'),
      field: 'requirements',
      to: [gdpr('Art. 32')],
    },
  ];
}
