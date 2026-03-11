import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Option<T extends string> = {
  value: T;
  label: ReactNode;
};

export function SegmentedControl<T extends string>({ options, value, onChange, className }: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex rounded-lg bg-zinc-100 p-1', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150',
            value === option.value
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
