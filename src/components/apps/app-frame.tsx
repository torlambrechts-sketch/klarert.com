import Link from 'next/link';
import { ListCrumb } from '@/components/shell/data-list';
import { PageTabs } from '@/components/shell/page-header';
import { ShellCrumb } from '@/components/shell/shell-crumb';
import { appScreens, type ResolvedApp } from '@/engine/apps/resolve';
import { AppIcon } from './app-icon';

// An app's frame (docs/13): the app's name, a link to its design, and its screens as underline tabs (they scroll sideways on a phone), then
// the screen. The crumb in the top strip reads "Apps / <app>".
export function AppFrame({
  org,
  app,
  active,
  crumb = true,
  children,
}: {
  org: string;
  app: ResolvedApp;
  active: string;
  /** Off when the screen sets its own crumb (a sheet). */
  crumb?: boolean;
  children: React.ReactNode;
}) {
  const tabs = appScreens(app).map((s) => ({
    id: s.key,
    label: s.title,
    href: `/${org}/apps/${app.key}/${s.key}`,
  }));
  return (
    <div className="flex min-w-0 flex-col" data-app={app.key}>
      {crumb ? (
        <ShellCrumb>
          <div className="text-muted-foreground text-label-14 flex min-w-0 items-center gap-2.5">
            <ListCrumb section="Apps" page={app.title} />
          </div>
        </ShellCrumb>
      ) : null}
      <div className="px-4 pt-4 sm:px-[28px] sm:pt-5">
        <p className="text-muted-foreground text-label-13 m-0 flex flex-wrap items-center gap-1.5 font-medium">
          <AppIcon icon={app.icon} className="size-[15px]" />
          {app.title}
          {/* the app's sheets and how they connect (Platform › Design filtered by app, docs/05 §4) */}
          <Link
            href={`/${org}/design?app=${encodeURIComponent(app.key)}`}
            className="text-info ml-auto font-normal underline-offset-2 hover:underline"
          >
            How this app is built
          </Link>
        </p>
        <PageTabs label={`${app.title} screens`} tabs={tabs} active={active} />
      </div>
      {children}
    </div>
  );
}
