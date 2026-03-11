import { Skeleton } from '../ui/skeleton';

export function DialogCardSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white p-3.5 shadow-sm ring-1 ring-zinc-900/5">
      <Skeleton className="h-12 w-12 flex-shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
    </div>
  );
}
