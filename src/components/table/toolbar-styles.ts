// The sheet toolbar's controls (docs/05 §3): the board design's 38 px row of selects and buttons. One place so the
// search, Actions, groups, status, owner, sort, filter, columns, density and automations controls line up.

/** A select-like trigger: 14 px words (muted while nothing is chosen, see `toolbarPlaceholder`), a chevron at the end. */
export const toolbarSelect =
  'border-line hover:bg-subtle focus-visible:outline-focus flex h-[38px] max-w-[240px] min-w-[150px] items-center gap-2 rounded-md border bg-background-100 pr-2.5 pl-3 text-label-14 focus-visible:outline-2';

/** The words of a select trigger while it shows everything (All statuses, All owners, Default order). */
export const toolbarPlaceholder = 'text-muted-foreground';

/** An outline button of the toolbar (Filter, Columns, Actions, Automations): 13.5 px medium words, 15 px icons. */
export const toolbarButton =
  "h-[38px] px-3.5 has-[>svg]:px-3.5 text-label-13 font-medium shadow-none [&_svg:not([class*='size-'])]:size-[15px]";

/** The small count after a control's words ("+7", "3"): a translucent grey, so it shows on white and on the on state. */
export const toolbarCount =
  'bg-gray-alpha-200 text-muted-foreground text-label-11-mono rounded-[4px] px-[5px] leading-[18px] font-normal tabular-nums';

/**
 * A control that narrows or orders what the sheet shows (a filter, a sort, one group, missing required): darker and
 * medium weight while it is on, with its count or its words saying what is on. Neutral, never a hue (owner decision
 * 17 Nov 2026), so colour is not the signal.
 */
export const toolbarOn = 'border-faint bg-soft hover:bg-soft text-ink font-medium';
