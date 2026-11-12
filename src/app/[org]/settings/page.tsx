import { env } from '@/lib/env';
import type { ServerClient } from '@/lib/supabase/server';
import { PageHeader, PageTabs } from '@/components/shell/page-header';
import { ROLE_LABELS } from '@/lib/schemas/workspace';
import { isAdminRole, requireMember } from '@/server/auth';
import {
  InviteForm,
  InviteRowControls,
  MemberRowControls,
  type InviteRow,
  type MemberRow,
} from './members';
import { AddByName, AddEntity, DeleteButton, TeamMembers } from './structure';

export const metadata = { title: 'Settings · Compliance OS' };

const TABS = [
  { id: 'members', label: 'Members' },
  { id: 'teams', label: 'Teams and roles' },
  { id: 'entities', label: 'Entities and sites' },
] as const;
type Tab = (typeof TABS)[number]['id'];

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-line bg-background-100 flex flex-col gap-4 rounded-lg border p-5 sm:px-[22px]">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-16">{title}</h2>
        {description ? <p className="text-muted-foreground text-copy-13">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Avatar({ initials, color }: { initials: string; color: string }) {
  return (
    <span
      className="text-label-12 flex size-8 shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ background: `var(--label-${color}, var(--label-blue))` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { org } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === rawTab) ? (rawTab as Tab) : 'members';
  const { supabase, workspace, role, user } = await requireMember(org);

  if (!isAdminRole(role)) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-7 sm:pt-[26px]">
        <h1>Workspace admin</h1>
        <p className="text-muted-foreground mt-2">
          Only owners and admins can change workspace settings.
        </p>
      </main>
    );
  }

  const { data: memberRows } = await supabase
    .from('memberships')
    .select('user_id, role, profiles!inner(display_name, initials, color)')
    .eq('org_id', workspace.id)
    .order('created_at');
  const members: MemberRow[] = (memberRows ?? []).map((m) => ({
    userId: m.user_id,
    name: m.profiles.display_name,
    initials: m.profiles.initials,
    color: m.profiles.color,
    role: m.role,
    isMe: m.user_id === user.id,
  }));
  const people = members.map((m) => ({ userId: m.userId, name: m.name }));
  const nameOf = new Map(people.map((p) => [p.userId, p.name]));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-7 sm:pt-[26px]">
      <PageHeader
        crumb={workspace.name}
        title="Workspace admin"
        description="Members and roles, teams and job roles, entities and sites."
      />
      <PageTabs
        label="Settings sections"
        active={tab}
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, href: `/${org}/settings?tab=${t.id}` }))}
      />

      {tab === 'members' ? (
        <MembersTab db={supabase} org={org} orgId={workspace.id} members={members} myRole={role} />
      ) : null}
      {tab === 'teams' ? (
        <TeamsTab db={supabase} org={org} orgId={workspace.id} people={people} nameOf={nameOf} />
      ) : null}
      {tab === 'entities' ? <EntitiesTab db={supabase} org={org} orgId={workspace.id} /> : null}
    </main>
  );
}

async function MembersTab({
  db,
  org,
  orgId,
  members,
  myRole,
}: {
  db: ServerClient;
  org: string;
  orgId: string;
  members: MemberRow[];
  myRole: MemberRow['role'];
}) {
  const { data: inviteRows } = await db
    .from('invites')
    .select('id, email, role, token, created_at')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });
  const invites: InviteRow[] = (inviteRows ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    link: `${env.NEXT_PUBLIC_APP_URL}/invite/${i.token}`,
    createdAt: i.created_at,
  }));
  return (
    <>
      <Card
        title="Invite a member"
        description="Create a link and send it to them. They sign in with that email address to join."
      >
        <InviteForm org={org} canInviteOwner={myRole === 'owner'} />
      </Card>
      <Card title={`Members · ${members.length}`}>
        <ul className="divide-line flex flex-col divide-y">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <Avatar initials={m.initials} color={m.color} />
                <div className="flex flex-col">
                  <span className="font-medium">
                    {m.name}
                    {m.isMe ? (
                      <span className="text-muted-foreground font-normal"> (you)</span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-label-13">{ROLE_LABELS[m.role]}</span>
                </div>
              </div>
              <MemberRowControls org={org} member={m} myRole={myRole} />
            </li>
          ))}
        </ul>
      </Card>
      {invites.length > 0 ? (
        <Card title={`Open invites · ${invites.length}`}>
          <ul className="divide-line flex flex-col divide-y">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{i.email}</span>
                  <span className="text-muted-foreground text-label-13">
                    {ROLE_LABELS[i.role]} · not accepted yet
                  </span>
                </div>
                <InviteRowControls org={org} invite={i} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

async function TeamsTab({
  db,
  org,
  orgId,
  people,
  nameOf,
}: {
  db: ServerClient;
  org: string;
  orgId: string;
  people: { userId: string; name: string }[];
  nameOf: Map<string, string>;
}) {
  const [{ data: teams }, { data: roles }] = await Promise.all([
    db.from('teams').select('id, name, team_members(user_id)').eq('org_id', orgId).order('name'),
    db.from('job_roles').select('id, name').eq('org_id', orgId).order('name'),
  ]);
  return (
    <>
      <Card
        title="Teams"
        description="Teams can be chosen in team fields and assigned work by automations."
      >
        <AddByName kind="team" org={org} label="New team" placeholder="Quality" />
        {(teams ?? []).length === 0 ? (
          <p className="text-muted-foreground text-copy-13">
            No teams yet. Add the first one above.
          </p>
        ) : (
          <ul className="divide-line flex flex-col divide-y">
            {(teams ?? []).map((t) => (
              <li key={t.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  <DeleteButton kind="team" org={org} id={t.id} name={t.name} />
                </div>
                <TeamMembers
                  org={org}
                  teamId={t.id}
                  teamName={t.name}
                  people={people}
                  members={t.team_members.map((m) => ({
                    userId: m.user_id,
                    name: nameOf.get(m.user_id) ?? 'Former member',
                  }))}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Job roles"
        description="Job roles can be chosen in role fields, such as the owner of a control."
      >
        <AddByName kind="jobRole" org={org} label="New job role" placeholder="Compliance manager" />
        {(roles ?? []).length === 0 ? (
          <p className="text-muted-foreground text-copy-13">
            No job roles yet. Add the first one above.
          </p>
        ) : (
          <ul className="divide-line flex flex-col divide-y">
            {(roles ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span>{r.name}</span>
                <DeleteButton kind="jobRole" org={org} id={r.id} name={r.name} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

async function EntitiesTab({ db, org, orgId }: { db: ServerClient; org: string; orgId: string }) {
  const { data: entities } = await db
    .from('entities')
    .select('id, name, country, sites(id, name)')
    .eq('org_id', orgId)
    .order('name');
  return (
    <Card
      title="Entities and sites"
      description="Legal entities and their sites, used by entity and location fields."
    >
      <AddEntity org={org} />
      {(entities ?? []).length === 0 ? (
        <p className="text-muted-foreground text-copy-13">
          No entities yet. Add your legal entity above.
        </p>
      ) : (
        <ul className="divide-line flex flex-col divide-y">
          {(entities ?? []).map((e) => (
            <li key={e.id} className="flex flex-col gap-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {e.name}{' '}
                  <span className="text-muted-foreground text-label-12-mono">{e.country}</span>
                </span>
                <DeleteButton kind="entity" org={org} id={e.id} name={e.name} />
              </div>
              <ul className="flex flex-col gap-1 pl-3" aria-label={`Sites of ${e.name}`}>
                {e.sites.length === 0 ? (
                  <li className="text-muted-foreground text-label-13">No sites yet.</li>
                ) : null}
                {[...e.sites]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2">
                      <span>{s.name}</span>
                      <DeleteButton kind="site" org={org} id={s.id} name={s.name} />
                    </li>
                  ))}
              </ul>
              <div className="pl-3">
                <AddByName
                  kind="site"
                  org={org}
                  extra={{ entityId: e.id }}
                  label={`New site for ${e.name}`}
                  placeholder="Leeds"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
