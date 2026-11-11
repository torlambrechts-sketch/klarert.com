'use client';

import { useActionState, useMemo, useState } from 'react';
import {
  SubmitButton,
  TextField,
  useResultToast,
  type FormState,
} from '@/components/forms/form-bits';
import { Label } from '@/components/ui/label';
import { initialsFor, slugify } from '@/lib/naming';
import { PROFILE_COLORS } from '@/lib/schemas/workspace';
import { createWorkspaceAction, saveProfileAction } from './actions';

export function ProfileForm({ email, next }: { email: string; next?: string }) {
  const [state, action] = useActionState<FormState, FormData>(saveProfileAction, null);
  useResultToast(state);
  const suggested = email
    .split('@')[0]!
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const [name, setName] = useState(suggested);
  const [initials, setInitials] = useState(initialsFor(suggested));
  const [touched, setTouched] = useState(false);
  const [color, setColor] = useState<(typeof PROFILE_COLORS)[number]>('blue');

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <TextField
        label="Your name"
        name="displayName"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!touched) setInitials(initialsFor(e.target.value));
        }}
        autoComplete="name"
        required
        state={state}
      />
      <TextField
        label="Initials"
        name="initials"
        value={initials}
        onChange={(e) => {
          setTouched(true);
          setInitials(e.target.value.toUpperCase());
        }}
        maxLength={3}
        hint="Shown on your avatar."
        state={state}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">Avatar colour</legend>
        <input type="hidden" name="color" value={color} />
        <div className="flex flex-wrap gap-2">
          {PROFILE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-pressed={color === c}
              aria-label={c}
              title={c}
              className="flex size-9 items-center justify-center rounded-full text-xs font-bold text-white ring-offset-2 aria-pressed:ring-2 aria-pressed:ring-[var(--ink)]"
              style={{ background: `var(--label-${c})` }}
            >
              {color === c ? initials || '·' : ''}
            </button>
          ))}
        </div>
      </fieldset>
      <SubmitButton>Continue</SubmitButton>
    </form>
  );
}

export function CreateWorkspaceForm({ defaultTimeZone }: { defaultTimeZone: string }) {
  const [state, action] = useActionState<FormState, FormData>(createWorkspaceAction, null);
  useResultToast(state);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const zones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const [zone, setZone] = useState(() => {
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zones.includes(guess) ? guess : defaultTimeZone;
  });

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <TextField
        label="Workspace name"
        name="name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (!slugTouched) setSlug(slugify(e.target.value));
        }}
        placeholder="Meridian Components Ltd"
        required
        state={state}
      />
      <TextField
        label="Web address"
        name="slug"
        value={slug}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value.toLowerCase());
        }}
        hint={
          slug ? `Your workspace will live at /${slug}` : 'Lowercase letters, digits and hyphens.'
        }
        required
        state={state}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="timeZone">Time zone</Label>
        <select
          id="timeZone"
          name="timeZone"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          className="border-input h-9 rounded-md border bg-white px-3"
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </div>
      <SubmitButton pendingText="Creating…">Create workspace</SubmitButton>
    </form>
  );
}
