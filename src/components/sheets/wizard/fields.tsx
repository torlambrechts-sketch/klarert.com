'use client';

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export const selectClass =
  'border-input h-9 w-full rounded-md border bg-surface px-2 text-13 outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus aria-invalid:border-destructive';

/** Labelled control with an error or hint line. */
export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: React.ReactNode;
  children: (props: {
    id: string;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
  }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-crit text-13">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-13">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  error,
  hint,
  wrapperClassName,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: React.ReactNode;
  wrapperClassName?: string;
} & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'>) {
  return (
    <Field label={label} error={error} hint={hint} className={wrapperClassName}>
      {(p) => <Input {...p} {...rest} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export type Folder = { id: string; name: string };

export function FolderSelect({
  folders,
  newFolder,
  value,
  onChange,
  error,
  name,
}: {
  folders: Folder[];
  /** A start's folder that does not exist yet: offered as "<name> (new folder)". */
  newFolder?: string | null;
  value: string;
  onChange?: (v: string) => void;
  error?: string;
  name?: string;
}) {
  return (
    <Field
      label="Folder"
      error={error}
      hint={newFolder && value === '__new__' ? 'Created with the sheet.' : undefined}
    >
      {(p) => (
        <select
          {...p}
          name={name}
          className={selectClass}
          value={onChange ? value : undefined}
          defaultValue={onChange ? undefined : value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        >
          {newFolder ? <option value="__new__">{newFolder} (new folder)</option> : null}
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
          <option value="">No folder</option>
        </select>
      )}
    </Field>
  );
}
