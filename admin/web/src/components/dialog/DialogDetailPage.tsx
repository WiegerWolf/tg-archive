import { BadgeCheck, Bot, ChevronLeft, ChevronRight, ExternalLink, Radio, RefreshCcw, User, Users } from 'lucide-react';
import { Paths, type DialogActivityItem } from '@shared/api';
import type { Dialog } from '../../types';
import type { ArchiveMessage } from '../MessageCard';
import { DateSeparator, MessageCard } from '../MessageCard';
import { DialogDetailsPanel } from '../DialogDetailsPanel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { navigate } from '../../hooks/useRouter';
import { activityLabel, activityVariant, dialogDisplayTitle, dialogStatus, dialogType, formatActivityProgress, prettyNumber } from '../../lib/format';
import type { AgentStatusResponse } from '@shared/api';

const typeIconMap = {
  user: User,
  group: Users,
  channel: Radio,
  bot: Bot,
};

const typeLabelMap = {
  user: 'User',
  group: 'Group',
  channel: 'Channel',
  bot: 'Bot',
};

function formatShortDate(value: unknown) {
  if (!value) return null;
  const date = typeof value === 'number'
    ? new Date(value > 1e12 ? value : value * 1000)
    : new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-[13px] text-zinc-400">{label}</dt>
      <dd className="text-[13px] font-medium text-zinc-800 text-right">{value}</dd>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200/80 bg-white p-5">
        <div className="flex items-start gap-3.5">
          <Skeleton className="h-16 w-16 rounded-2xl shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
        <Skeleton className="mt-4 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-2/3" />
        <div className="mt-5 border-t border-zinc-100 pt-4 space-y-2.5">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      </div>
      <Skeleton className="h-9 w-full rounded-lg" />
      <div className="flex gap-2">
        <Skeleton className="h-8 flex-1 rounded-lg" />
        <Skeleton className="h-8 flex-1 rounded-lg" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
    </div>
  );
}

function MobileSkeleton() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 flex-1 rounded-lg" />
        <Skeleton className="h-8 w-16 rounded-lg" />
      </div>
      <Skeleton className="h-[300px] w-full rounded-xl" />
    </div>
  );
}

function MessagesSkeleton() {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-20 rounded-lg" />
      </div>
      <Skeleton className="h-[500px] w-full rounded-xl" />
    </div>
  );
}

export function DialogDetailPage({ dialog, messages, loading, refreshing, onRefresh, messageCount, liveSyncSelected, syncSaving, onToggleSync, activity, reconcile, getMessageSide, isSameSenderAsPrev }: {
  dialog: Dialog | null;
  messages: ArchiveMessage[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  messageCount?: number;
  liveSyncSelected: boolean;
  syncSaving: boolean;
  onToggleSync: () => void | Promise<void>;
  activity?: DialogActivityItem;
  reconcile?: AgentStatusResponse['reconcile'];
  getMessageSide: (msg: ArchiveMessage) => 'left' | 'right';
  isSameSenderAsPrev: (msgs: ArchiveMessage[], idx: number) => boolean;
}) {
  /* ── Loading state ── */
  if (loading || !dialog) {
    return (
      <div className="animate-fade-in">
        <div className="flex gap-8">
          <aside className="hidden w-80 shrink-0 lg:block"><SidebarSkeleton /></aside>
          <div className="w-full lg:hidden"><MobileSkeleton /></div>
          <div className="hidden lg:block flex-1 min-w-0"><MessagesSkeleton /></div>
        </div>
      </div>
    );
  }

  /* ── Computed values ── */
  const title = dialogDisplayTitle(dialog);
  const type = dialogType(dialog);
  const status = dialogStatus(dialog);
  const TypeIcon = typeIconMap[type];
  const activityText = formatActivityProgress(activity);
  const activityBadge = activityLabel(activity?.phase);
  const reconcileActive = reconcile?.phase === 'importing' && reconcile.currentChatId === dialog.tgDialogId;
  const reconcileProgressLine = reconcile?.chatProgress?.totalMessages
    ? `${prettyNumber(reconcile.chatProgress.processedMessages)}/${prettyNumber(reconcile.chatProgress.totalMessages)} scanned · +${prettyNumber(reconcile.chatProgress.importedMessages)} imported · ${prettyNumber(reconcile.chatProgress.skippedExistingMessages)} existing`
    : null;
  const previewMessages = [...messages].reverse();
  const participantSummary = typeof dialog.entity?.participantsCount === 'number'
    ? prettyNumber(dialog.entity.participantsCount)
    : null;
  const username = dialog.username || dialog.entity?.username;
  const verified = dialog.verified || dialog.entity?.verified;
  const statusFlags = [
    status === 'archived' ? { label: 'Archived', variant: 'muted' as const } : null,
    dialog.entity?.deleted ? { label: 'Deleted', variant: 'danger' as const } : null,
    dialog.restricted ? { label: 'Restricted', variant: 'danger' as const } : null,
    dialog.scam ? { label: 'Scam', variant: 'danger' as const } : null,
    dialog.fake ? { label: 'Fake', variant: 'danger' as const } : null,
  ].filter(Boolean) as Array<{ label: string; variant: 'muted' | 'danger' }>;
  const progressLine = activityText || (reconcileActive && reconcileProgressLine) || null;
  const hasFlags = statusFlags.length > 0 || (activityBadge && activity?.phase !== 'idle');

  function navigateMessage(id: number, chatId?: string) {
    const hash = `#msg-${id}`;
    const hasMessageOnPage = previewMessages.some((message) => message.tgMessageId === id);
    if (hasMessageOnPage) {
      if (window.location.hash === hash) {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } else {
        window.location.hash = hash;
      }
      return;
    }
    navigate(Paths.message(id, chatId || dialog.tgDialogId));
  }

  /* ── Shared UI fragments ── */
  const syncButton = (
    <Button
      variant={liveSyncSelected ? 'secondary' : 'outline'}
      size="sm"
      onClick={onToggleSync}
      disabled={syncSaving}
      className="flex-1"
    >
      <span className={`h-2 w-2 rounded-full ${liveSyncSelected ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
      {liveSyncSelected ? 'Sync On' : 'Sync Off'}
    </Button>
  );

  const refreshButton = (
    <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing} className="shrink-0 px-2" title="Refresh">
      <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
    </Button>
  );

  const feedbackBanner = progressLine
    ? <div className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 leading-relaxed">{progressLine}</div>
    : null;

  const messagesSection = (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-zinc-500 uppercase tracking-wide">
          Recent messages
          {previewMessages.length > 0 && <span className="ml-1.5 normal-case tracking-normal font-normal text-zinc-400">({previewMessages.length})</span>}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="xs" onClick={() => navigate(Paths.dialogTimeline(dialog.tgDialogId, 1))}>
            Timeline
          </Button>
          <Button variant="ghost" size="xs" onClick={() => navigate(Paths.dialogMessages(dialog.tgDialogId, 1))}>
            View all <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {previewMessages.length > 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-100/60 p-2 sm:p-3">
          {previewMessages.map((msg, idx) => {
            const prevMsg = previewMessages[idx - 1];
            const curDate = msg.metadata?.originalDate ? new Date(msg.metadata.originalDate as string | number | Date) : null;
            const prevDate = prevMsg?.metadata?.originalDate ? new Date(prevMsg.metadata.originalDate as string | number | Date) : null;
            const showDate = curDate && (!prevDate || curDate.toDateString() !== prevDate.toDateString());
            const sameSender = !showDate && isSameSenderAsPrev(previewMessages, idx);

            return (
              <div key={msg.tgMessageId}>
                {showDate && curDate ? <DateSeparator date={curDate} /> : null}
                <MessageCard message={msg} onNavigateMessage={navigateMessage} side={getMessageSide(msg)} showSender={!sameSender} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-xl border border-zinc-200 bg-white py-16 text-sm text-zinc-400">
          No messages archived yet.
        </div>
      )}
    </section>
  );

  return (
    <div className="animate-fade-in">
      <div className="flex gap-8">

        {/* ── Desktop sidebar ── */}
        <aside className="hidden w-80 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-4 pb-6">

            {/* Profile card */}
            <div className="rounded-xl border border-zinc-200/80 bg-white shadow-sm overflow-hidden">
              {/* Identity */}
              <div className="p-5 pb-4">
                <div className="flex items-start gap-3.5">
                  {dialog.avatar ? (
                    <img src={Paths.media(dialog.avatar)} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover bg-zinc-100" />
                  ) : (
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-xl font-semibold text-zinc-400">
                      {(title || '?')[0]}
                    </div>
                  )}
                  <div className="min-w-0 pt-0.5">
                    <h1 className="flex items-center gap-1.5">
                      <span className="truncate text-lg font-semibold text-zinc-900 leading-tight">{title}</span>
                      {verified && <BadgeCheck className="h-4 w-4 shrink-0 text-indigo-500" />}
                    </h1>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                      <span className="inline-flex items-center gap-1">
                        <TypeIcon className="h-3 w-3" />
                        {typeLabelMap[type]}
                      </span>
                      {username && (
                        <>
                          <span className="text-zinc-300">·</span>
                          <a
                            href={`https://t.me/${username}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-0.5 hover:text-zinc-800 transition-colors"
                          >
                            @{username}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </>
                      )}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-zinc-400">{dialog.tgDialogId}</div>
                  </div>
                </div>

                {dialog.about && (
                  <p className="mt-3.5 text-[13px] leading-relaxed text-zinc-600 line-clamp-4">{dialog.about}</p>
                )}
              </div>

              {/* Stats */}
              <div className="border-t border-zinc-100 px-5 py-2.5">
                <dl>
                  <StatRow label="Messages" value={typeof messageCount === 'number' ? prettyNumber(messageCount) : null} />
                  {participantSummary && (
                    <StatRow label={type === 'channel' ? 'Subscribers' : 'Members'} value={participantSummary} />
                  )}
                  <StatRow label="First archived" value={formatShortDate(dialog.metadata?.firstArchived)} />
                  <StatRow label="Last updated" value={formatShortDate(dialog.metadata?.lastUpdated)} />
                </dl>
              </div>

              {/* Status flags */}
              {hasFlags && (
                <div className="border-t border-zinc-100 px-5 py-3 flex flex-wrap gap-1.5">
                  {statusFlags.map((flag) => <Badge key={flag.label} variant={flag.variant}>{flag.label}</Badge>)}
                  {activityBadge && activity?.phase !== 'idle' && (
                    <Badge variant={activityVariant(activity?.phase)}>{activityBadge}</Badge>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <Button className="w-full justify-between" onClick={() => navigate(Paths.dialogMessages(dialog.tgDialogId, 1))}>
                View All Messages
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div className="flex gap-2">
                {syncButton}
                {refreshButton}
              </div>
            </div>

            {feedbackBanner}

            {/* Extended details */}
            <div className="rounded-xl border border-zinc-200/80 bg-white shadow-sm p-5">
              <DialogDetailsPanel dialog={dialog} />
            </div>
          </div>
        </aside>

        {/* ── Main content area ── */}
        <div className="min-w-0 flex-1">

          {/* Mobile header (below lg) */}
          <div className="mb-4 space-y-3 lg:hidden">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate('/')} className="shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
              {dialog.avatar ? (
                <img src={Paths.media(dialog.avatar)} alt="" className="h-11 w-11 rounded-xl object-cover bg-zinc-100 shrink-0" />
              ) : (
                <div className="h-11 w-11 rounded-xl bg-zinc-100 flex items-center justify-center text-sm font-semibold text-zinc-400 shrink-0">
                  {(title || '?')[0]}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-zinc-900">{title}</span>
                  {verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-indigo-500" />}
                </div>
                <div className="text-xs text-zinc-500">
                  {typeLabelMap[type]}
                  {username && <> · @{username}</>}
                  {typeof messageCount === 'number' && <> · {prettyNumber(messageCount)} msgs</>}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => navigate(Paths.dialogMessages(dialog.tgDialogId, 1))}>
                All Messages <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              {syncButton}
              {refreshButton}
            </div>

            {feedbackBanner}
          </div>

          {/* Messages */}
          {messagesSection}

          {/* Mobile-only details (collapsible) */}
          <details className="mt-4 group rounded-xl border border-zinc-200 bg-white shadow-sm lg:hidden">
            <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-5 py-3 text-[13px] font-medium text-zinc-500 uppercase tracking-wide hover:text-zinc-700 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-200 group-open:rotate-90" />
              Dialog Details
            </summary>
            <div className="border-t border-zinc-100 px-5 py-4">
              <DialogDetailsPanel dialog={dialog} />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
