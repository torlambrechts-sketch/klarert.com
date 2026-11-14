import { z } from 'zod';
import { slugInput } from './workspace';

// Inputs of the pack commands (src/server/commands/packs.ts, docs/11).
const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);

export const listPacksInput = z.object({ org: slugInput });
/** A pack level (docs/11 Levels): optional, the pack's lowest level when not given. */
const level = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,39}$/)
  .optional();

/** Pack settings (docs/11 Pack settings): setting key → choice id, checked against the manifest by the command. */
const settings = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/))
  .optional();

export const previewPackInput = z.object({ org: slugInput, key, level });
export const installPackInput = z.object({
  org: slugInput,
  key,
  level,
  /** The catalogue hash the person previewed: the install refuses a pack that changed since. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Automations that send anything out (webhook, email) install on: the person opted in. Off when not given. */
  allowOutbound: z.boolean().optional(),
  /** The pack's settings chosen in the install dialog (docs/11 Pack settings). */
  settings,
});
/** Change a pack install's settings (docs/11 Pack settings). Owners and admins. */
export const setPackSettingsInput = z.object({
  org: slugInput,
  installId: z.uuid(),
  settings: z.record(
    z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  ),
});
/** Turn every automation of a pack install live, or back to test mode (docs/04 §14). Owners and admins. */
export const packAutomationsModeInput = z.object({
  org: slugInput,
  installId: z.uuid(),
  mode: z.enum(['live', 'test']),
});
export const archivePackInput = z.object({ org: slugInput, installId: z.uuid() });
export const packSetupsInput = z.object({ org: slugInput });
/** Pack upgrades (docs/11 Upgrades): the install to move to the catalogue's newest version. */
export const previewUpgradeInput = z.object({ org: slugInput, installId: z.uuid() });
export const upgradePackInput = z.object({
  org: slugInput,
  installId: z.uuid(),
  /** The catalogue hash of the version the person previewed: a changed catalogue is refused. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Conflict id (`<kind>:<ref>`) → keep mine or take the pack's. */
  choices: z
    .record(z.string().regex(/^[a-z]+:[A-Za-z0-9_.-]{1,200}$/), z.enum(['mine', 'theirs']))
    .default({}),
});
