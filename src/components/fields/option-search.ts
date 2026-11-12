import { OPTION_LABEL_MAX } from '@/engine/fields/helpers';
import type { LabelOption } from '@/engine/fields/types';

// What an option picker shows for a search (pure, so the rules are unit-tested): the options whose label contains
// the text, and whether to offer "Add “text”" as the last row.

export interface OptionSearch {
  /** Options whose label contains the search (all of them for an empty search), in list order. */
  shown: LabelOption[];
  /** The label to offer as a new option, or null: nothing typed, an option already has it, or too long. */
  add: string | null;
}

export function searchOptions(
  options: LabelOption[],
  query: string,
  canAdd: boolean,
): OptionSearch {
  const label = query.trim();
  const q = label.toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const add =
    canAdd &&
    label.length > 0 &&
    label.length <= OPTION_LABEL_MAX &&
    !options.some((o) => o.label.trim().toLowerCase() === q)
      ? label
      : null;
  return { shown, add };
}
