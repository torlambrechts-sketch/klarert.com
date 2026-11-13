import { notFound, redirect } from 'next/navigation';
import { appScreens } from '@/engine/apps/resolve';
import { getApps } from '@/server/apps/read';
import { requireMember } from '@/server/auth';

// An app opens on its first screen the person's role may see (docs/13).
export default async function AppPage({
  params,
}: {
  params: Promise<{ org: string; app: string }>;
}) {
  const { org, app: key } = await params;
  const { workspace, role } = await requireMember(org);
  const app = (await getApps(workspace.id, role)).find((a) => a.key === key);
  const first = app ? appScreens(app)[0] : undefined;
  if (!app || !first) notFound();
  redirect(`/${org}/apps/${app.key}/${first.key}`);
}
