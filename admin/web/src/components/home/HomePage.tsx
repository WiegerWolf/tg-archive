import { useEffect, useMemo, useState } from 'react';
import { SearchX } from 'lucide-react';
import type { Dialog } from '../../types';
import type { DialogActivityItem } from '@shared/api';
import { FilterBar } from './FilterBar';
import { DialogCard } from './DialogCard';
import { DialogCardSkeleton } from './DialogCardSkeleton';
import { StatsBar } from '../layout/StatsBar';
import { Button } from '../ui/button';

export function HomePage({ dialogs, filteredDialogs, loading, query, onQueryChange, statusFilter, onStatusChange, typeFilter, onTypeChange, liveSyncChatIds, isLiveSyncSelected, dialogActivity, backfillingCount, agentState, recentBackfillRequesting, globalBackfillFeedback, liveSyncFeedback, syncConfigSaving, onRequestRecentBackfill, onBulkLiveSyncChange }: {
  dialogs: Dialog[];
  filteredDialogs: Dialog[];
  loading: boolean;
  query: string;
  onQueryChange: (v: string) => void;
  statusFilter: 'active' | 'archived' | 'deleted' | 'live_sync' | 'backfilled';
  onStatusChange: (v: 'active' | 'archived' | 'deleted' | 'live_sync' | 'backfilled') => void;
  typeFilter: 'all' | 'user' | 'group' | 'channel' | 'bot';
  onTypeChange: (v: 'all' | 'user' | 'group' | 'channel' | 'bot') => void;
  liveSyncChatIds: string[];
  isLiveSyncSelected: (chatId: string) => boolean;
  dialogActivity: (chatId: string) => DialogActivityItem | undefined;
  backfillingCount: number;
  agentState?: string;
  recentBackfillRequesting: boolean;
  globalBackfillFeedback: { message: string; tone: 'success' | 'info' | 'danger' } | null;
  liveSyncFeedback: { message: string; tone: 'success' | 'info' | 'danger' } | null;
  syncConfigSaving: boolean;
  onRequestRecentBackfill: () => void | Promise<void>;
  onBulkLiveSyncChange: (chatIds: string[], enabled: boolean) => Promise<boolean>;
}) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);

  const feedbackClassName = globalBackfillFeedback?.tone === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : globalBackfillFeedback?.tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-zinc-200 bg-zinc-50 text-zinc-700';

  const liveSyncFeedbackClassName = liveSyncFeedback?.tone === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : liveSyncFeedback?.tone === 'danger'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-zinc-200 bg-zinc-50 text-zinc-700';

  const visibleChatIds = useMemo(() => filteredDialogs.map((entry) => entry.tgDialogId), [filteredDialogs]);
  const dialogIdSet = useMemo(() => new Set(dialogs.map((entry) => entry.tgDialogId)), [dialogs]);
  const selectedSet = useMemo(() => new Set(selectedChatIds), [selectedChatIds]);
  const visibleSelectedCount = useMemo(
    () => visibleChatIds.reduce((count, chatId) => count + (selectedSet.has(chatId) ? 1 : 0), 0),
    [visibleChatIds, selectedSet],
  );

  useEffect(() => {
    setSelectedChatIds((current) => current.filter((chatId) => dialogIdSet.has(chatId)));
  }, [dialogIdSet]);

  function toggleSelectionMode() {
    if (selectionMode) {
      setSelectedChatIds([]);
      setSelectionMode(false);
      return;
    }
    setSelectionMode(true);
  }

  function toggleChatSelection(chatId: string) {
    setSelectedChatIds((current) => (
      current.includes(chatId)
        ? current.filter((id) => id !== chatId)
        : [...current, chatId]
    ));
  }

  function selectVisibleChats() {
    setSelectedChatIds((current) => {
      const next = new Set(current);
      for (const chatId of visibleChatIds) {
        next.add(chatId);
      }
      return Array.from(next);
    });
  }

  function clearVisibleChats() {
    if (visibleChatIds.length === 0) return;
    const visibleSet = new Set(visibleChatIds);
    setSelectedChatIds((current) => current.filter((chatId) => !visibleSet.has(chatId)));
  }

  async function applyBulkLiveSync(enabled: boolean) {
    const ok = await onBulkLiveSyncChange(selectedChatIds, enabled);
    if (!ok) return;
    setSelectedChatIds([]);
    setSelectionMode(false);
  }

  return (
    <div className="animate-fade-in space-y-5">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Dialogs</h1>
            <div className="mt-1">
              <StatsBar
                totalDialogs={dialogs.length}
                filteredCount={filteredDialogs.length}
                liveSyncCount={liveSyncChatIds.length}
                backfillingCount={backfillingCount}
                agentState={agentState}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={selectionMode ? 'secondary' : 'outline'}
              size="sm"
              onClick={toggleSelectionMode}
              disabled={syncConfigSaving}
              className="shrink-0"
            >
              {selectionMode ? 'Cancel Selection' : 'Select Chats'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={onRequestRecentBackfill}
              disabled={recentBackfillRequesting || syncConfigSaving || liveSyncChatIds.length === 0}
              className="shrink-0"
              title={liveSyncChatIds.length === 0 ? 'Select live-sync chats first' : 'Queue a 7-day gap fill for every live-sync chat'}
            >
              {recentBackfillRequesting ? 'Queueing 7d Backfill...' : 'Backfill Last 7 Days'}
            </Button>
          </div>
        </div>

        {selectionMode && (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  {selectedChatIds.length} chats selected
                  {visibleSelectedCount !== selectedChatIds.length ? ` · ${visibleSelectedCount} visible` : ''}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Click cards to build a custom batch. Enabling live sync may queue backfill for newly selected chats.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectVisibleChats} disabled={syncConfigSaving || visibleChatIds.length === 0}>
                  Select Visible
                </Button>
                <Button variant="outline" size="sm" onClick={clearVisibleChats} disabled={syncConfigSaving || selectedChatIds.length === 0}>
                  Clear Visible
                </Button>
                <Button size="sm" onClick={() => void applyBulkLiveSync(true)} disabled={syncConfigSaving || selectedChatIds.length === 0}>
                  {syncConfigSaving ? 'Saving...' : 'Apply Live Sync'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => void applyBulkLiveSync(false)} disabled={syncConfigSaving || selectedChatIds.length === 0}>
                  Remove Live Sync
                </Button>
              </div>
            </div>
          </div>
        )}

        {liveSyncFeedback && (
          <div className={`rounded-xl border px-3 py-2 text-sm ${liveSyncFeedbackClassName}`}>
            {liveSyncFeedback.message}
          </div>
        )}

        {globalBackfillFeedback && (
          <div className={`rounded-xl border px-3 py-2 text-sm ${feedbackClassName}`}>
            {globalBackfillFeedback.message}
          </div>
        )}

        <div className="mt-1">
          {liveSyncChatIds.length === 0 && (
            <p className="text-xs text-zinc-500">Turn on live sync for at least one chat to queue the 7-day gap fill.</p>
          )}
        </div>
      </div>

      <FilterBar
        query={query}
        onQueryChange={onQueryChange}
        statusFilter={statusFilter}
        onStatusChange={onStatusChange}
        typeFilter={typeFilter}
        onTypeChange={onTypeChange}
      />

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <DialogCardSkeleton key={i} />)}
        </div>
      ) : filteredDialogs.length === 0 ? (
        <div className="py-16 text-center">
          <SearchX className="mx-auto h-10 w-10 text-zinc-300" />
          <p className="mt-2 text-sm text-zinc-400">No dialogs match your filters</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredDialogs.map((entry) => (
            <DialogCard
              key={entry.tgDialogId}
              entry={entry}
              activity={dialogActivity(entry.tgDialogId)}
              liveSyncSelected={isLiveSyncSelected(entry.tgDialogId)}
              selectionMode={selectionMode}
              selected={selectedSet.has(entry.tgDialogId)}
              onSelect={() => toggleChatSelection(entry.tgDialogId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
