import { labelType } from './label';

export const finding = labelType({
  id: 'finding',
  label: 'Finding',
  family: 'compliance',
  description: 'An audit verdict, from conformity to major nonconformity.',
  defaultWidth: 170,
  ordered: true,
  fixed: true,
  triggers: ['field_changed', 'field_becomes'],
  defaultOptions: [
    { id: 'opt_conformity', label: 'Conformity', color: 'green', done: true },
    { id: 'opt_observation', label: 'Observation', color: 'blue' },
    { id: 'opt_ofi', label: 'Opportunity for improvement', color: 'teal' },
    { id: 'opt_minor', label: 'Minor nonconformity', color: 'orange' },
    { id: 'opt_major', label: 'Major nonconformity', color: 'red' },
  ],
});
