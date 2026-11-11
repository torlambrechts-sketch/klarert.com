import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Settings } from 'lucide-react';
import { GroupBlocks } from '@/components/sheets/group-blocks';
import { Button } from '@/components/ui/button';
import { requireMember } from '@/server/auth';
import { getGroupItems, getSheet } from '@/server/repositories/sheets';

const PREVIEW = 25;

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

export default async function SheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; sheetId: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { org, sheetId } = await params;
  const { group } = await searchParams;
  const { workspace } = await requireMember(org);
  const sheet = await getSheet(workspace.id, sheetId);
  if (!sheet) notFound();
  const shown = group ? sheet.groups.filter((g) => g.id === group) : sheet.groups;
  const items = await getGroupItems(
    sheet.id,
    shown.filter((g) => g.count > 0).map((g) => g.id),
    PREVIEW,
  );
  const base = `/${org}/s/${sheet.id}`;
  return (
    <main className="flex flex-col gap-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="break-words">{sheet.name}</h1>
          <p className="text-muted-foreground text-sm">
            {sheet.total === 1 ? '1 item' : `${sheet.total.toLocaleString('en-GB')} items`} · ids{' '}
            <span className="font-mono">{sheet.id_prefix}001</span>
            {sheet.description ? ` · ${sheet.description}` : ''}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`${base}/settings`}>
            <Settings aria-hidden /> Sheet settings
          </Link>
        </Button>
      </div>
      {sheet.archived_at ? (
        <p
          role="status"
          className="border-warn/40 text-warn rounded-[var(--radius-card)] border bg-[#FFF8E6] px-3 py-2 text-sm"
        >
          This sheet is archived. It is hidden from the side menu. Restore it in its settings.
        </p>
      ) : null}
      {group ? (
        <p className="phone-only text-sm">
          <Link className="text-focus underline" href={base}>
            Show all groups
          </Link>
        </p>
      ) : null}
      {sheet.groups.length > 1 ? (
        <nav aria-label="Groups" className="phone-only">
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
      {shown.length === 0 ? (
        <p className="text-muted-foreground">
          This group no longer exists.{' '}
          <Link className="text-focus underline" href={base}>
            Show all groups
          </Link>
        </p>
      ) : (
        <GroupBlocks
          itemLabel={sheet.item_label}
          groups={shown.map((g) => ({ ...g, items: [...(items.get(g.id) ?? [])] }))}
        />
      )}
    </main>
  );
}
