'use client';

import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/** On/off switch (role="switch"). Always pair it with a visible state word: colour is never the only signal. */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer data-[state=checked]:bg-brand focus-visible:outline-focus data-[state=unchecked]:bg-faint inline-flex h-[26px] w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-surface shadow-card pointer-events-none block size-5 rounded-full transition-transform duration-150 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
