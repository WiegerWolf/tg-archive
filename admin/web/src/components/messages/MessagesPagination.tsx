import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { pageWindow } from '../../lib/format';

export function MessagesPagination({ current, total, onNavigate }: {
  current: number;
  total: number;
  onNavigate: (page: number) => void;
}) {
  if (total <= 1) return null;

  return (
    <div className="mt-5 flex items-center justify-center gap-1.5">
      <Button variant="outline" size="icon" disabled={current <= 1} onClick={() => onNavigate(current - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {pageWindow(current, total).map((page) => (
        <button
          key={page}
          onClick={() => onNavigate(page)}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium transition-colors ${page === current ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}
        >
          {page}
        </button>
      ))}
      <Button variant="outline" size="icon" disabled={current >= total} onClick={() => onNavigate(current + 1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
