import * as React from 'react';
import { cn } from '../../lib/utils';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('rounded-xl bg-white p-5 shadow-sm ring-1 ring-zinc-900/5', className)}
    {...props}
  />
));
Card.displayName = 'Card';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn('text-base font-semibold tracking-tight text-zinc-900', className)} {...props} />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-zinc-500', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

export { Card, CardTitle, CardDescription };
