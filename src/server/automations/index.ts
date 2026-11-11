import 'server-only';

// The automation runner (docs/04) arrives in M7. Every command already calls it after its write, so M7 fills this in
// without touching the commands.

export type AutomationEvent =
  | { type: 'item_created'; sheetId: string; itemId: string }
  | { type: 'field_changed'; sheetId: string; itemId: string; fieldIds: string[] }
  | { type: 'item_moved'; sheetId: string; itemId: string; from: string; to: string }
  | { type: 'item_archived' | 'item_restored'; sheetId: string; itemId: string }
  | { type: 'links_changed'; sheetId: string; itemId: string; fieldId: string }
  | { type: 'item_locked' | 'item_unlocked'; sheetId: string; itemId: string }
  | { type: 'button_clicked'; sheetId: string; itemId: string; fieldId: string };

export interface AutomationOutcome {
  /** Runs that fired, for the run log and the toast. */
  runs: { automationId: string; outcome: string }[];
  /** Toast lines for the person who made the change. */
  messages: string[];
}

/** Run the automations that match these events (depth ≤ 3). No automations exist before M7. */
export async function runAutomations(
  events: AutomationEvent[],
  context: { orgId: string; userId: string; depth?: number },
): Promise<AutomationOutcome> {
  void events;
  void context;
  return { runs: [], messages: [] };
}
