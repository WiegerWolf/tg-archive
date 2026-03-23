import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, Bot, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Loader2, Radio, RefreshCcw, User, Users } from 'lucide-react';
import { Paths, type DialogActivityItem, type DateRangeResponse } from '@shared/api';
import type { Dialog } from '../../types';
import type { ArchiveMessage } from '../MessageCard';
import { DateSeparator, MessageCard, type ReplyPreview } from '../MessageCard';
import { DialogDetailsPanel } from '../DialogDetailsPanel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { navigate } from '../../hooks/useRouter';
import { activityLabel, activityVariant, dialogDisplayTitle, dialogStatus, dialogType, formatActivityProgress, prettyNumber } from '../../lib/format';
import type { AgentStatusResponse } from '@shared/api';
import type { useChatScroll } from '../../hooks/useChatScroll';

type ChatScrollReturn = ReturnType<typeof useChatScroll>;

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

export function DialogDetailPage({ dialog, loading, refreshing, onRefresh, messageCount, liveSyncSelected, syncSaving, onToggleSync, activity, reconcile, chat }: {
  dialog: Dialog | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  messageCount?: number;
  liveSyncSelected: boolean;
  syncSaving: boolean;
  onToggleSync: () => void | Promise<void>;
  activity?: DialogActivityItem;
  reconcile?: AgentStatusResponse['reconcile'];
  chat: ChatScrollReturn;
}) {
  const {
    messages,
    hasOlder,
    hasNewer,
    loadState,
    initialLoadDone,
    scrollRef,
    shouldScrollBottom,
    anchorMessageId,
    getMessageSide,
    isSameSenderAsPrev,
    loadOlder,
    loadNewer,
    jumpToNewest,
    jumpToDate,
  } = chat;

  /* ── Loading state ── */
  if (loading || !dialog) {
    return (
      <div className="animate-fade-in">
        <div className="flex gap-8">
          <aside className="hidden w-80 shrink-0 lg:block"><SidebarSkeleton /></aside>
          <div className="w-full lg:hidden"><MobileSkeleton /></div>
          <div className="hidden lg:block flex-1 min-w-0">
            <div className="space-y-2 rounded-xl bg-zinc-100/50 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={`flex ${i % 3 === 0 ? 'justify-end' : ''}`}>
                  <Skeleton className={`h-12 rounded-2xl ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`} />
                </div>
              ))}
            </div>
          </div>
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

  return (
    <div className="animate-fade-in">
      <div className="flex gap-8" style={{ height: 'calc(100vh - 6rem)' }}>

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
              <Button variant="outline" size="sm" className="w-full" onClick={() => navigate(Paths.dialogTimeline(dialog.tgDialogId, 1))}>
                Timeline
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

        {/* ── Main content area: Chat scroll ── */}
        <div className="min-w-0 flex-1 flex flex-col">

          {/* Mobile header (below lg) */}
          <div className="mb-3 space-y-3 lg:hidden">
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
              {syncButton}
              {refreshButton}
            </div>

            {feedbackBanner}
          </div>

          {/* Chat messages with infinite scroll */}
          <ChatScrollArea
            chatId={dialog.tgDialogId}
            chat={chat}
          />

          {/* Mobile-only details (collapsible) */}
          <details className="mt-3 group rounded-xl border border-zinc-200 bg-white shadow-sm lg:hidden">
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

const mediaTypeLabels: Record<string, string> = {
  photo: 'Photo',
  video: 'Video',
  voice: 'Voice message',
  audio: 'Audio',
  document: 'Document',
  sticker: 'Sticker',
  animation: 'GIF',
  video_note: 'Video message',
  contact: 'Contact',
};

function extractReplyPreview(msg: ArchiveMessage): ReplyPreview {
  const text = typeof msg.content?.text === 'string'
    ? msg.content.text
    : Array.isArray(msg.content?.text)
      ? msg.content.text.map((p) => typeof p === 'string' ? p : p.text || '').join('')
      : undefined;
  const mediaType = msg.content?.media?.type
    ? mediaTypeLabels[msg.content.media.type] || msg.content.media.type
    : msg.content?.location
      ? 'Location'
      : undefined;
  return {
    senderName: msg.sender?.name,
    text: text ? (text.length > 120 ? text.slice(0, 120) + '...' : text) : undefined,
    mediaType,
  };
}

function buildReplyMap(messages: ArchiveMessage[]): Map<number, ReplyPreview> {
  const byId = new Map<number, ArchiveMessage>();
  for (const msg of messages) {
    byId.set(msg.tgMessageId, msg);
  }
  const replyMap = new Map<number, ReplyPreview>();
  for (const msg of messages) {
    const replyId = msg.replyTo?.messageId;
    if (replyId != null && byId.has(replyId)) {
      replyMap.set(replyId, extractReplyPreview(byId.get(replyId)!));
    }
  }
  return replyMap;
}

function groupMessagesByDate(messages: ArchiveMessage[]) {
  const groups: Array<{ dateKey: string; date: Date; messages: ArchiveMessage[] }> = [];
  for (const msg of messages) {
    const d = msg.metadata?.originalDate ? new Date(msg.metadata.originalDate as any) : null;
    const key = d ? d.toDateString() : 'unknown';
    const last = groups[groups.length - 1];
    if (last && last.dateKey === key) {
      last.messages.push(msg);
    } else {
      groups.push({ dateKey: key, date: d || new Date(), messages: [msg] });
    }
  }
  return groups;
}

/* ── Chat scroll area (extracted for clarity) ── */

function ChatScrollArea({ chatId, chat }: { chatId: string; chat: ChatScrollReturn }) {
  const {
    messages,
    hasOlder,
    hasNewer,
    loadState,
    loading: chatLoading,
    initialLoadDone,
    scrollRef,
    shouldScrollBottom,
    anchorMessageId,
    getMessageSide,
    isSameSenderAsPrev,
    loadOlder,
    loadNewer,
    jumpToNewest,
    jumpToDate,
  } = chat;

  // Date range for calendar picker
  const [dateRange, setDateRange] = useState<DateRangeResponse | null>(null);
  useEffect(() => {
    if (!chatId) return;
    fetch(Paths.apiDialogDateRange(chatId), { headers: { Accept: 'application/json' } })
      .then(async (r) => { if (r.ok) setDateRange(await r.json()); })
      .catch(() => {});
  }, [chatId]);

  // "Show jump to bottom" state
  const [showJumpButton, setShowJumpButton] = useState(false);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom on initial load
  const hasScrolledInitially = useRef(false);
  useEffect(() => {
    if (!initialLoadDone || messages.length === 0) return;
    if (hasScrolledInitially.current) return;
    hasScrolledInitially.current = true;
    const container = scrollRef.current;
    if (!container) return;

    if (shouldScrollBottom.current) {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    } else if (anchorMessageId.current) {
      requestAnimationFrame(() => {
        const target = container.querySelector(`#msg-${anchorMessageId.current}`);
        if (target instanceof HTMLElement) {
          const containerRect = container.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const offset = targetRect.top - containerRect.top - containerRect.height / 2 + targetRect.height / 2;
          container.scrollTop += offset;
        }
      });
    }
  }, [initialLoadDone, messages.length, scrollRef, shouldScrollBottom, anchorMessageId]);

  // Reset on chat change
  useEffect(() => {
    hasScrolledInitially.current = false;
  }, [chatId]);

  // Hash-based message highlighting
  useEffect(() => {
    if (!initialLoadDone || messages.length === 0) return;
    const hash = window.location.hash;
    if (!hash.startsWith('#msg-')) return;
    const container = scrollRef.current;
    if (!container) return;

    const timer = setTimeout(() => {
      const target = container.querySelector(hash);
      if (target instanceof HTMLElement) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const offset = targetRect.top - containerRect.top - containerRect.height / 2 + targetRect.height / 2;
        container.scrollTop += offset;
        target.classList.add('animate-card-highlight');
        setTimeout(() => target.classList.remove('animate-card-highlight'), 2000);
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [initialLoadDone, messages, scrollRef]);

  // IntersectionObserver for top sentinel (load older) and bottom sentinel (show/hide FAB)
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const topObs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasOlder && loadState === 'idle') {
          loadOlder();
        }
      },
      { root: container, rootMargin: '200px 0px 0px 0px', threshold: 0 },
    );

    const bottomObs = new IntersectionObserver(
      (entries) => {
        const isVisible = entries[0]?.isIntersecting ?? false;
        setShowJumpButton(!isVisible && initialLoadDone);

        if (isVisible && hasNewer && loadState === 'idle') {
          loadNewer();
        }
      },
      { root: container, rootMargin: '0px 0px 100px 0px', threshold: 0 },
    );

    if (topSentinelRef.current) topObs.observe(topSentinelRef.current);
    if (bottomSentinelRef.current) bottomObs.observe(bottomSentinelRef.current);

    return () => {
      topObs.disconnect();
      bottomObs.disconnect();
    };
  }, [scrollRef, hasOlder, hasNewer, loadState, loadOlder, loadNewer, initialLoadDone]);

  const handleDateJump = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!value) return;
    jumpToDate(value);
  }, [jumpToDate]);

  function navigateMessage(id: number) {
    const container = scrollRef.current;
    if (container) {
      const target = container.querySelector(`#msg-${id}`);
      if (target instanceof HTMLElement) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const offset = targetRect.top - containerRect.top - containerRect.height / 2 + targetRect.height / 2;
        container.scrollBy({ top: offset, behavior: 'smooth' });
        target.classList.add('animate-card-highlight');
        setTimeout(() => target.classList.remove('animate-card-highlight'), 2000);
        return;
      }
    }
    navigate(Paths.message(id, chatId));
  }

  const handleJumpToBottom = useCallback(() => {
    if (hasNewer) {
      jumpToNewest();
    } else {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [hasNewer, jumpToNewest, scrollRef]);

  // Build reply preview map from loaded messages
  const replyMap = useMemo(() => buildReplyMap(messages), [messages]);

  // Hidden date input triggered by clicking date pills
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const openDatePicker = useCallback(() => {
    const input = dateInputRef.current;
    if (input) {
      input.showPicker?.();
      setDatePickerOpen(true);
    }
  }, []);

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      {/* Hidden date input for calendar jump */}
      <input
        ref={dateInputRef}
        type="date"
        className="sr-only"
        min={dateRange?.oldest ? new Date(dateRange.oldest).toISOString().split('T')[0] : undefined}
        max={dateRange?.newest ? new Date(dateRange.newest).toISOString().split('T')[0] : undefined}
        onChange={(e) => { handleDateJump(e); setDatePickerOpen(false); }}
        onBlur={() => setDatePickerOpen(false)}
        tabIndex={-1}
      />

      {/* Scrollable message area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-xl bg-zinc-100/50"
      >
        {chatLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={`flex ${i % 3 === 0 ? 'justify-end' : ''}`}>
                <Skeleton className={`h-12 rounded-2xl ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`} />
              </div>
            ))}
          </div>
        ) : (
          <div className="p-2 sm:p-3 space-y-0.5">
            <div ref={topSentinelRef} className="h-px" />

            {loadState === 'loading-older' && (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                <span className="ml-2 text-sm text-zinc-500">Loading older messages...</span>
              </div>
            )}

            {!hasOlder && messages.length > 0 && (
              <div className="py-3 text-center text-xs text-zinc-400">Beginning of conversation</div>
            )}

            {groupMessagesByDate(messages).map((group) => (
              <div key={group.dateKey}>
                <DateSeparator date={group.date} onDateClick={openDatePicker} />
                {group.messages.map((msg, idx) => {
                  const sameSender = isSameSenderAsPrev(group.messages, idx);
                  return (
                    <div key={msg.tgMessageId}>
                      <MessageCard message={msg} onNavigateMessage={navigateMessage} side={getMessageSide(msg)} showSender={!sameSender} replyPreview={msg.replyTo?.messageId != null ? replyMap.get(msg.replyTo.messageId) ?? null : undefined} />
                    </div>
                  );
                })}
              </div>
            ))}

            {loadState === 'loading-newer' && (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                <span className="ml-2 text-sm text-zinc-500">Loading newer messages...</span>
              </div>
            )}

            <div ref={bottomSentinelRef} className="h-px" />
          </div>
        )}
      </div>

      {/* Jump to bottom FAB */}
      {showJumpButton && (
        <button
          onClick={handleJumpToBottom}
          className="absolute bottom-4 right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-white shadow-lg transition-all hover:bg-zinc-700 active:scale-95"
          title="Jump to newest"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
