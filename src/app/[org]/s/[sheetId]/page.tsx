import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SheetView } from '@/components/grid/sheet-view';
import { requireMember } from '@/server/auth';
import { getSheet } from '@/server/repositories/sheets';

function defaultViewOf(settings: unknown): string | null {
  const id =
    settings && typeof settings === 'object' && 'defaultViewId' in settings
      ? (settings as { defaultViewId?: unknown }).defaultViewId
      : null;
  return typeof id === 'string' && /^[0-9a-z-]{4,36}$/.test(id) ? id : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string; sheetId: string }>;
}) {
  const { org, sheetId } = await params;
  const { workspace } = await requireMember(org);
  const sheet = await getSheet(workspace.id, sheetId);
  return { title: `${sheet?.name ?? 'Sheet'} · Compliance OS` };
}

// The sheet page (docs/05 §3): the view tabs and the active view (?view=, else the sheet's default view, else List).
export default async function SheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; sheetId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { org, sheetId } = await params;
  const { group } = await searchParams;
  const { workspace, role, user } = await requireMember(org);
  const sheet = await getSheet(workspace.id, sheetId);
  if (!sheet) notFound();
  const base = `/${org}/s/${sheet.id}`;
  return (
    <>
      {sheet.archived_at ? (
        <p
          role="status"
          className="border-warn/40 text-warn mx-4 mt-4 rounded-[var(--radius-card)] border bg-[#FFF8E6] px-3 py-2 text-sm sm:mx-6"
        >
          This sheet is archived. It is hidden from the side menu. Restore it in its settings.
        </p>
      ) : null}
      {sheet.groups.length > 1 ? (
        <nav aria-label="Groups" className="phone-only px-4 pt-4">
          <ul className="flex flex-wrap gap-2 text-sm">
            <li>
              <Link
                href={base}
                aria-current={!group ? 'page' : undefined}
                className="border-line aria-[current=page]:bg-ink rounded-full border px-3 py-1 aria-[current=page]:text-white"
              >
                All
              </Link>
            </li>
            {sheet.groups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`${base}?group=${g.id}`}
                  aria-current={group === g.id ? 'page' : undefined}
                  className="border-line aria-[current=page]:bg-ink rounded-full border px-3 py-1 aria-[current=page]:text-white"
                >
                  {g.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <SheetView
        org={org}
        sheetId={sheet.id}
        sheetName={sheet.name}
        userId={user.id}
        timeZone={workspace.time_zone}
        role={role}
        onlyGroup={group ?? null}
        defaultViewId={defaultViewOf(sheet.settings)}
      />
    </>
  );
}
