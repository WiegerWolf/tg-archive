import { isLiveIngestActive } from '../../lib/format';

export function StatsBar({ totalDialogs, filteredCount, liveSyncCount, backfillingCount, agentState }: {
  totalDialogs: number;
  filteredCount: number;
  liveSyncCount: number;
  backfillingCount: number;
  agentState?: string;
}) {
  const liveActive = isLiveIngestActive(agentState);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400">
      <span><span className="font-semibold text-zinc-600">{filteredCount}</span> of {totalDialogs} dialogs</span>
      <span className="hidden sm:inline">·</span>
      <span className="hidden sm:inline">Live sync: <span className="font-semibold text-zinc-600">{liveSyncCount}</span></span>
      {backfillingCount > 0 && (
        <>
          <span>·</span>
          <span>Backfilling: <span className="font-semibold text-amber-600">{backfillingCount}</span></span>
        </>
      )}
      <span>·</span>
      <span className="inline-flex items-center gap-1">
        Agent: <span className={`h-1.5 w-1.5 rounded-full ${liveActive ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
        <span className={`font-semibold ${liveActive ? 'text-emerald-600' : 'text-zinc-500'}`}>{liveActive ? 'Live' : 'Offline'}</span>
      </span>
    </div>
  );
}
