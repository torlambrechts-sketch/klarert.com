import { todayIn } from '@/engine/sheet-data';
import { formatDateTime } from '@/engine/fields/helpers';
import { ORGANISE_ACTIONS, organiseText } from '@/engine/organise';
import Link from 'next/link';
import { env } from '@/lib/env';
import { Button } from '@/components/ui/button';
import type { Json } from '@/engine/types';
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
import { DeleteFolder, RestoreFolder, RestoreSheet } from './archived';
import { AddByName, AddEntity, DeleteButton, TeamMembers } from './structure';
import { ArchivePack, PackPreview } from './packs';
import { listPacks, packSetups } from '@/server/commands/packs';
import { SetupSteps, SetupSummary } from '@/components/packs/setup-checklist';
import { listFrameworks } from '@/server/commands/frameworks';
import { AdoptFramework } from './frameworks';
import { listAuditOutputs, reviewSheetsByInstall } from '@/server/commands/audit';
import { AuditPackDialog } from '@/components/audit/audit-pack-dialog';
import { addDays, addMonths } from '@/engine/fields/helpers';
import { Check, ExternalLink } from 'lucide-react';

export const metadata = { title: 'Settings · Compliance OS' };

const TABS = [
  { id: 'members', label: 'Members' },
  { id: 'teams', label: 'Teams and roles' },
  { id: 'entities', label: 'Entities and sites' },
  { id: 'packs', label: 'Packs' },
  { id: 'frameworks', label: 'Frameworks' },
  { id: 'archived', label: 'Archived' },
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
  const timeZone = workspace.time_zone;

  if (!isAdminRole(role)) {
    return (
      <main className="w-full px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
        <h1>Workspace admin</h1>
        <p className="text-muted-foreground mt-2">
          Only owners and admins can change workspace settings.
        </p>
      </main>
    );
  }

  const { data: memberRows } = await supabase
    .from('memberships')
    .select('user_id, role, expires_at, profiles!inner(display_name, initials, color)')
    .eq('org_id', workspace.id)
    .order('created_at');
  const members: MemberRow[] = (memberRows ?? []).map((m) => ({
    userId: m.user_id,
    name: m.profiles.display_name,
    initials: m.profiles.initials,
    color: m.profiles.color,
    role: m.role,
    isMe: m.user_id === user.id,
    expiresAt: m.expires_at,
    expiresLabel: m.expires_at
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: workspace.time_zone,
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        }).format(new Date(m.expires_at))
      : null,
  }));
  const today = todayIn(new Date(), workspace.time_zone);
  const people = members.map((m) => ({ userId: m.userId, name: m.name }));
  const nameOf = new Map(people.map((p) => [p.userId, p.name]));

  return (
    <main className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
      <PageHeader
        crumb={workspace.name}
        title="Workspace admin"
        description="Members and roles, teams and job roles, entities and sites, packs, frameworks, archived folders and sheets."
      />
      <PageTabs
        label="Settings sections"
        active={tab}
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, href: `/${org}/settings?tab=${t.id}` }))}
      />

      {tab === 'members' ? (
        <MembersTab
          db={supabase}
          org={org}
          orgId={workspace.id}
          members={members}
          myRole={role}
          today={today}
        />
      ) : null}
      {tab === 'teams' ? (
        <TeamsTab db={supabase} org={org} orgId={workspace.id} people={people} nameOf={nameOf} />
      ) : null}
      {tab === 'entities' ? <EntitiesTab db={supabase} org={org} orgId={workspace.id} /> : null}
      {tab === 'packs' ? <PacksTab org={org} timeZone={timeZone} /> : null}
      {tab === 'frameworks' ? <FrameworksTab org={org} /> : null}
      {tab === 'archived' ? (
        <ArchivedTab
          db={supabase}
          org={org}
          orgId={workspace.id}
          nameOf={nameOf}
          timeZone={timeZone}
        />
      ) : null}
    </main>
  );
}

async function MembersTab({
  db,
  org,
  orgId,
  members,
  myRole,
  today,
}: {
  db: ServerClient;
  org: string;
  orgId: string;
  members: MemberRow[];
  myRole: MemberRow['role'];
  today: string;
}) {
  const { data: inviteRows } = await db
    .from('invites')
    .select('id, email, role, token, created_at, expires_at')
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
        <InviteForm org={org} canInviteOwner={myRole === 'owner'} today={today} />
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
                  <span className="text-muted-foreground text-label-13">
                    {ROLE_LABELS[m.role]}
                    {m.role === 'auditor' && m.expiresLabel
                      ? ` · read-only until ${m.expiresLabel}`
                      : null}
                  </span>
                </div>
              </div>
              <MemberRowControls org={org} member={m} myRole={myRole} today={today} />
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

/** Packs (docs/11): the catalogue, what is installed here and the pack entries of the activity log. */
async function PacksTab({ org, timeZone }: { org: string; timeZone: string }) {
  const [r, setupsResult, reviewSheets] = await Promise.all([
    listPacks({ org }),
    packSetups({ org }),
    reviewSheetsByInstall({ org }),
  ]);
  const reviewLinks = (installId: string): Record<string, { href: string; label: string }> => {
    const sheetId = reviewSheets.ok ? reviewSheets.data[installId] : undefined;
    return sheetId
      ? { [sheetId]: { href: `/${org}/audit/review`, label: 'Compile the review inputs' } }
      : {};
  };
  if (!r.ok)
    return (
      <Card title="Packs">
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="m-0">{r.error.message}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${org}/settings?tab=packs`}>Retry</Link>
          </Button>
        </div>
      </Card>
    );
  const { available, installed, log, canInstall } = r.data;
  return (
    <>
      <Card
        title="Available packs"
        description="Ready-made sheets, links, forms, automations and dashboards. Preview a pack to see exactly what it creates here before you install it."
      >
        {available.length === 0 ? (
          <p className="text-muted-foreground text-copy-13">No packs are available yet.</p>
        ) : (
          <ul className="divide-line flex flex-col divide-y" aria-label="Available packs">
            {available.map((p) => (
              <li
                key={p.key}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.title}</span>
                    <span className="text-label-12-mono text-muted-foreground">{p.version}</span>
                    {p.installedVersion ? (
                      <span className="text-label-12 bg-good-soft flex items-center gap-1 rounded px-1.5 py-0.5">
                        <Check className="text-good size-3" aria-hidden /> Installed
                        {p.installedLevel
                          ? `: ${p.levels.find((l) => l.key === p.installedLevel)?.name ?? p.installedLevel}`
                          : ''}
                      </span>
                    ) : null}
                    {p.levels.length ? (
                      <span className="text-label-12 text-muted-foreground">
                        {p.levels.map((l) => l.name).join(' or ')}
                      </span>
                    ) : null}
                  </span>
                  {p.description ? (
                    <span className="text-copy-13 text-muted-foreground">{p.description}</span>
                  ) : null}
                  <span className="text-label-13">
                    Inside: {p.inside}
                    <span className="text-muted-foreground"> · {p.sheets.join(', ')}</span>
                  </span>
                  {p.frameworks.length ? (
                    <span className="text-label-13 text-muted-foreground">
                      Builds on the {p.frameworks.join(', ')} requirement library, adopted at
                      install if this workspace has not adopted it.
                    </span>
                  ) : null}
                </div>
                {canInstall ? (
                  <div className="shrink-0">
                    <PackPreview
                      org={org}
                      pack={{
                        key: p.key,
                        title: p.title,
                        version: p.version,
                        levels: p.levels,
                        installedLevel: p.installedLevel,
                      }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Installed packs"
        description="Archiving a pack archives its sheets, folders and dashboards and turns its automations off. Items and the activity log are kept, and archived sheets can be restored from Archived."
      >
        {installed.length === 0 ? (
          <p className="text-muted-foreground text-copy-13">No packs installed yet.</p>
        ) : (
          <ul className="divide-line flex flex-col divide-y" aria-label="Installed packs">
            {installed.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{i.title}</span>
                    <span className="text-label-12-mono text-muted-foreground">{i.version}</span>
                    {i.level ? <span className="text-label-12">{i.level.name}</span> : null}
                    <span className="text-label-12 text-muted-foreground">
                      {i.status === 'installed' ? 'Installed' : 'Archived'}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-label-13">
                    Installed by {i.installedBy}, {formatDateTime(i.installedAt, timeZone)}
                    {i.archivedAt
                      ? ` · archived by ${i.archivedBy ?? 'System'}, ${formatDateTime(i.archivedAt, timeZone)}`
                      : ''}
                  </span>
                </div>
                {i.status === 'installed' ? (
                  <div className="flex flex-wrap gap-1">
                    {i.firstSheetId ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/${org}/s/${i.firstSheetId}`} aria-label={`Open ${i.title}`}>
                          Open
                        </Link>
                      </Button>
                    ) : null}
                    {canInstall && i.nextLevel
                      ? (() => {
                          const card = available.find((a) => a.key === i.key);
                          return card ? (
                            <PackPreview
                              org={org}
                              label={`Add ${i.nextLevel.name}`}
                              pack={{
                                key: card.key,
                                title: card.title,
                                version: card.version,
                                levels: card.levels,
                                installedLevel: card.installedLevel,
                              }}
                            />
                          ) : null;
                        })()
                      : null}
                    {canInstall ? <ArchivePack org={org} installId={i.id} title={i.title} /> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {setupsResult.ok ? (
        setupsResult.data.map((s) => (
          <div key={s.installId} id={`setup-${s.installId}`} className="scroll-mt-4">
            <Card
              title={`${s.progress.title}${s.level ? ` · ${s.level.name}` : ''}`}
              description={s.progress.description}
            >
              <div className="flex flex-col gap-2">
                <SetupSummary progress={s.progress} />
                <SetupSteps org={org} progress={s.progress} extraLinks={reviewLinks(s.installId)} />
              </div>
            </Card>
          </div>
        ))
      ) : (
        <Card title="Setup">
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="m-0">{setupsResult.error.message}</p>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${org}/settings?tab=packs`}>Retry</Link>
            </Button>
          </div>
        </Card>
      )}
      <Card
        title="Pack activity"
        description="Installs and archives from the activity log, newest first."
      >
        {log.length === 0 ? (
          <p className="text-muted-foreground text-copy-13">No pack activity yet.</p>
        ) : (
          <ol
            className="divide-line m-0 flex list-none flex-col divide-y p-0"
            aria-label="Pack activity"
          >
            {log.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2">
                <span>
                  <span className="font-medium">{e.actor}</span> · {e.text}
                </span>
                <span className="text-muted-foreground text-label-12-mono">
                  {formatDateTime(e.at, timeZone)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}

const KIND_LABEL: Record<string, string> = {
  standard: 'Standard',
  law: 'EU law',
  regulation: 'Regulation',
  internal: 'Internal',
};

/** A coverage bar with its words: colour is never the only signal. */
function CoverageBar({ percent, label }: { percent: number | null; label: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="bg-soft h-1.5 w-full max-w-[240px] overflow-hidden rounded" aria-hidden>
        <span className="bg-good block h-full rounded" style={{ width: `${percent ?? 0}%` }} />
      </span>
      <span className="text-label-13">{label}</span>
    </span>
  );
}

/** Frameworks (docs/12): adopted frameworks with coverage, and the catalogue to adopt from. */
async function FrameworksTab({ org }: { org: string }) {
  const [r, outputs] = await Promise.all([listFrameworks({ org }), listAuditOutputs({ org })]);
  if (!r.ok)
    return (
      <Card title="Frameworks">
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="m-0">{r.error.message}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${org}/settings?tab=frameworks`}>Retry</Link>
          </Button>
        </div>
      </Card>
    );
  const { frameworks, canAdopt, controlsSheets } = r.data;
  const adopted = frameworks.filter((f) => f.adopted);
  return (
    <>
      <Card
        title={`Adopted frameworks · ${adopted.length}`}
        description="Each adopted framework is a library sheet: one item per requirement, with applicability, justification, implementation status and evidence. Coverage is the share of requirements in scope with an implemented control or current evidence."
      >
        {adopted.length === 0 ? (
          <p className="text-muted-foreground text-copy-13">
            No frameworks adopted yet. Adopt one from the catalogue below.
          </p>
        ) : (
          <ul className="divide-line flex flex-col divide-y" aria-label="Adopted frameworks">
            {adopted.map((f) => (
              <li
                key={f.key}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{f.title}</span>
                    <span className="text-muted-foreground text-label-13">
                      {f.adopted!.sheetName}
                    </span>
                  </span>
                  <CoverageBar
                    percent={f.adopted!.coverage.percent}
                    label={f.adopted!.coverageText}
                  />
                </div>
                <span className="flex flex-wrap gap-2 self-start sm:self-center">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/${org}/s/${f.adopted!.sheetId}`} aria-label={`Open ${f.title}`}>
                      Open
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/${org}/audit/soa/${f.adopted!.sheetId}`}
                      aria-label={`Export the statement of applicability of ${f.title}`}
                    >
                      Export SoA
                    </Link>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Audit outputs"
        description="An audit pack for a folder or a pack: the statement of applicability, the registers, an evidence index and the activity log of a period with its hash chains checked. Members and auditors find the same on Audit outputs."
      >
        {outputs.ok ? (
          <div className="flex flex-wrap items-center gap-3">
            <AuditPackDialog
              org={org}
              folders={outputs.data.folders}
              installs={outputs.data.installs}
              defaultFrom={addDays(addMonths(outputs.data.today, -12), 1)}
              defaultTo={outputs.data.today}
            />
            <Link
              href={`/${org}/audit`}
              className="text-ink text-label-13 font-medium underline-offset-4 hover:underline"
            >
              All audit outputs
            </Link>
          </div>
        ) : (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="m-0">{outputs.error.message}</p>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${org}/settings?tab=frameworks`}>Retry</Link>
            </Button>
          </div>
        )}
      </Card>
      <Card
        title="Framework catalogue"
        description="Reference numbers with official short titles, plus our own purpose, guidance, audit questions and typical evidence for each. The text of standards is not included: buy the standard for it. EU laws link to EUR-Lex."
      >
        {frameworks.length === 0 ? (
          <p className="text-muted-foreground text-copy-13">No frameworks are available yet.</p>
        ) : (
          <ul className="divide-line flex flex-col divide-y" aria-label="Framework catalogue">
            {frameworks.map((f) => (
              <li
                key={`${f.key}@${f.version}`}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{f.title}</span>
                    <span className="text-label-12 bg-soft rounded px-1.5 py-0.5">
                      {KIND_LABEL[f.kind] ?? f.kind}
                    </span>
                    {f.adopted ? (
                      <span className="text-label-12 bg-good-soft flex items-center gap-1 rounded px-1.5 py-0.5">
                        <Check className="text-good size-3" aria-hidden /> Adopted
                      </span>
                    ) : null}
                  </span>
                  <span className="text-label-13">
                    {f.requirements} requirements · {f.publisher}
                  </span>
                  <span className="text-copy-13 text-muted-foreground">{f.licence}</span>
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-label-13 flex w-fit items-center gap-1 underline-offset-2 hover:underline"
                  >
                    Source <ExternalLink className="size-3" aria-hidden />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </div>
                {canAdopt && !f.adopted ? (
                  <div className="shrink-0">
                    <AdoptFramework
                      org={org}
                      framework={{ key: f.key, version: f.version, title: f.title }}
                      controls={controlsSheets}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/** Archived folders (restored with their sheets), archived sheets, and the latest folder and sheet changes. */
async function ArchivedTab({
  db,
  org,
  orgId,
  nameOf,
  timeZone,
}: {
  db: ServerClient;
  org: string;
  orgId: string;
  nameOf: Map<string, string>;
  timeZone: string;
}) {
  const [folders, sheets, log] = await Promise.all([
    db.from('folders').select('id, name, archived_at').eq('org_id', orgId),
    db
      .from('sheets')
      .select('id, name, folder_id, archived_at')
      .eq('org_id', orgId)
      .is('parent_sheet_id', null)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false }),
    db
      .from('activity_log')
      .select('id, at, actor_kind, actor_id, action, old_value, new_value')
      .eq('org_id', orgId)
      .in('action', [...ORGANISE_ACTIONS])
      .order('id', { ascending: false })
      .limit(20),
  ]);
  if (folders.error || sheets.error || log.error)
    return (
      <Card title="Archived">
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="m-0">Archived folders and sheets could not be loaded.</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/${org}/settings?tab=archived`}>Retry</Link>
          </Button>
        </div>
      </Card>
    );
  const folderName = new Map((folders.data ?? []).map((f) => [f.id, f.name]));
  const archivedFolders = (folders.data ?? [])
    .filter((f) => f.archived_at)
    .sort((a, b) => (a.archived_at! < b.archived_at! ? 1 : -1));
  const sheetsOf = (f: { id: string; archived_at: string | null }) =>
    (sheets.data ?? [])
      .filter((s) => s.folder_id === f.id && s.archived_at === f.archived_at)
      .sort((a, b) => a.name.localeCompare(b.name));
  const withFolder = new Set(archivedFolders.flatMap((f) => sheetsOf(f).map((s) => s.id)));
  const loose = (sheets.data ?? []).filter((s) => !withFolder.has(s.id));
  return (
    <>
      <Card
        title="Archived folders"
        description="A folder is restored together with the sheets that were archived with it."
      >
        {archivedFolders.length === 0 ? (
          <p className="text-muted-foreground text-copy-13">No archived folders.</p>
        ) : (
          <ul className="divide-line flex flex-col divide-y" aria-label="Archived folders">
            {archivedFolders.map((f) => {
              const list = sheetsOf(f);
              return (
                <li
                  key={f.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium">{f.name}</span>
                    <span className="text-muted-foreground text-label-13">
                      Archived {formatDateTime(f.archived_at!, timeZone)} ·{' '}
                      {list.length === 0
                        ? 'no sheets'
                        : list.length === 1
                          ? '1 sheet'
                          : `${list.length} sheets`}
                      {list.length > 0 ? `: ${list.map((s) => s.name).join(', ')}` : ''}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <RestoreFolder org={org} folderId={f.id} name={f.name} />
                    {list.length === 0 ? (
                      <DeleteFolder org={org} folderId={f.id} name={f.name} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card
        title="Archived sheets"
        description="Sheets archived on their own. A sheet whose folder is archived comes back under Other sheets."
      >
        {loose.length === 0 ? (
          <p className="text-muted-foreground text-copy-13">No archived sheets.</p>
        ) : (
          <ul className="divide-line flex flex-col divide-y" aria-label="Archived sheets">
            {loose.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-muted-foreground text-label-13">
                    Archived {formatDateTime(s.archived_at!, timeZone)}
                    {s.folder_id
                      ? ` · from ${folderName.get(s.folder_id) ?? 'a deleted folder'}`
                      : ''}
                  </span>
                </div>
                <RestoreSheet org={org} sheetId={s.id} name={s.name} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title="Folder and sheet changes"
        description="The latest 20 entries of the activity log."
      >
        {(log.data ?? []).length === 0 ? (
          <p className="text-muted-foreground text-copy-13">No changes yet.</p>
        ) : (
          <ol
            className="divide-line m-0 flex list-none flex-col divide-y p-0"
            aria-label="Folder and sheet changes"
          >
            {(log.data ?? []).map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2">
                <span>
                  <span className="font-medium">
                    {e.actor_kind === 'user'
                      ? (e.actor_id && nameOf.get(e.actor_id)) || 'Former member'
                      : e.actor_kind === 'automation'
                        ? 'Automation'
                        : 'System'}
                  </span>{' '}
                  ·{' '}
                  {organiseText(
                    {
                      action: e.action,
                      oldValue: e.old_value as Json | null,
                      newValue: e.new_value as Json | null,
                    },
                    (id) => folderName.get(id),
                  )}
                </span>
                <span className="text-muted-foreground text-label-12-mono">
                  {formatDateTime(e.at, timeZone)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
