import { AccessPanel } from '@/components/access/access-panel';
import { NoAccess } from '@/components/access/no-access';
import { canEdit as canEditLevel, toLevel } from '@/engine/access';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ArchivedItems } from '@/components/sheets/archived-items';
import { GroupsManager } from '@/components/sheets/groups-manager';
import { ArchiveSheet, SheetSettingsForm } from '@/components/sheets/sheet-settings';
import { DocumentsRegisterSetting } from '@/components/sheets/documents-register-setting';
import { GroupSwatch } from '@/components/sheets/group-swatch';
import { SheetFields } from '@/components/sheets/sheet-fields';
import { SheetTabsSettings } from '@/components/sheets/sheet-tabs-settings';
import { NewItemFormSetting } from '@/components/sheets/new-item-form-setting';
import { formAccess, formState } from '@/engine/views/form';
import { intakePlan } from '@/engine/views/new-item';
import { RetentionSettingsSection } from '@/components/sheets/retention-settings';
import { isPersonalField, readRetention, retentionDateFields } from '@/engine/retention';
import { SheetColumnGroups } from '@/components/table/column-groups-editor';
import { parseColumnGroups } from '@/engine/views/column-groups';
import { SubitemSettingsSection } from '@/components/subitems/subitem-settings';
import { WorkflowEditor } from '@/components/approvals/workflow-editor';
import { readWorkflows } from '@/engine/approvals/definition';
import { approvalRecordKeys } from '@/engine/documents';
import type { Sheet } from '@/engine/types';
import { fetchDirectory } from '@/lib/sheet-query';
import { applyTabLayout, buildTabs, toTabRows } from '@/components/views/tabs-model';
import { readSubitemSettings } from '@/engine/subitems';
import { normaliseViewId, readTabSettings } from '@/engine/views/tabs';
import { FIELD_COLUMNS, toField, toView } from '@/lib/sheet-rows';
import { isAdminRole, isEditorRole, requireMember } from '@/server/auth';
import {
  getArchivedItems,
  getFields,
  getNav,
  getSheet,
  getSheetAccess,
  getSubitemSheet,
  getViews,
} from '@/server/repositories/sheets';

export const metadata = { title: 'Sheet settings · Compliance OS' };

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

export default async function SheetSettingsPage({
  params,
}: {
  params: Promise<{ org: string; sheetId: string }>;
}) {
  const { org, sheetId } = await params;
  const { supabase, workspace, role: workspaceRole, user } = await requireMember(org);
  const [sheet, access] = await Promise.all([
    getSheet(workspace.id, sheetId),
    getSheetAccess(workspace.id, sheetId),
  ]);
  if (!sheet && access?.level === 'none') return <NoAccess org={org} name={access.name} />;
  if (!sheet) notFound();
  // the workspace role, narrowed by the sheet's access (docs/02 §16): without edit access, read only
  const role = canEditLevel(toLevel(access?.level)) ? workspaceRole : 'viewer';
  // a sub-item sheet is set up in its parent's settings (Sub-items)
  if (sheet.parent_sheet_id) redirect(`/${org}/s/${sheet.parent_sheet_id}/settings`);
  const [nav, fields, archivedItems, child, viewRows] = await Promise.all([
    getNav(workspace.id),
    getFields(sheet.id),
    getArchivedItems(sheet.id),
    getSubitemSheet(sheet.id),
    getViews(sheet.id),
  ]);
  const subSettings = (sheet.settings as { subitems?: unknown } | null)?.subitems;
  // retention (docs/02 §18): the fields with their settings (personal data, date results)
  const { data: retentionRows } = await supabase
    .from('fields')
    .select('key, name, type, config, restricted_to')
    .eq('sheet_id', sheet.id)
    .is('archived_at', null)
    .order('position');
  const retentionFields = (retentionRows ?? []).map((f) => ({ ...f, config: f.config ?? {} }));
  const dateKeys = new Set(retentionDateFields(retentionFields).map((f) => f.key));
  const archivedSubitems = child ? await getArchivedItems(child.id) : [];
  // approval workflows (docs/04 §13): the people, job roles and teams a step can name
  const directory = await fetchDirectory(supabase, workspace.id);
  const canEdit = isEditorRole(role);
  const tabSettings = readTabSettings(sheet.settings);
  const tabLayout = applyTabLayout(
    buildTabs(viewRows.map(toView), user.id, canEdit),
    tabSettings.tabs,
  );
  // the New item form (docs/05 §3.7): the sheet's forms, how many steps each would ask, closed or not
  const now = new Date();
  const { data: fullFields } = await supabase
    .from('fields')
    .select(FIELD_COLUMNS)
    .eq('sheet_id', sheet.id)
    .is('archived_at', null);
  const engineFields = (fullFields ?? []).map(toField);
  const formChoices = viewRows
    .map(toView)
    .filter((v) => v.type === 'form' && v.ownerId === null && v.config.form)
    .sort((a, b) => (a.position < b.position ? -1 : 1))
    .map((v) => {
      const form = v.config.form!;
      const steps = intakePlan({ id: v.id, name: v.name, form }, engineFields).steps.length;
      const state = formState(form, now, 0);
      return {
        id: v.id,
        name: v.name,
        summary: [
          formAccess(form) === 'public' ? 'Public' : 'Internal',
          steps > 1 ? `${steps} steps` : 'One page',
          state === 'draft' ? 'Draft' : state === 'closed' ? 'Closed' : 'Open',
        ].join(' · '),
        closed: state === 'closed',
        intake: form.intake === true,
      };
    });
  const newItemSetting = (sheet.settings as { newItemForm?: unknown } | null)?.newItemForm;

  return (
    <main className="flex w-full flex-col gap-5 px-4 pt-5 pb-8 sm:px-[28px] sm:pt-[26px]">
      <div className="flex flex-col gap-2">
        <Link
          href={`/${org}/s/${sheet.id}`}
          className="text-muted-foreground hover:text-ink text-label-13 flex w-fit items-center gap-1"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to {sheet.name}
        </Link>
        <h1>Sheet settings</h1>
        {!canEdit ? (
          <p className="text-muted-foreground">Viewers cannot change sheet settings.</p>
        ) : null}
      </div>

      {canEdit ? (
        <Card title="Sheet">
          <SheetSettingsForm
            org={org}
            folders={nav.folders.map((f) => ({ id: f.id, name: f.name }))}
            sheet={{
              id: sheet.id,
              name: sheet.name,
              description: sheet.description,
              itemLabel: sheet.item_label,
              idPrefix: sheet.id_prefix ?? '',
              prefixLocked: sheet.next_seq > 1,
              folderId: sheet.folder_id,
              isLibrary: sheet.is_library,
              holdAutomations:
                (sheet.settings as { holdAutomations?: boolean } | null)?.holdAutomations !== false,
              archived: !!sheet.archived_at,
            }}
          />
        </Card>
      ) : (
        <Card title="Sheet">
          <dl className="text-label-13 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{sheet.name}</dd>
            <dt className="text-muted-foreground">Items are called</dt>
            <dd>{sheet.item_label}</dd>
            <dt className="text-muted-foreground">ID prefix</dt>
            <dd className="font-mono">{sheet.id_prefix}</dd>
            <dt className="text-muted-foreground">Folder</dt>
            <dd>{sheet.folderName ?? 'No folder'}</dd>
          </dl>
        </Card>
      )}

      <Card
        title="Access"
        description="Who can see, comment on and edit this sheet. Restricted sheets are seen only by the people listed and the owners."
      >
        <AccessPanel
          org={org}
          target={{ kind: 'sheet', id: sheet.id, name: sheet.name }}
          timeZone={workspace.time_zone}
        />
      </Card>
      <Card title="Controlled documents">
        <DocumentsRegisterSetting
          org={org}
          sheetId={sheet.id}
          on={(sheet.settings as { register?: string } | null)?.register === 'documents'}
          canChange={isAdminRole(role) && !sheet.archived_at}
        />
      </Card>

      <section id="approvals" className="scroll-mt-4">
        <Card
          title="Approval workflows"
          description="Steps an item goes through to be approved: who approves each step, whether any one or all must, a time limit and what a rejection does. Every submission and decision is written to the item's activity log."
        >
          <WorkflowEditor
            org={org}
            sheetId={sheet.id}
            initial={readWorkflows(sheet.settings)}
            fields={(retentionRows ?? []).map((f) => ({
              key: f.key,
              name: f.name,
              type: f.type,
              options: Array.isArray((f.config as { options?: unknown } | null)?.options)
                ? ((f.config as { options: { id: string; label: string; done?: boolean }[] })
                    .options ?? [])
                : [],
              restricted: !!f.restricted_to,
            }))}
            people={directory.people.map((p) => ({ id: p.id, name: p.name }))}
            jobRoles={directory.jobRoles.map((r) => ({ id: r.id, name: r.name }))}
            teams={directory.teams.map((t) => ({ id: t.id, name: t.name }))}
            canEdit={isAdminRole(role) && !sheet.archived_at}
            recordKeys={approvalRecordKeys(sheet.settings as Pick<Sheet, 'register'> | null)}
          />
        </Card>
      </section>

      <section id="retention" className="scroll-mt-4">
        <Card
          title="Retention"
          description="How long this sheet keeps personal data. When a record's period ends it goes to Workspace admin › Retention, where an owner or admin approves the erasure, postpones it or places a legal hold."
        >
          <RetentionSettingsSection
            org={org}
            sheetId={sheet.id}
            initial={readRetention(sheet.settings)}
            fields={retentionFields.map((f) => ({
              key: f.key,
              name: f.name,
              personal: isPersonalField(f),
              date: dateKeys.has(f.key),
            }))}
            groups={sheet.groups.map((g) => ({ id: g.id, name: g.name }))}
            canEdit={isAdminRole(role) && !sheet.archived_at}
          />
        </Card>
      </section>

      <Card
        title="Groups"
        description="Groups are the sections of the sheet. Drag or use the arrows to reorder them."
      >
        {canEdit && !sheet.archived_at ? (
          <GroupsManager
            org={org}
            sheetId={sheet.id}
            groups={sheet.groups.map((g) => ({
              id: g.id,
              name: g.name,
              color: g.color,
              count: g.count,
            }))}
          />
        ) : (
          <ul className="flex flex-col gap-1" aria-label="Groups">
            {sheet.groups.map((g) => (
              <li key={g.id} className="flex items-center gap-2">
                <GroupSwatch color={g.color} /> {g.name}{' '}
                <span className="text-muted-foreground text-label-13">· {g.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Column groups"
        description="Sections of columns, such as Identify, Assess and Treat. A group's columns always sit together; each view can collapse a group into one narrow column."
      >
        {isAdminRole(role) && !sheet.archived_at ? (
          <SheetColumnGroups
            org={org}
            sheetId={sheet.id}
            fields={fields.map((f) => ({
              id: f.id,
              key: f.key,
              name: f.name,
              position: f.position,
            }))}
            groups={parseColumnGroups(
              (sheet.settings as { columnGroups?: unknown } | null)?.columnGroups,
              fields.map((f) => f.key),
            )}
          />
        ) : (
          <p className="text-muted-foreground text-copy-13">
            Only owners and admins can change column groups.
          </p>
        )}
      </Card>

      <section id="new-item" className="scroll-mt-4">
        <Card
          title="New item form"
          description="What “+ New”, Create › Entry and the N key ask when someone adds an item to this sheet."
        >
          <NewItemFormSetting
            org={org}
            sheetId={sheet.id}
            setting={
              newItemSetting === false || typeof newItemSetting === 'string' ? newItemSetting : null
            }
            forms={formChoices}
            canChange={isAdminRole(role) && !sheet.archived_at}
          />
        </Card>
      </section>

      <Card
        title="Tabs"
        description="The views everyone sees as tabs, their order and names. Hidden tabs stay in More and still open from links."
      >
        <SheetTabsSettings
          org={org}
          sheetId={sheet.id}
          rows={toTabRows(tabLayout.all)}
          defaultViewId={normaliseViewId(tabSettings.defaultViewId ?? 'table')}
          templateDefault={tabSettings.tabsDefault}
          canEdit={isAdminRole(role) && !sheet.archived_at}
        />
      </Card>

      <Card
        title={`Fields · ${fields.length}`}
        description="The columns every item of this sheet has. Edit a field to change its name, options and rules."
      >
        <SheetFields
          org={org}
          sheetId={sheet.id}
          userId={user.id}
          timeZone={workspace.time_zone}
          role={role}
          archived={!!sheet.archived_at}
        />
      </Card>

      <Card
        title="Sub-items"
        description="Steps under an item with their own fields, IDs and activity log, like the actions of a CAPA or the clauses of an audit."
      >
        <SubitemSettingsSection
          org={org}
          sheetId={sheet.id}
          userId={user.id}
          timeZone={workspace.time_zone}
          role={role}
          archived={!!sheet.archived_at}
          childSheetId={child?.id ?? null}
          settings={child && subSettings ? readSubitemSettings(subSettings) : null}
          dueKey={child?.dueKey ?? null}
        />
      </Card>

      {canEdit ? (
        <Card
          title={`Archived items · ${archivedItems.length}`}
          description="Archived items are hidden from views, search and automations. Restore one to bring it back."
        >
          <ArchivedItems org={org} sheetId={sheet.id} items={archivedItems} />
        </Card>
      ) : null}

      {canEdit && child && archivedSubitems.length > 0 ? (
        <Card
          title={`Archived ${readSubitemSettings(subSettings).label.toLowerCase()} · ${archivedSubitems.length}`}
          description="Restore one on its own, or restore its parent to bring back the ones archived with it."
        >
          <ArchivedItems org={org} sheetId={child.id} items={archivedSubitems} />
        </Card>
      ) : null}

      {isAdminRole(role) ? (
        <Card
          title={sheet.archived_at ? 'Archived' : 'Archive'}
          description={
            sheet.archived_at
              ? 'This sheet is hidden from the side menu. Restore it to use it again.'
              : 'Archiving hides the sheet from the side menu. Nothing is deleted.'
          }
        >
          <ArchiveSheet org={org} sheetId={sheet.id} archived={!!sheet.archived_at} />
        </Card>
      ) : null}
    </main>
  );
}
