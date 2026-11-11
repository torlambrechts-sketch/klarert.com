'use client';

import { useEffect, useId } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Result } from '@/server/result';

export type FormState<T = unknown> = Result<T> | null;

export function SubmitButton({
  children,
  pendingText,
  variant,
  size,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: React.ComponentProps<typeof Button>['variant'];
  size?: React.ComponentProps<typeof Button>['size'];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending} variant={variant} size={size}>
      {pending ? (pendingText ?? 'Saving…') : children}
    </Button>
  );
}

export function TextField({
  label,
  name,
  state,
  hint,
  ...props
}: { label: string; name: string; state: FormState; hint?: string } & React.ComponentProps<
  typeof Input
>) {
  const id = useId();
  const error = state && !state.ok ? state.error.fieldErrors?.[name] : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-crit text-sm">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Toast a failed command once per result (field errors show inline). */
export function useResultToast(state: FormState, success?: string) {
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      if (success) toast(success);
    } else if (!state.error.fieldErrors || state.error.code !== 'invalid') {
      toast.error(state.error.message);
    }
  }, [state, success]);
}

export function FormError({ state }: { state: FormState }) {
  if (!state || state.ok || state.error.code !== 'invalid' || !state.error.fieldErrors?._)
    return null;
  return (
    <p role="alert" className="text-crit text-sm">
      {state.error.fieldErrors._}
    </p>
  );
}
