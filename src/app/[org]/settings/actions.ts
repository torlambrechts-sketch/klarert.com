'use server';

import { revalidatePath } from 'next/cache';
import * as members from '@/server/commands/members';
import * as packs from '@/server/commands/packs';
import * as structure from '@/server/commands/structure';
import type { Result } from '@/server/result';

// Each action maps FormData to its command's input; the command validates with Zod and authorises.
const fields = (form: FormData) =>
  Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));

function bind<T>(command: (input: unknown) => Promise<Result<T>>) {
  return async (_: unknown, form: FormData): Promise<Result<T>> => {
    const input = fields(form);
    const result = await command(input);
    if (result.ok) revalidatePath(`/${String(input.org)}/settings`);
    return result;
  };
}

export const createInviteAction = bind(members.createInvite);
export const revokeInviteAction = bind(members.revokeInvite);
export const changeRoleAction = bind(members.changeRole);
export const removeMemberAction = bind(members.removeMember);
export const createTeamAction = bind(structure.createTeam);
export const deleteTeamAction = bind(structure.deleteTeam);
export const addTeamMemberAction = bind(structure.addTeamMember);
export const removeTeamMemberAction = bind(structure.removeTeamMember);
export const createJobRoleAction = bind(structure.createJobRole);
export const deleteJobRoleAction = bind(structure.deleteJobRole);
export const createEntityAction = bind(structure.createEntity);
export const deleteEntityAction = bind(structure.deleteEntity);
export const createSiteAction = bind(structure.createSite);
export const deleteSiteAction = bind(structure.deleteSite);

// Packs (docs/11): object inputs; the commands validate with Zod and authorise. Installing and archiving change the
// side menu, so the whole workspace layout is revalidated.
export async function previewPackAction(input: { org: string; key: string }) {
  return packs.previewPack(input);
}

export async function installPackAction(input: { org: string; key: string; hash: string }) {
  const result = await packs.installPack(input);
  if (result.ok) revalidatePath(`/${input.org}`, 'layout');
  return result;
}

export async function archivePackAction(input: { org: string; installId: string }) {
  const result = await packs.archivePack(input);
  if (result.ok) revalidatePath(`/${input.org}`, 'layout');
  return result;
}
