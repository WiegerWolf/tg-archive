import type { Dialog } from '../types';
import type { DialogActivityItem } from '@shared/api';

export function prettyNumber(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0';
  return value.toLocaleString();
}

export function prettyState(state?: string) {
  if (!state) return 'Unknown';
  return state.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function statusColor(state?: string): string {
  if (state === 'syncing_dialogs' || state === 'syncing_messages') return 'bg-emerald-500 animate-pulse-slow';
  if (state === 'listening') return 'bg-emerald-500';
  if (state === 'needs_auth' || state === 'awaiting_2fa_password') return 'bg-amber-500 animate-pulse-slow';
  if (state === 'error') return 'bg-red-500';
  return 'bg-zinc-400';
}

export function statusTone(state?: string): 'success' | 'warning' | 'danger' | 'info' {
  if (state === 'syncing_dialogs' || state === 'syncing_messages' || state === 'bootstrap_import') return 'warning';
  if (state === 'listening') return 'success';
  if (state === 'needs_auth' || state === 'awaiting_2fa_password') return 'warning';
  if (state === 'error') return 'danger';
  return 'info';
}

export function isLiveIngestActive(state?: string): boolean {
  return state === 'listening' || state === 'syncing_dialogs' || state === 'syncing_messages';
}

export function liveStateTone(state?: string): 'success' | 'warning' | 'danger' | 'muted' {
  if (isLiveIngestActive(state)) return 'success';
  if (state === 'needs_auth' || state === 'awaiting_2fa_password') return 'warning';
  if (state === 'error') return 'danger';
  return 'muted';
}

export function backgroundTaskLabel(state?: string): string | null {
  if (state === 'syncing_dialogs') return 'Background: Dialog Sync';
  if (state === 'syncing_messages') return 'Background: History Backfill';
  if (state === 'bootstrap_import') return 'Background: Backup Import';
  return null;
}

export function dialogType(entry: Dialog): 'user' | 'group' | 'channel' | 'bot' {
  if (entry.isUser && entry.entity?.bot) return 'bot';
  if (entry.isChannel) return 'channel';
  if (entry.isGroup) return 'group';
  return 'user';
}

export function dialogStatus(entry: Dialog): 'active' | 'archived' | 'deleted' {
  if (entry.isUser && entry.entity?.deleted) return 'deleted';
  if (entry.archived) return 'archived';
  return 'active';
}

export function activityLabel(phase?: DialogActivityItem['phase']) {
  if (phase === 'importing_backup') return 'Importing';
  if (phase === 'backfilling') return 'Backfilling';
  if (phase === 'stale') return 'Backfill Paused';
  if (phase === 'queued') return 'Queued';
  if (phase === 'complete') return 'Backfilled';
  return null;
}

export function activityVariant(phase?: DialogActivityItem['phase']): 'info' | 'warning' | 'success' | 'muted' | 'danger' {
  if (phase === 'importing_backup' || phase === 'backfilling') return 'warning';
  if (phase === 'stale') return 'danger';
  if (phase === 'complete') return 'success';
  if (phase === 'queued') return 'muted';
  return 'info';
}

export function formatActivityProgress(activity?: DialogActivityItem | null) {
  if (!activity?.chatProgress) return null;
  const scanned = prettyNumber(activity.chatProgress.scannedMessages);
  const imported = prettyNumber(activity.chatProgress.importedMessages);
  const existing = prettyNumber(activity.chatProgress.skippedExistingMessages);
  const enriched = prettyNumber(activity.chatProgress.enrichedMessages);
  const hasEnriched = typeof activity.chatProgress.enrichedMessages === 'number' && activity.chatProgress.enrichedMessages > 0;
  return `${scanned} scanned · +${imported} imported · ${existing} existing${hasEnriched ? ` · ${enriched} enriched` : ''}`;
}

export function pageWindow(current: number, total: number) {
  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);
  return pages;
}

export function dialogDisplayTitle(dialog: Dialog): string {
  const type = dialogType(dialog);
  if (type === 'group') return dialog.entity?.title || dialog.title || 'Unnamed Group';
  if (type === 'bot') return [dialog.entity?.firstName, dialog.entity?.lastName].filter(Boolean).join(' ') || dialog.title || dialog.tgDialogId;
  return dialog.title || [dialog.firstName, dialog.lastName].filter(Boolean).join(' ') || dialog.tgDialogId;
}

export function dialogSubtitle(dialog: Dialog): string {
  const type = dialogType(dialog);
  if (type === 'bot') return dialog.entity?.username ? `@${dialog.entity.username}` : dialog.tgDialogId;
  return dialog.username ? `@${dialog.username}` : dialog.tgDialogId;
}
