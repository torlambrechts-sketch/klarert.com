import Link from 'next/link';
import { GroupSwatch } from '@/components/sheets/group-swatch';
import { NewGroupForm } from '@/components/sheets/new-group-form';
import { cn } from '@/lib/utils';
import { isEditorRole, requireMember } from '@/server/auth';
import { getSheet } from '@/server/repositories/sheets';

/** Second panel on a sheet (docs/05 §2.2): folder, sheet name, All items, one row per group, + New group. */
export async function SheetPanel({
  org,
  sheetId,
  activeGroup,
}: {
  org: string;
  sheetId: string;
  activeGroup: string | null;
}) {
  const { workspace, role } = await requireMember(org);
  const sheet = await getSheet(workspace.id, sheetId);
  if (!sheet) return null;
  const base = `/${org}/s/${sheet.id}`;
  const row = 'flex items-center gap-2 rounded-md px-2 py-1.5';
  return (
    <div className="flex flex-col gap-2 px-3">
      <div className="px-2">
        {sheet.folderName ? (
          <p className="text-muted-foreground text-[11px] font-bold tracking-wide uppercase">
            {sheet.folderName}
          </p>
        ) : null}
        <h2 className="text-[17px] font-extrabold break-words">{sheet.name}</h2>
      </div>
      <nav aria-label="Groups">
        <ul className="flex flex-col gap-0.5">
          <li>
            <Link
              href={base}
              aria-current={!activeGroup ? 'page' : undefined}
              className={cn(row, 'font-semibold', !activeGroup ? 'bg-yel' : 'hover:bg-yel/40')}
            >
              <span className="flex-1">All items</span>
              <span className="text-muted-foreground tabular-nums">{sheet.total}</span>
            </Link>
          </li>
          {sheet.groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`${base}?group=${g.id}`}
                aria-current={activeGroup === g.id ? 'page' : undefined}
                className={cn(row, activeGroup === g.id ? 'bg-yel' : 'hover:bg-yel/40')}
              >
                <GroupSwatch color={g.color} />
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <span className="text-muted-foreground tabular-nums">{g.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {isEditorRole(role) && !sheet.archived_at ? (
        <NewGroupForm org={org} sheetId={sheet.id} compact />
      ) : null}
    </div>
  );
}
