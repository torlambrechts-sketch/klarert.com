import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

// Geist buttons (docs/05 Design system): primary black, secondary white with a 1 px border, tertiary (ghost)
// without one, error red. Sizes small 32, medium 40 (default), large 48. Colour, background and border ease over
// 150 ms and the button presses in to 98 %. Focus shows the global 2 px blue ring (globals.css).
const secondary =
  'border border-line bg-background-100 text-ink hover:bg-gray-100 aria-expanded:bg-gray-100 data-[state=open]:bg-gray-100';
const tertiary = 'text-ink hover:bg-gray-alpha-100 data-[state=open]:bg-gray-alpha-100';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-label-14 font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-brand-hover',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        outline: secondary,
        secondary,
        ghost: tertiary,
        tertiary,
        link: 'text-ink underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        default: 'h-[40px] px-[14px] has-[>svg]:px-[12px]',
        xs: "h-[24px] gap-1 rounded-sm px-[8px] text-label-12 has-[>svg]:px-[6px] [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-[32px] gap-1.5 px-[10px] has-[>svg]:px-[8px]',
        lg: 'h-[48px] px-[18px] text-label-16 has-[>svg]:px-[16px]',
        icon: 'size-[40px]',
        'icon-xs': "size-[24px] rounded-sm [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-[32px]',
        'icon-lg': 'size-[48px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
