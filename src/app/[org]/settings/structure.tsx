'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { ActionForm } from '@/components/forms/action-form';
import { SubmitButton, TextField } from '@/components/forms/form-bits';
import { Button } from '@/components/ui/button';
import {
  addTeamMemberAction,
  createEntityAction,
  createJobRoleAction,
  createSiteAction,
  createTeamAction,
  deleteEntityAction,
  deleteJobRoleAction,
  deleteSiteAction,
  deleteTeamAction,
  removeTeamMemberAction,
} from './actions';

type Person = { userId: string; name: string };

/** Single-field "add" form used for teams, job roles and sites. */
export function AddByName({
  kind,
  org,
  extra = {},
  label,
  placeholder,
}: {
  kind: 'team' | 'jobRole' | 'site';
  org: string;
  extra?: Record<string, string>;
  label: string;
  placeholder: string;
}) {
  const action = { team: createTeamAction, jobRole: createJobRoleAction, site: createSiteAction }[
    kind
  ];
  return (
    <ActionForm
      action={action}
      hidden={{ org, ...extra }}
      reset
      className="flex items-end gap-2"
      aria-label={label}
    >
      {(state) => (
        <>
          <div className="flex-1">
            <TextField label={label} name="name" placeholder={placeholder} state={state} />
          </div>
          <SubmitButton variant="outline" pendingText="Adding…">
            Add
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function DeleteButton({
  kind,
  org,
  id,
  name,
}: {
  kind: 'team' | 'jobRole' | 'entity' | 'site';
  org: string;
  id: string;
  name: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const cfg = {
    team: { action: deleteTeamAction, key: 'teamId' },
    jobRole: { action: deleteJobRoleAction, key: 'jobRoleId' },
    entity: { action: deleteEntityAction, key: 'entityId' },
    site: { action: deleteSiteAction, key: 'siteId' },
  }[kind];
  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Delete ${name}`}
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
    );
  }
  return (
    <ActionForm
      action={cfg.action}
      hidden={{ org, [cfg.key]: id }}
      success={`${name} deleted`}
      className="flex gap-1"
    >
      <SubmitButton variant="destructive" size="sm" pendingText="Deleting…">
        Delete {name}
      </SubmitButton>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </ActionForm>
  );
}

export function TeamMembers({
  org,
  teamId,
  teamName,
  members,
  people,
}: {
  org: string;
  teamId: string;
  teamName: string;
  members: Person[];
  people: Person[];
}) {
  const available = people.filter((p) => !members.some((m) => m.userId === p.userId));
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-1.5" aria-label={`Members of ${teamName}`}>
        {members.length === 0 ? (
          <li className="text-muted-foreground text-label-13">No members yet.</li>
        ) : null}
        {members.map((m) => (
          <li
            key={m.userId}
            className="bg-soft border-line text-label-13 flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5"
          >
            {m.name}
            <ActionForm action={removeTeamMemberAction} hidden={{ org, teamId, userId: m.userId }}>
              <button
                type="submit"
                className="hover:bg-line flex size-5 items-center justify-center rounded-full"
                aria-label={`Remove ${m.name} from ${teamName}`}
              >
                <X className="size-3" aria-hidden />
              </button>
            </ActionForm>
          </li>
        ))}
      </ul>
      {available.length > 0 ? (
        <ActionForm
          action={addTeamMemberAction}
          hidden={{ org, teamId }}
          className="flex items-center gap-2"
        >
          <label className="sr-only" htmlFor={`add-${teamId}`}>
            Add a person to {teamName}
          </label>
          <select
            id={`add-${teamId}`}
            name="userId"
            className="border-input bg-background-100 text-label-13 h-8 rounded-md border px-2"
          >
            {available.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </select>
          <SubmitButton variant="outline" size="sm" pendingText="Adding…">
            Add to team
          </SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}

export function AddEntity({ org }: { org: string }) {
  return (
    <ActionForm
      action={createEntityAction}
      hidden={{ org }}
      reset
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      aria-label="Add an entity"
    >
      {(state) => (
        <>
          <div className="flex-1">
            <TextField
              label="Legal entity"
              name="name"
              placeholder="Meridian Components Ltd"
              state={state}
            />
          </div>
          <div className="sm:w-28">
            <TextField
              label="Country"
              name="country"
              placeholder="GB"
              maxLength={2}
              state={state}
            />
          </div>
          <SubmitButton variant="outline" pendingText="Adding…">
            Add entity
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
