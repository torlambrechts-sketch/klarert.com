import { labelType } from './label';

export const dropdown = labelType({
  id: 'dropdown',
  label: 'Dropdown',
  family: 'choice',
  description: 'Pick one option from a list you define.',
  defaultWidth: 130,
  defaultOptions: [
    { id: 'opt_1', label: 'Option 1', color: 'blue' },
    { id: 'opt_2', label: 'Option 2', color: 'purple' },
    { id: 'opt_3', label: 'Option 3', color: 'teal' },
  ],
});
