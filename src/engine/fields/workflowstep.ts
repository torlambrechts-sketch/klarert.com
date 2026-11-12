import { labelType } from './label';

// Only automations may set a workflow step; SQL enforces it (docs/03 §3.4), so it is never on a form.
export const workflowstep = labelType({
  id: 'workflowstep',
  label: 'Workflow step',
  family: 'computed',
  description: 'The step an item has reached; only automations move it.',
  defaultWidth: 140,
  formAllowed: false,
  addable: false,
  defaultOptions: [
    { id: 'opt_draft', label: 'Draft', color: 'grey' },
    { id: 'opt_review', label: 'Review', color: 'blue' },
    { id: 'opt_approval', label: 'Approval', color: 'purple' },
    { id: 'opt_done', label: 'Done', color: 'green', done: true },
  ],
});
