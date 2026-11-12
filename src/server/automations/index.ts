import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Actor, AutomationEvent } from '@/engine/automations';
import { env } from '@/lib/env';
import { automationStore, workspaceSlug } from './effects';
import { runChain, type ChainRun } from './runner';

// The automation runner's entry point (docs/04). Every command calls it after its write with the events the write
// emitted; buttons and forms too. The caller has authorised the workspace: a command through withOrg, the public form
// through its link. The runner never throws into the command: the person's change is already saved.

export type { Actor, AutomationEvent };

export interface AutomationOutcome {
  /** Runs that executed, for the toast and tests. */
  runs: ChainRun[];
  /** Toast lines for the person who made the change. */
  messages: string[];
}

export async function runAutomations(
  events: AutomationEvent[],
  context: {
    orgId: string;
    /** The person who started the chain; null for public form submissions (no one is signed in). */
    userId: string | null;
    /** Workspace slug, for item links in messages and webhooks (looked up when not given). */
    workspace?: string;
    /** Bulk edits: one summary line (docs/04 §7.9). */
    summarise?: boolean;
  },
): Promise<AutomationOutcome> {
  if (events.length === 0) return { runs: [], messages: [] };
  const starter: Actor = context.userId
    ? { kind: 'user', id: context.userId }
    : { kind: 'form', id: null };
  const chainId = randomUUID();
  const started = Date.now();
  try {
    const out = await runChain(
      events,
      automationStore({ orgId: context.orgId, userId: context.userId }),
      {
        starter,
        chainId,
        clock: () => Date.now(),
        appUrl: env.NEXT_PUBLIC_APP_URL,
        workspace: context.workspace ?? (await workspaceSlug(context.orgId)),
        summarise: context.summarise,
      },
    );
    if (out.runs.length > 0)
      console.info(
        JSON.stringify({
          level: 'info',
          source: 'automations',
          org: context.orgId,
          chain: chainId,
          runs: out.runs.length,
          ms: Date.now() - started,
        }),
      );
    return out;
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'automations',
        org: context.orgId,
        chain: chainId,
        message: e instanceof Error ? e.message : String(e),
      }),
    );
    return { runs: [], messages: ['Your change was saved, but automations could not run.'] };
  }
}

/** One `value.changed` per stored field the write changed (docs/04 §2). Protected values never enter events. */
export function valueEvents(
  before: { sheetId: string; id: string; values: Record<string, unknown> },
  after: { values: Record<string, unknown> },
  fieldIds: string[],
  actor: Actor,
  restricted: Set<string> = new Set(),
): AutomationEvent[] {
  return fieldIds.map((fieldId) => ({
    type: 'value.changed',
    sheetId: before.sheetId,
    itemId: before.id,
    fieldId,
    before: restricted.has(fieldId) ? null : (before.values[fieldId] ?? null),
    after: restricted.has(fieldId) ? 'Restricted' : (after.values[fieldId] ?? null),
    actor,
  }));
}
