import { labelType } from './label';

export const severity = labelType({
  id: 'severity',
  label: 'Severity',
  family: 'choice',
  description: 'How serious the item is, from low to critical.',
  defaultWidth: 110,
  ordered: true,
  defaultOptions: [
    { id: 'opt_low', label: 'Low', color: 'green' },
    { id: 'opt_medium', label: 'Medium', color: 'yellow' },
    { id: 'opt_high', label: 'High', color: 'orange' },
    { id: 'opt_critical', label: 'Critical', color: 'red' },
  ],
});
