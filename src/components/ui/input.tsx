import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'border-input selection:bg-primary selection:text-primary-foreground file:text-foreground placeholder:text-muted-foreground bg-background-100 text-label-14 file:text-label-13 hover:border-line-strong disabled:text-muted-foreground h-[40px] w-full min-w-0 rounded-md border px-3 transition-[border-color,box-shadow] duration-150 outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-gray-100',
        // one focus ring for text inputs (UX-12): 2 px in the focus colour, not a border change alone
        'focus-visible:border-focus focus-visible:ring-focus focus-visible:ring-2',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
