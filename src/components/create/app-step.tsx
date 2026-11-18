'use client';

import { useEffect } from 'react';
import { AppWindow, ArrowRight, Check, Info, Layers } from 'lucide-react';
import { AppIcon } from '@/components/apps/app-icon';
import { Button } from '@/components/ui/button';
import type { AppStart, AppStartScreen } from '@/engine/create/apps';

// Create › App, step 2 (docs/05 §4 Create, docs/13): the apps a person can start, as a radio list, and the path to the
// chosen one. An app is part of a pack version, so the path is one of: open it (a live install carries it), create the
// set that brings it (the preview below is Solve a problem's, from the same manifest and planner), or Workspace admin ›
// Packs when its pack is set up here without it. What each state says comes from the pure appStarts (src/engine/create).

const KIND_WORD: Record<AppStartScreen['kind'], string> = {
  view: 'Sheet',
  item: 'List',
  form: 'Form',
  dashboard: 'Dashboard',
  workflow: 'Workflow',
};

const STATE_CHIP: Record<AppStart['state'], string | null> = {
  ready: 'Ready',
  new: null,
  update: 'Needs an update',
  incomplete: 'Set up in part',
  not_for_you: 'For other roles',
};

export function AppList({
  apps,
  appKey,
  onPick,
}: {
  apps: AppStart[];
  appKey: string | null;
  onPick: (key: string) => void;
}) {
  // side by side, the chosen app stays in sight in the list; on phones its preview comes first instead
  useEffect(() => {
    if (!appKey || !window.matchMedia('(min-width: 1000px)').matches) return;
    document
      .querySelector(`[data-testid="create-app-${appKey}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [appKey]);
  return (
    <section aria-labelledby="create-apps">
      <h2
        id="create-apps"
        data-step-heading
        tabIndex={-1}
        className="text-panel-title mb-1 outline-none"
      >
        Pick an app
      </h2>
      <p className="text-13 text-muted-foreground mb-3">
        An app gives the people who do one job their screens: report a problem, work on their
        actions, check the results.
      </p>
      {apps.length === 0 ? (
        <p className="border-line text-14 text-muted-foreground rounded-lg border border-dashed p-4">
          No apps are available in this workspace yet.
        </p>
      ) : (
        <ul role="radiogroup" aria-label="Apps" className="flex flex-col gap-2">
          {apps.map((a) => (
            <li key={a.key}>
              <button
                type="button"
                role="radio"
                aria-checked={a.key === appKey}
                onClick={() => onPick(a.key)}
                data-testid={`create-app-${a.key}`}
                className="border-line hover:border-line-strong aria-checked:border-ink aria-checked:bg-subtle flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-150 aria-checked:shadow-[inset_0_0_0_1px_var(--ink)]"
              >
                <AppIcon icon={a.icon} className="text-ink mt-0.5 size-5 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex w-full items-center gap-2">
                    <span className="text-14 min-w-0 flex-1 truncate font-medium">{a.title}</span>
                    {STATE_CHIP[a.state] ? (
                      <span className="bg-soft text-12 text-muted-foreground flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5">
                        {a.state === 'ready' ? <Check className="size-3" aria-hidden /> : null}
                        {STATE_CHIP[a.state]}
                      </span>
                    ) : null}
                  </span>
                  {a.description ? (
                    <span className="text-13 text-muted-foreground line-clamp-2">
                      {a.description}
                    </span>
                  ) : null}
                  <span className="text-12 text-muted-foreground">Comes with {a.packTitle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The chosen app: what it is, its screens, and the one way to get it working here. */
export function AppSummary({
  org,
  app,
  canInstall,
  onOpen,
  keptScreens,
  installsFirst,
  children,
}: {
  org: string;
  app: AppStart;
  canInstall: boolean;
  onOpen: (href: string) => void;
  /** Screens that stay with the parts ticked below (state `new`); null while the preview loads. */
  keptScreens: number | null;
  /** "Installs Core registers 1.3.0 (Full) first." (owners and admins, from the planner). */
  installsFirst: string[];
  /** The set's preview (state `new`). */
  children?: React.ReactNode;
}) {
  const total = app.sections.reduce((n, s) => n + s.screens.length, 0);
  const packs = `/${org}/settings?tab=packs`;
  return (
    <div className="flex flex-col gap-4" data-testid="create-app-preview">
      <div className="border-line flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex items-start gap-3">
          <span className="bg-soft flex size-9 shrink-0 items-center justify-center rounded-md">
            <AppIcon icon={app.icon} className="text-ink size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-panel-title">{app.title}</h3>
            {app.description ? (
              <p className="text-14 text-muted-foreground mt-1">{app.description}</p>
            ) : null}
          </div>
        </div>
        <p className="text-13 text-muted-foreground flex items-start gap-1.5">
          <AppWindow className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {app.state === 'ready'
              ? `Ready in this workspace with ${app.packTitle}.`
              : `Comes with the ready-made set ${app.packTitle} ${app.packVersion}.`}{' '}
            {app.for ? `For ${app.for}.` : 'For everyone in the workspace.'}
          </span>
        </p>
        {app.uses.length && app.state === 'new' ? (
          <p className="text-13 flex items-start gap-1.5" data-testid="create-app-uses">
            <Layers className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span>Uses sheets you already have: {app.uses.join(', ')}.</span>
          </p>
        ) : null}
        {app.state === 'new' && installsFirst.length ? (
          <p className="text-13 flex items-start gap-1.5" data-testid="create-installs-first">
            <Layers className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{installsFirst.join(' ')}</span>
          </p>
        ) : null}
        <div>
          <h4 className="text-13 text-muted-foreground mb-1.5 font-medium">
            {total === 1 ? '1 screen' : `${total} screens`}
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {app.sections.map((sec) => (
              <div key={sec.title}>
                <p className="text-13 font-medium">{sec.title}</p>
                <ul className="mt-1 flex flex-col gap-1" aria-label={`${sec.title} screens`}>
                  {sec.screens.map((sc) => (
                    <li key={sc.title} className="text-13">
                      {sc.title}
                      <span className="text-muted-foreground">
                        {' · '}
                        {KIND_WORD[sc.kind]}
                        {sc.reads ? ` on ${sc.reads}` : ''}
                        {sc.for ? ` (${sc.for})` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {app.state === 'ready' ? (
        <div className="border-line flex flex-col items-start gap-3 rounded-lg border p-4">
          <p className="text-14 flex items-center gap-1.5">
            <Check className="text-good size-4" aria-hidden /> {app.title} is ready here. Nothing to
            create.
          </p>
          <Button type="button" onClick={() => onOpen(`/${org}/apps/${app.key}`)}>
            Open {app.title} <ArrowRight aria-hidden />
          </Button>
        </div>
      ) : app.state === 'new' ? (
        <>
          {keptScreens === 0 ? (
            <p
              role="status"
              className="border-warn/40 bg-warn-soft text-14 flex items-start gap-2 rounded-lg border p-3"
              data-testid="create-app-empty"
            >
              <Info className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
              None of {app.title}&rsquo;s screens would work with these parts. Tick its sheets back
              to create it.
            </p>
          ) : null}
          {children}
        </>
      ) : (
        <div
          className="border-line flex flex-col items-start gap-3 rounded-lg border p-4"
          data-testid="create-app-elsewhere"
        >
          <p className="text-14">
            {app.state === 'update'
              ? `${app.packTitle} is set up here at ${app.installedVersion}. ${app.title} comes with ${app.packVersion}: update it in Workspace admin, Packs.`
              : app.state === 'incomplete'
                ? `${app.packTitle} is set up here without the parts ${app.title}’s screens need. Add them in Workspace admin, Packs.`
                : `${app.title} is set up here for ${app.for ?? 'other roles'}. Ask an owner or admin if you need it.`}
          </p>
          {app.state !== 'not_for_you' ? (
            canInstall ? (
              <Button type="button" variant="outline" onClick={() => onOpen(packs)}>
                Open Workspace admin, Packs
              </Button>
            ) : (
              <p className="text-13 text-muted-foreground">
                Only owners and admins update packs. Ask an admin.
              </p>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
