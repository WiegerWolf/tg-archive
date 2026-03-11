import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium leading-tight',
  {
    variants: {
      variant: {
        default: 'bg-zinc-100 text-zinc-600',
        success: 'bg-emerald-50 text-emerald-700',
        danger: 'bg-red-50 text-red-700',
        warning: 'bg-amber-50 text-amber-700',
        info: 'bg-indigo-50 text-indigo-700',
        muted: 'bg-zinc-100 text-zinc-500',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
