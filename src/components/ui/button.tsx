import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

// Keptrow buttons (docs/18 §5): pills. Default 44 px with a 2 px --brand border, 15 px 600; primary filled --brand
// with white words; secondary (outline) white with --brand words; sm 40 px and xs 32 px with a 1 px border; danger
// --bad border and words; link --brand 600; ghost (tertiary) without a border. Colour eases over 150 ms and the
// button presses in to 98 %. Focus shows the global 3 px ring (globals.css).
const secondary =
  'border-2 border-brand bg-surface text-brand hover:bg-panel aria-expanded:bg-brand-soft data-[state=open]:bg-brand-soft';
const tertiary =
  'text-navy hover:bg-panel aria-expanded:bg-brand-soft data-[state=open]:bg-brand-soft';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full text-15 font-semibold whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'border-2 border-brand bg-brand text-primary-foreground hover:border-navy hover:bg-navy',
        destructive: 'border-2 border-bad bg-surface text-bad hover:bg-badge-red-bg',
        outline: secondary,
        secondary,
        ghost: tertiary,
        tertiary,
        link: 'text-brand underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        default: 'h-11 px-5 has-[>svg]:px-4',
        xs: "h-8 gap-1 px-3 text-13 [&_svg:not([class*='size-'])]:size-3.5",
        sm: 'h-10 gap-1.5 px-4 text-14 has-[>svg]:px-3.5',
        lg: 'h-12 px-6 text-16 has-[>svg]:px-5',
        icon: 'size-11',
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-12',
      },
    },
    compoundVariants: [
      // the smaller pills carry a 1 px border (docs/18 §5)
      {
        variant: ['default', 'destructive', 'outline', 'secondary'],
        size: ['sm', 'xs', 'icon', 'icon-sm', 'icon-xs'],
        class: 'border',
      },
    ],
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
