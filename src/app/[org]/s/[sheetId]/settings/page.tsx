import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ArchivedItems } from '@/components/sheets/archived-items';
import { GroupsManager } from '@/components/sheets/groups-manager';
import { ArchiveSheet, SheetSettingsForm } from '@/components/sheets/sheet-settings';
import { GroupSwatch } from '@/components/sheets/group-swatch';
import { SheetFields } from '@/components/sheets/sheet-fields';
import { isEditorRole, requireMember } from '@/server/auth';
import { getArchivedItems, getFields, getNav, getSheet } from '@/server/repositories/sheets';

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
    <section className="border-line flex flex-col gap-4 rounded-xl border bg-white p-5 shadow-xs sm:px-[22px]">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
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
  const { workspace, role, user } = await requireMember(org);
  const sheet = await getSheet(workspace.id, sheetId);
  if (!sheet) notFound();
  const [nav, fields, archivedItems] = await Promise.all([
    getNav(workspace.id),
    getFields(sheet.id),
    getArchivedItems(sheet.id),
  ]);
  const canEdit = isEditorRole(role);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-7 sm:pt-[26px]">
      <div className="flex flex-col gap-2">
        <Link
          href={`/${org}/s/${sheet.id}`}
          className="text-muted-foreground hover:text-ink flex w-fit items-center gap-1 text-sm"
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
              idPrefix: sheet.id_prefix,
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
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
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
                <span className="text-muted-foreground text-sm">· {g.count}</span>
              </li>
            ))}
          </ul>
        )}
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

      {canEdit ? (
        <Card
          title={`Archived items · ${archivedItems.length}`}
          description="Archived items are hidden from views, search and automations. Restore one to bring it back."
        >
          <ArchivedItems org={org} sheetId={sheet.id} items={archivedItems} />
        </Card>
      ) : null}

      {canEdit ? (
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
