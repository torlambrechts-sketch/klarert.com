import Link from 'next/link';
import { ArrowRight, Circle, CircleCheck, CircleDashed } from 'lucide-react';
import type { SetupProgress } from '@/engine/packs/setup';

// A pack's guided setup (docs/11 Setup): the steps, each with its own words, where to do it and its progress, all
// computed by the engine (setupProgress) from the workspace's data. Used on Workspace admin › Packs and, as a
// dismissible card, on Home. Status is never colour alone: each step has an icon and its words ("Done", "2 of 5").

const textLink =
  'text-ink text-label-13 inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline';

/** A bar with its value in words for assistive technology. */
function Bar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="bg-soft h-1.5 w-full overflow-hidden rounded"
    >
      <div
        className={value >= 1 ? 'bg-good h-full rounded' : 'bg-ink h-full rounded'}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SetupSummary({ progress }: { progress: SetupProgress }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label-13">
        <span className="font-medium tabular-nums">
          {progress.done} of {progress.total}
        </span>{' '}
        steps done · {progress.percent}%
      </span>
      <Bar value={progress.percent / 100} label={`${progress.title}: ${progress.percent}% done`} />
    </div>
  );
}

export function SetupSteps({
  org,
  progress,
  extraLinks = {},
}: {
  org: string;
  progress: SetupProgress;
  /** More links for the steps whose target is the given sheet id (the management review inputs). */
  extraLinks?: Record<string, { href: string; label: string }>;
}) {
  return (
    <ol
      className="divide-soft m-0 flex list-none flex-col divide-y p-0"
      aria-label={`${progress.title} steps`}
      data-testid="setup-steps"
    >
      {progress.steps.map((s) => {
        const href = s.link
          ? `/${org}/s/${s.link.sheetId}${s.link.viewId ? `?view=${s.link.viewId}` : ''}`
          : null;
        const Icon = s.done ? CircleCheck : s.progress > 0 ? CircleDashed : Circle;
        return (
          <li key={s.ref} className="flex gap-3 py-3" data-step={s.ref}>
            <Icon
              className={`mt-0.5 size-[18px] shrink-0 ${s.done ? 'text-good' : s.progress > 0 ? 'text-warn' : 'text-faint'}`}
              aria-hidden
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-label-14 font-medium">
                  <span className="text-muted-foreground tabular-nums">{s.number}.</span> {s.title}
                </span>
                <span className="text-label-12 text-muted-foreground tabular-nums">
                  {s.done
                    ? 'Done'
                    : s.progress > 0
                      ? `In progress · ${s.detail}`
                      : `To do · ${s.detail}`}
                </span>
              </span>
              <p className="text-copy-13 text-muted-foreground m-0">{s.body}</p>
              {!s.done && s.progress > 0 ? (
                <Bar value={s.progress} label={`${s.title}: ${Math.round(s.progress * 100)}%`} />
              ) : null}
              {href ? (
                <span className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link href={href} className={textLink}>
                    Open {s.link!.sheetName}
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                  {extraLinks[s.link!.sheetId] ? (
                    <Link href={extraLinks[s.link!.sheetId]!.href} className={textLink}>
                      {extraLinks[s.link!.sheetId]!.label}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  ) : null}
                </span>
              ) : (
                <span className="text-label-12 text-muted-foreground">
                  The sheet for this step is archived or not shared with you.
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
