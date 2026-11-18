// The sheet toolbar's controls (docs/05 §3, docs/18 C8): one 38 px row, 8 px apart: View ▾, the search, Filter ▾,
// Sort ▾, More ▾ and ⚡ n on the Table (the other views keep the search, groups, sort and filter). One place so the
// menu triggers, the search and the automations button line up.

/** A select-like trigger: 14 px words (muted while nothing is chosen, see `toolbarPlaceholder`), a chevron at the end. */
export const toolbarSelect =
  'border-line hover:bg-subtle focus-visible:outline-focus flex h-[38px] max-w-[240px] min-w-[150px] items-center gap-2 rounded-md border bg-surface pr-2.5 pl-3 text-14 focus-visible:outline-2';

/** The words of a select trigger while it shows everything (All statuses, All owners, Default order). */
export const toolbarPlaceholder = 'text-muted-foreground';

/** An outline button or menu trigger of the toolbar (View, Filter, Sort, More, Automations): medium words, 15 px icons. */
export const toolbarButton =
  "h-[38px] px-3.5 has-[>svg]:px-3.5 text-13 font-medium shadow-none [&_svg:not([class*='size-'])]:size-[15px]";

/** The small count after a control's words ("+7", "3"): a translucent grey, so it shows on white and on the on state. */
export const toolbarCount =
  'bg-soft text-muted-foreground font-mono text-12 rounded-[4px] px-[5px] leading-[18px] font-normal tabular-nums';

/**
 * A control that narrows or orders what the sheet shows (a filter, a sort, one group, missing required): darker and
 * medium weight while it is on, with its count or its words saying what is on. Neutral, never a hue (owner decision
 * 17 Nov 2026), so colour is not the signal.
 */
export const toolbarOn = 'border-faint bg-soft hover:bg-soft text-ink font-medium';
