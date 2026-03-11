import { useEffect, useMemo, useState } from 'react';
import { DialogActivityItem, DialogActivityResponse, Paths, RecentDialogsBackfillResponse, ROUTES, SyncConfigResponse } from '@shared/api';
import type { Dialog } from '../types';
import { dialogStatus, dialogType } from '../lib/format';

type FeedbackBanner = {
  message: string;
  tone: 'success' | 'info' | 'danger';
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatAutoBackfillDetails(payload?: SyncConfigResponse['autoBackfill']) {
  if (!payload) return '';

  const details: string[] = [];
  if (payload.queuedCount > 0) details.push(`${pluralize(payload.queuedCount, 'backfill')} queued`);
  if (payload.skippedAlreadyQueuedCount > 0) details.push(`${pluralize(payload.skippedAlreadyQueuedCount, 'chat')} already queued`);
  if (payload.skippedAlreadyBackfilledCount > 0) details.push(`${pluralize(payload.skippedAlreadyBackfilledCount, 'chat')} already backfilled`);
  if (payload.skippedUnknownDialogCount > 0) details.push(`${pluralize(payload.skippedUnknownDialogCount, 'chat')} unavailable`);

  return details.length > 0 ? ` (${details.join(' · ')})` : '';
}

export function useDialogs() {
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'deleted' | 'live_sync' | 'backfilled'>('active');
  const [typeFilter, setTypeFilter] = useState<'all' | 'user' | 'group' | 'channel' | 'bot'>('all');
  const [liveSyncChatIds, setLiveSyncChatIds] = useState<string[]>([]);
  const [syncConfigSaving, setSyncConfigSaving] = useState(false);
  const [syncSavingChatIds, setSyncSavingChatIds] = useState<string[]>([]);
  const [dialogActivities, setDialogActivities] = useState<Record<string, DialogActivityItem>>({});
  const [backfillRequestingChatIds, setBackfillRequestingChatIds] = useState<string[]>([]);
  const [dialogBackfillFeedbackByChat, setDialogBackfillFeedbackByChat] = useState<Record<string, string>>({});
  const [recentBackfillRequesting, setRecentBackfillRequesting] = useState(false);
  const [globalBackfillFeedback, setGlobalBackfillFeedback] = useState<FeedbackBanner | null>(null);
  const [liveSyncFeedback, setLiveSyncFeedback] = useState<FeedbackBanner | null>(null);

  function setDialogBackfillFeedback(chatId: string, message: string) {
    setDialogBackfillFeedbackByChat((current) => {
      if (!message) {
        const next = { ...current };
        delete next[chatId];
        return next;
      }
      return { ...current, [chatId]: message };
    });
  }

  async function loadDialogs() {
    const response = await fetch(ROUTES.api.dialogs, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Failed to load dialogs');
    setDialogs((await response.json()) as Dialog[]);
    setLoading(false);
  }

  async function loadSyncConfig() {
    const response = await fetch(ROUTES.api.syncConfig, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Failed to load sync config');
    const payload = (await response.json()) as SyncConfigResponse;
    setLiveSyncChatIds(Array.isArray(payload.liveSyncChatIds) ? payload.liveSyncChatIds : []);
  }

  async function loadDialogActivity() {
    const response = await fetch(ROUTES.api.dialogActivity, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Failed to load dialog activity');
    const payload = (await response.json()) as DialogActivityResponse;
    setDialogActivities(payload.activities || {});
  }

  async function saveSyncConfig(nextChatIds: string[]) {
    const response = await fetch(ROUTES.api.syncConfig, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ liveSyncChatIds: nextChatIds }),
    });
    if (!response.ok) throw new Error('Failed to save sync config');
    const payload = (await response.json()) as SyncConfigResponse;
    setLiveSyncChatIds(Array.isArray(payload.liveSyncChatIds) ? payload.liveSyncChatIds : []);
    await loadDialogActivity().catch(() => {});
    return payload;
  }

  function isLiveSyncSelected(chatId: string) {
    return liveSyncChatIds.includes(chatId);
  }

  async function toggleLiveSync(chatId: string) {
    if (syncSavingChatIds.includes(chatId) || syncConfigSaving) return;
    const previous = liveSyncChatIds;
    const next = previous.includes(chatId) ? previous.filter((id) => id !== chatId) : [...previous, chatId];
    setLiveSyncChatIds(next);
    setLiveSyncFeedback(null);
    setSyncSavingChatIds((current) => [...current, chatId]);
    setSyncConfigSaving(true);
    try {
      await saveSyncConfig(next);
    } catch {
      setLiveSyncChatIds(previous);
    } finally {
      setSyncConfigSaving(false);
      setSyncSavingChatIds((current) => current.filter((id) => id !== chatId));
    }
  }

  async function bulkUpdateLiveSync(chatIds: string[], enabled: boolean) {
    if (syncConfigSaving) return false;

    const uniqueChatIds = Array.from(new Set(chatIds.map((chatId) => chatId.trim()).filter(Boolean)));
    if (uniqueChatIds.length === 0) {
      setLiveSyncFeedback({
        tone: 'info',
        message: 'Select at least one chat to update live sync.',
      });
      return false;
    }

    const previous = liveSyncChatIds;
    const selectedSet = new Set(uniqueChatIds);
    let changedCount = 0;
    let next = previous;

    if (enabled) {
      const previousSet = new Set(previous);
      next = [...previous];
      for (const chatId of uniqueChatIds) {
        if (previousSet.has(chatId)) continue;
        next.push(chatId);
        changedCount += 1;
      }
    } else {
      next = previous.filter((chatId) => !selectedSet.has(chatId));
      changedCount = previous.length - next.length;
    }

    if (changedCount === 0) {
      setLiveSyncFeedback({
        tone: 'info',
        message: enabled
          ? 'All selected chats already have live sync enabled.'
          : 'All selected chats already have live sync disabled.',
      });
      return true;
    }

    setLiveSyncChatIds(next);
    setLiveSyncFeedback(null);
    setSyncConfigSaving(true);

    try {
      const payload = await saveSyncConfig(next);
      const actionLabel = enabled ? 'enabled' : 'removed';
      const autoBackfillDetails = enabled ? formatAutoBackfillDetails(payload.autoBackfill) : '';
      setLiveSyncFeedback({
        tone: 'success',
        message: `Live sync ${actionLabel} for ${pluralize(changedCount, 'chat')}.${autoBackfillDetails}`,
      });
      return true;
    } catch {
      setLiveSyncChatIds(previous);
      setLiveSyncFeedback({
        tone: 'danger',
        message: enabled
          ? 'Failed to enable live sync for the selected chats.'
          : 'Failed to remove live sync for the selected chats.',
      });
      return false;
    } finally {
      setSyncConfigSaving(false);
    }
  }

  async function requestDialogBackfill(chatId: string) {
    if (backfillRequestingChatIds.includes(chatId)) return;
    setBackfillRequestingChatIds((current) => [...current, chatId]);
    setDialogBackfillFeedback(chatId, '');
    try {
      const response = await fetch(Paths.apiDialogBackfill(chatId), { method: 'POST', headers: { Accept: 'application/json' } });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || 'Failed to request dialog backfill');
      }
      setDialogBackfillFeedback(chatId, `Backfill requested for chat ${chatId}.`);
      await loadDialogActivity().catch(() => {});
    } catch (error) {
      setDialogBackfillFeedback(chatId, error instanceof Error ? error.message : 'Failed to request dialog backfill');
    } finally {
      setBackfillRequestingChatIds((current) => current.filter((id) => id !== chatId));
    }
  }

  async function requestRecentBackfillForLiveSyncChats() {
    if (recentBackfillRequesting) return;
    setRecentBackfillRequesting(true);
    setGlobalBackfillFeedback(null);
    try {
      const response = await fetch(Paths.apiRecentDialogsBackfill(), { method: 'POST', headers: { Accept: 'application/json' } });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || 'Failed to request 7-day backfill');
      }

      const payload = (await response.json()) as RecentDialogsBackfillResponse;
      const details: string[] = [];
      if (payload.skippedAlreadyQueuedCount > 0) {
        details.push(`${payload.skippedAlreadyQueuedCount} already queued`);
      }
      if (payload.skippedUnknownDialogCount > 0) {
        details.push(`${payload.skippedUnknownDialogCount} unavailable`);
      }

      if (payload.queuedCount > 0) {
        setGlobalBackfillFeedback({
          tone: 'success',
          message: `Queued a 7-day backfill for ${payload.queuedCount} live-sync chats${details.length ? ` (${details.join(' · ')})` : ''}.`,
        });
      } else {
        setGlobalBackfillFeedback({
          tone: 'info',
          message: `No new 7-day backfill requests were queued${details.length ? ` (${details.join(' · ')})` : ''}.`,
        });
      }

      await loadDialogActivity().catch(() => {});
    } catch (error) {
      setGlobalBackfillFeedback({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Failed to request 7-day backfill',
      });
    } finally {
      setRecentBackfillRequesting(false);
    }
  }

  function dialogActivity(chatId: string): DialogActivityItem | undefined {
    return dialogActivities[chatId];
  }

  function dialogBackfillFeedback(chatId: string): string {
    return dialogBackfillFeedbackByChat[chatId] || '';
  }

  useEffect(() => {
    loadDialogs().catch(() => setLoading(false));
    loadSyncConfig().catch(() => {});
    loadDialogActivity().catch(() => {});
    const timer = setInterval(() => loadDialogActivity().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, []);

  const filteredDialogs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return dialogs.filter((entry) => {
      const statusMatches = statusFilter === 'live_sync'
        ? liveSyncChatIds.includes(entry.tgDialogId)
        : statusFilter === 'backfilled'
          ? Boolean(entry.sync?.backfillCompletedAt)
          : dialogStatus(entry) === statusFilter;
      const typeMatches = typeFilter === 'all' || dialogType(entry) === typeFilter;
      const name = [entry.title, entry.firstName, entry.lastName, entry.username].filter(Boolean).join(' ').toLowerCase();
      const queryMatches = !normalized || name.includes(normalized) || entry.tgDialogId.toLowerCase().includes(normalized);
      return statusMatches && typeMatches && queryMatches;
    });
  }, [dialogs, liveSyncChatIds, query, statusFilter, typeFilter]);

  const backfillingCount = useMemo(() => {
    return Object.values(dialogActivities).filter((a) => a.phase === 'backfilling' || a.phase === 'importing_backup').length;
  }, [dialogActivities]);

  return {
    dialogs,
    filteredDialogs,
    loading,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    typeFilter,
    setTypeFilter,
    liveSyncChatIds,
    liveSyncFeedback,
    syncConfigSaving,
    syncSavingChatIds,
    isLiveSyncSelected,
    toggleLiveSync,
    bulkUpdateLiveSync,
    dialogActivity,
    backfillRequestingChatIds,
    dialogBackfillFeedback,
    requestDialogBackfill,
    recentBackfillRequesting,
    globalBackfillFeedback,
    requestRecentBackfillForLiveSyncChats,
    backfillingCount,
    loadDialogs,
  };
}
