'use client';

import { useId } from 'react';
import { AppWindow, Info, Layers, Lock, ShieldAlert, Users } from 'lucide-react';
import {
  appsFor,
  selectionCounts,
  togglePart,
  type BundlePart,
  type PartKind,
} from '@/engine/packs/select';
import type { BundleDetails } from '@/server/commands/bundles';

// What a ready-made set creates (docs/05 §4 Create), from the same manifest the install plans: counts, who can see it,
// the safety flags (public forms, anything sent out of the workspace) and every part with a tick box. Unticking a
// part leaves out what needs it, said in a note.

const GROUPS: { kind: PartKind; title: string }[] = [
  { kind: 'sheet', title: 'Sheets' },
  { kind: 'form', title: 'Forms' },
  { kind: 'automation', title: 'Automations' },
  { kind: 'dashboard', title: 'Dashboards' },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function BundlePreview({
  details,
  excluded,
  onChange,
  note,
  canInstall,
}: {
  details: BundleDetails;
  excluded: string[];
  onChange: (excluded: string[], note: string | null) => void;
  note: string | null;
  canInstall: boolean;
}) {
  const id = useId();
  const off = new Set(excluded);
  const c = selectionCounts(details.parts, excluded);
  const apps = appsFor(details.apps, excluded);
  const kept = details.parts.filter((p) => !off.has(p.id));
  const flagged = kept.filter((p) => p.flags.some((f) => f.kind !== 'restricted'));
  const restricted = kept.filter((p) => p.flags.some((f) => f.kind === 'restricted'));
  // a set on registers the workspace has makes no sheet of its own (CAPA on Core's register): no "0 sheets"
  const ownSheets = c.sheets > 0 || details.uses.length === 0;
  const summary = [
    ownSheets && plural(c.sheets, 'sheet'),
    ownSheets && plural(c.fields, 'field'),
    c.forms && plural(c.forms, 'form'),
    c.automations && plural(c.automations, 'automation'),
    c.dashboards && plural(c.dashboards, 'dashboard'),
    apps.length && plural(apps.length, 'app'),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4" data-testid="create-preview">
      <div className="border-line rounded-lg border p-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-panel-title">{details.title}</h3>
          <span className="text-12 text-muted-foreground font-mono">{details.version}</span>
          {details.level ? (
            <span className="bg-soft text-12 rounded-full px-2 py-0.5">{details.level.name}</span>
          ) : null}
        </div>
        <p className="text-14 mt-2" data-testid="create-summary">
          Creates {summary.join(' · ')}.
        </p>
        {details.uses.length ? (
          <p className="text-13 mt-1 flex items-start gap-1.5" data-testid="create-uses">
            <Layers className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Works on sheets you already have: {details.uses.join(', ')}.
              {c.sheets === 0 ? ' No second sheet is made.' : ''}
            </span>
          </p>
        ) : null}
        <p className="text-13 text-muted-foreground mt-2 flex items-start gap-1.5">
          <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {restricted.length
              ? `Who can see it: everyone in the workspace, except ${restricted.map((p) => p.name).join(', ')} (only you and the owners until you share it).`
              : 'Who can see it: everyone in the workspace, as for any sheet. Change it later with Access.'}
          </span>
        </p>
        {details.frameworks.length ? (
          <p className="text-13 text-muted-foreground mt-1 flex items-start gap-1.5">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Adds the requirement library it builds on when the workspace has not got it yet.
            </span>
          </p>
        ) : null}
        <p className="text-13 text-muted-foreground mt-1">
          Nothing is created until you press Create.
        </p>
      </div>

      {flagged.length ? (
        <section
          aria-labelledby={`${id}-safety`}
          className="border-warn/40 bg-warn-soft rounded-lg border p-4"
          data-testid="create-flags"
        >
          <h3
            id={`${id}-safety`}
            className="text-14 text-warn flex items-center gap-1.5 font-semibold"
          >
            <ShieldAlert className="size-4" aria-hidden /> Off until someone checks it
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {flagged.map((p) => (
              <li key={p.id} className="text-13">
                <span className="font-medium">{p.name}</span>
                {p.sheet ? <span className="text-muted-foreground"> · {p.sheet}</span> : null}
                {p.flags
                  .filter((f) => f.kind !== 'restricted')
                  .map((f) => (
                    <span key={f.kind} className="block">
                      {f.text}
                    </span>
                  ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p aria-live="polite" className="text-13 empty:hidden" data-testid="create-note">
        {note}
      </p>

      {details.check?.state === 'blocked' ? (
        <div role="alert" className="border-crit/40 bg-crit-soft text-13 rounded-lg border p-3">
          This set cannot be created here: {details.check.conflicts.join(' ')}
        </div>
      ) : null}
      {details.check && (details.check.warnings.length || details.check.renamedPrefixes.length) ? (
        <ul className="text-13 text-muted-foreground flex flex-col gap-1">
          {details.check.renamedPrefixes.map((r) => (
            <li key={r.sheet}>
              {r.sheet} uses the ID prefix {r.to}: {r.from} is taken here.
            </li>
          ))}
          {details.check.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <PartPicker parts={details.parts} excluded={excluded} onChange={onChange}>
        {details.apps.length ? (
          <section className="border-line rounded-lg border p-3" aria-label="Apps">
            <h4 className="text-13 text-muted-foreground px-1 font-medium">Apps</h4>
            <ul className="mt-1 flex flex-col gap-1">
              {details.apps.map((a) => {
                const left = apps.find((x) => x.title === a.title);
                return (
                  <li key={a.title} className="flex items-start gap-2.5 p-1.5">
                    <AppWindow className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      <span className="text-14 block">{a.title}</span>
                      <span className="text-12 text-muted-foreground">
                        {left
                          ? `${plural(left.screens, 'screen')} in the side menu`
                          : 'Not shown: the parts it needs are left out'}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </PartPicker>

      {!canInstall ? (
        <p
          role="note"
          className="border-line bg-subtle text-14 rounded-lg border p-3"
          data-testid="ask-admin"
        >
          Only owners and admins can create ready-made sets. Ask an admin to create it for you, or
          start a sheet of your own.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The parts of a pack with a tick box each (docs/05 §4 Create, docs/11 Your own packs): unticking a part leaves out
 * what needs it (togglePart), and the note says so. Children follow the groups (Create adds the apps).
 */
export function PartPicker({
  parts,
  excluded,
  onChange,
  children,
}: {
  parts: BundlePart[];
  excluded: string[];
  onChange: (excluded: string[], note: string | null) => void;
  children?: React.ReactNode;
}) {
  const off = new Set(excluded);
  const neededBy = (p: BundlePart) =>
    parts.filter((x) => x.kind === 'sheet' && x.requires.includes(p.id) && !off.has(x.id));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {GROUPS.map((g) => {
        const list = parts.filter((p) => p.kind === g.kind);
        if (!list.length) return null;
        return (
          <fieldset key={g.kind} className="border-line rounded-lg border p-3">
            <legend className="text-13 text-muted-foreground px-1 font-medium">{g.title}</legend>
            <ul className="flex flex-col gap-1">
              {list.map((p) => {
                const on = !off.has(p.id);
                const needers = g.kind === 'sheet' ? neededBy(p) : [];
                return (
                  <li key={p.id}>
                    <label className="hover:bg-subtle flex cursor-pointer items-start gap-2.5 rounded-md p-1.5">
                      <input
                        type="checkbox"
                        checked={on}
                        data-testid={`part-${p.id}`}
                        onChange={(e) => {
                          const s = togglePart(parts, excluded, p.id, e.target.checked);
                          onChange(s.excluded, s.note);
                        }}
                        className="mt-[3px] size-4 shrink-0 accent-[var(--ink)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-14 flex items-center gap-1.5">
                          <span className={on ? '' : 'text-muted-foreground line-through'}>
                            {p.name}
                          </span>
                          {p.flags.some((f) => f.kind === 'restricted') ? (
                            <Lock className="size-3.5" aria-label="Restricted" />
                          ) : null}
                          {p.flags.some((f) => f.kind !== 'restricted') ? (
                            <ShieldAlert
                              className="text-warn size-3.5"
                              aria-label="Off until checked"
                            />
                          ) : null}
                        </span>
                        <span className="text-12 text-muted-foreground block">
                          {[p.sheet, p.detail].filter(Boolean).join(' · ')}
                          {needers.length
                            ? ` · needed by ${needers.map((x) => x.name).join(', ')}`
                            : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
      {children}
    </div>
  );
}
