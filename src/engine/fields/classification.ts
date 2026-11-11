import { labelType } from './label';

export const classification = labelType({
  id: 'classification',
  label: 'Classification',
  family: 'choice',
  description: 'How sensitive the information is, from public to restricted.',
  defaultWidth: 130,
  ordered: true,
  defaultOptions: [
    { id: 'opt_public', label: 'Public', color: 'green' },
    { id: 'opt_internal', label: 'Internal', color: 'blue' },
    { id: 'opt_confidential', label: 'Confidential', color: 'orange' },
    { id: 'opt_restricted', label: 'Restricted', color: 'red' },
  ],
});
