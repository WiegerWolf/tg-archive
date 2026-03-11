import { Search, User, Users, Radio, Bot } from 'lucide-react';
import { Input } from '../ui/input';
import { SegmentedControl } from '../ui/segmented-control';

const statusOptions = [
  { value: 'active' as const, label: 'Active' },
  { value: 'archived' as const, label: 'Hidden' },
  { value: 'deleted' as const, label: 'Deleted' },
  { value: 'live_sync' as const, label: 'Live Sync' },
  { value: 'backfilled' as const, label: 'Backfilled' },
];

const typeOptions = [
  { value: 'all' as const, label: 'All' },
  { value: 'user' as const, label: <span className="inline-flex items-center gap-1"><User className="h-3 w-3" /><span className="hidden sm:inline">Users</span></span> },
  { value: 'group' as const, label: <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /><span className="hidden sm:inline">Groups</span></span> },
  { value: 'channel' as const, label: <span className="inline-flex items-center gap-1"><Radio className="h-3 w-3" /><span className="hidden sm:inline">Channels</span></span> },
  { value: 'bot' as const, label: <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" /><span className="hidden sm:inline">Bots</span></span> },
];

export function FilterBar({ query, onQueryChange, statusFilter, onStatusChange, typeFilter, onTypeChange }: {
  query: string;
  onQueryChange: (v: string) => void;
  statusFilter: 'active' | 'archived' | 'deleted' | 'live_sync' | 'backfilled';
  onStatusChange: (v: 'active' | 'archived' | 'deleted' | 'live_sync' | 'backfilled') => void;
  typeFilter: 'all' | 'user' | 'group' | 'channel' | 'bot';
  onTypeChange: (v: 'all' | 'user' | 'group' | 'channel' | 'bot') => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl options={statusOptions} value={statusFilter} onChange={(v) => { onStatusChange(v); onTypeChange('all'); }} />
        <SegmentedControl options={typeOptions} value={typeFilter} onChange={onTypeChange} />
      </div>
      <div className="relative w-full sm:w-80">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input className="pl-9" value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Filter dialogs by name, username, or ID" />
      </div>
    </div>
  );
}
