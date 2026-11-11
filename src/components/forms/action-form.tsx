'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useResultToast, type FormState } from './form-bits';
import type { Result } from '@/server/result';

type Action<T> = (state: FormState<T>, form: FormData) => Promise<Result<T>>;

/** A form bound to a command action: hidden inputs, toast on result, optional reset after success. */
export function ActionForm<T>({
  action,
  hidden,
  success,
  reset,
  resetOnFailure,
  onSuccess,
  className,
  children,
  'aria-label': ariaLabel,
}: {
  action: Action<T>;
  hidden: Record<string, string>;
  success?: string;
  reset?: boolean;
  /** Put controls back to their server value when the command fails (e.g. an auto-submitting select). */
  resetOnFailure?: boolean;
  onSuccess?: (data: T) => void;
  className?: string;
  children: React.ReactNode | ((state: FormState<T>) => React.ReactNode);
  'aria-label'?: string;
}) {
  const [state, formAction] = useActionState<FormState<T>, FormData>(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useResultToast(state, success);
  useEffect(() => {
    if (state?.ok) {
      if (reset) ref.current?.reset();
      onSuccess?.(state.data);
    } else if (state && resetOnFailure) {
      ref.current?.reset();
    }
  }, [state, reset, resetOnFailure, onSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} aria-label={ariaLabel} noValidate>
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {typeof children === 'function' ? children(state) : children}
    </form>
  );
}
