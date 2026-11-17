// GDPR and NIS2 at Meridian Components Ltd. The people named in requests are fictional and their records are marked
// as personal data (the pdmarker fields). Meridian's Tilburg company is checked against NIS2 as a medium-sized
// manufacturer of machinery parts (Annex II, manufacturing).
import type { DemoClock } from '../clock';
import { nameOf as n } from '../people';
import { gdpr, item, nis2, type DemoSheet } from './types';

export function privacyContent(c: DemoClock): DemoSheet[] {
  return [
    {
      sheet: 'Records of processing',
      items: [
        ropa(
          'Payroll and HR administration',
          ['Employees'],
          'Legal obligation',
          ['Identity', 'Contact details', 'Financial', 'Employment'],
          'Keelson Payroll Services; tax authorities',
          '7 years after leaving',
          'Approved',
        ),
        ropa(
          'Recruitment',
          ['Job applicants'],
          'Legitimate interests',
          ['Identity', 'Contact details', 'Employment'],
          'Recruitment agencies',
          '6 months after the decision',
          'Approved',
        ),
        ropa(
          'Customer contacts and orders',
          ['Business contacts', 'Customers'],
          'Contract',
          ['Identity', 'Contact details'],
          'Tallis ERP Cloud; Fernmoor Logistics',
          '6 years after the last order',
          'Approved',
        ),
        ropa(
          'CCTV at Leeds and Tilburg',
          ['Employees', 'Other'],
          'Legitimate interests',
          ['Images'],
          'Security company (Leeds)',
          '30 days',
          'In review',
        ),
        ropa(
          'Occupational health surveillance',
          ['Employees'],
          'Legal obligation',
          ['Health'],
          'Occupational health provider',
          '40 years (exposure records)',
          'Draft',
        ),
      ],
    },
    {
      sheet: 'Data subject requests',
      items: [
        {
          name: 'Access request from a former employee',
          group: 'Closed',
          by: 'tomasz',
          values: {
            request_type: 'Access',
            requester: 'Former employee (Leeds)',
            requester_email: 'former.employee@example.com',
            requester_details:
              'Fictional person. Asked for all HR records and CCTV of their last week.',
            received_on: c.day(-75),
            identity_verified: 'yes',
            verified_how: 'Matched the address on file',
            extension: 'No extension',
            owner: n('tomasz'),
            outcome: 'Done as asked',
            response:
              'HR file and payslips sent by secure link. CCTV already deleted after 30 days.',
            closed_on: c.day(-52),
            status: 'Closed',
          },
          links: { articles: [gdpr('Art. 15')] },
        },
        {
          name: 'Erasure request from a job applicant',
          group: 'Being handled',
          by: 'tomasz',
          values: {
            request_type: 'Erasure',
            requester: 'Job applicant, setter role',
            requester_email: 'applicant.setter@example.com',
            requester_details: 'Fictional person. Withdrew the application.',
            received_on: c.day(-11),
            identity_verified: 'yes',
            verified_how: 'Reply from the address used to apply',
            owner: n('tomasz'),
            status: 'In progress',
          },
          links: { articles: [gdpr('Art. 17')] },
        },
      ],
    },
    {
      sheet: 'Personal data breaches',
      items: [
        {
          name: 'Payslip emailed to the wrong employee, Tilburg',
          group: 'Closed',
          by: 'tomasz',
          values: {
            aware_at: c.at(-140, '09:20'),
            description:
              'One payslip sent to a colleague with a similar name. Recipient deleted it and confirmed in writing.',
            cause: 'Sent to the wrong person',
            data_categories: ['Financial'],
            subjects: ['Employees'],
            people_affected: 1,
            containment: 'Recipient confirmed deletion within two hours.',
            risk: 'Unlikely to result in a risk',
            risk_reasoning: 'One colleague, deleted at once, bound by confidentiality.',
            report_authority: 'no',
            tell_people: 'yes',
            people_told_on: c.day(-139),
            owner: n('tomasz'),
            dpo: n('tomasz'),
            lessons: 'Payslips now go through the payroll portal, not email.',
            status: 'Closed',
          },
          links: { articles: [gdpr('Art. 33')] },
        },
      ],
    },
    {
      sheet: 'DPIAs',
      items: [
        {
          name: 'CCTV upgrade with remote viewing',
          group: 'In progress',
          by: 'tomasz',
          values: {
            why_required: ['Systematic monitoring'],
            description: 'New cameras at both sites with remote viewing by the security company.',
            owner: n('tomasz'),
            next_review: c.day(30),
            status: 'With the DPO',
          },
          links: {
            processing: [item('Records of processing', 'CCTV at Leeds and Tilburg')],
            articles: [gdpr('Art. 35')],
          },
        },
      ],
    },
    {
      sheet: 'Processors and DPAs',
      items: [
        processor('Tallis ERP Cloud', 'ERP hosting and support', -400, false, 'Tallis ERP Cloud'),
        processor(
          'Keelson Payroll Services',
          'Payroll processing (Tilburg)',
          -300,
          false,
          'Keelson Payroll Services',
        ),
        processor(
          'Brightmesh IT Support',
          'Managed IT, backups, service desk',
          -220,
          false,
          'Brightmesh IT Support',
        ),
      ],
    },
    {
      sheet: 'Retention schedule',
      items: [
        retention(
          'Payroll records',
          '7 years',
          'End of employment',
          'Payroll and HR administration',
        ),
        retention('Applicant files', '6 months', 'Date of the hiring decision', 'Recruitment'),
        retention('CCTV recordings', '30 days', 'Recording date', 'CCTV at Leeds and Tilburg'),
      ],
    },
    {
      sheet: 'NIS2 scope and registration',
      items: [
        {
          name: 'Meridian Components B.V. (Tilburg)',
          group: 'In scope',
          by: 'daniel',
          values: {
            member_state: 'Netherlands',
            sector: 'Manufacturing',
            subsector: 'Manufacture of machinery and equipment (parts)',
            employees: 180,
            turnover: 31,
            balance: 22,
            classification: 'Important entity',
            reasoning:
              'Group headcount 180 and turnover EUR 31m make it a medium-sized enterprise; manufacturing of machinery is in Annex II, so the Dutch company is an important entity.',
            registration: 'Not registered',
            owner: n('daniel'),
            next_review: c.day(90),
          },
          links: { articles: [nis2('Art. 2(1)'), nis2('Art. 3(2)')] },
        },
      ],
    },
    {
      sheet: 'NIS2 management body decisions',
      items: [
        {
          name: 'Approve the cyber security measures for Tilburg',
          group: 'To decide',
          by: 'daniel',
          values: {
            decision_type: 'Approve the risk-management measures',
            summary:
              'The board approves the controls marked NIS2 in the controls library and the plan for patching OT machines.',
            members: [n('hannah')],
            owner: n('daniel'),
            meeting_date: c.day(16),
            status: 'Draft',
          },
          links: { articles: [nis2('Art. 20(1)')] },
        },
        {
          name: 'Management body cyber training',
          group: 'Decided',
          by: 'daniel',
          values: {
            decision_type: 'Training of the management body',
            summary: 'Directors completed a half-day cyber security course for NIS2 Art. 20(2).',
            members: [n('hannah')],
            owner: n('daniel'),
            meeting_date: c.day(-95),
            status: 'Approved',
          },
          links: { articles: [nis2('Art. 20(2)')] },
        },
      ],
    },
  ];

  function ropa(
    name: string,
    subjects: string[],
    basis: string,
    categories: string[],
    recipients: string,
    retentionPeriod: string,
    status: string,
  ) {
    return {
      name,
      group: status === 'Approved' ? 'Active' : 'Being mapped',
      by: 'tomasz' as const,
      values: {
        role: 'Controller',
        purpose: name,
        lawful_basis: basis,
        subjects,
        data_categories: categories,
        recipients,
        retention_period: retentionPeriod,
        owner: n('tomasz'),
        next_review: c.day(150),
        status,
      },
      links: { articles: [gdpr('Art. 30')] },
    };
  }

  function processor(
    name: string,
    service: string,
    signed: number,
    outside: boolean,
    supplier: string,
  ) {
    return {
      name,
      group: 'Active',
      by: 'tomasz' as const,
      values: {
        service,
        dpa_signed_on: c.day(signed),
        dpa_covers: [
          'Only on our documented instructions',
          'Staff bound to confidentiality',
          'Security measures',
          'Sub-processors only with our approval',
          'Delete or return the data at the end',
        ],
        outside_eea: outside ? 'yes' : 'no',
        owner: n('tomasz'),
        next_review: c.day(signed + 365 > 0 ? signed + 365 : 20),
        status: 'Approved',
      },
      links: { core_supplier: [item('Suppliers', supplier)], articles: [gdpr('Art. 28')] },
    };
  }

  function retention(name: string, period: string, starts: string, processing: string) {
    return {
      name,
      group: 'In force',
      by: 'tomasz' as const,
      values: {
        period,
        starts,
        why: 'Legal and contractual limits, then deletion.',
        at_the_end: 'Erase the personal data',
        owner: n('tomasz'),
        next_review: c.day(200),
        status: 'Approved',
      },
      links: { processing: [item('Records of processing', processing)] },
    };
  }
}
