import { labelType } from './label';

export const status = labelType({
  id: 'status',
  label: 'Status',
  family: 'choice',
  description: 'Where the item stands: one coloured label.',
  defaultWidth: 140,
  defaultOptions: [
    { id: 'opt_todo', label: 'Not started', color: 'grey' },
    { id: 'opt_wip', label: 'Working on it', color: 'orange' },
    { id: 'opt_stuck', label: 'Stuck', color: 'red' },
    { id: 'opt_done', label: 'Done', color: 'green', done: true },
  ],
});
