import { useCallback, useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, ChevronLeft, Loader2 } from 'lucide-react';
import { Paths, type DialogActivityItem, type DateRangeResponse } from '@shared/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { DateSeparator, MessageCard, type ArchiveMessage } from '../MessageCard';
import { navigate } from '../../hooks/useRouter';
import { activityLabel, activityVariant, formatActivityProgress } from '../../lib/format';
import type { useChatScroll } from '../../hooks/useChatScroll';

type ChatScrollReturn = ReturnType<typeof useChatScroll>;

export function MessagesPage({ chatId, chat, activity }: {
  chatId: string;
  chat: ChatScrollReturn;
  activity?: DialogActivityItem;
}) {
  const {
    messages,
    hasOlder,
    hasNewer,
    loadState,
    loading,
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

  const actBadge = activityLabel(activity?.phase);
  const actProgress = formatActivityProgress(activity);

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

  // Scroll to bottom or anchor on initial load only
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

  // Reset the initial scroll flag when chat/options change (new load)
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

        // Load newer when scrolling to bottom
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

  // Date picker handler
  const handleDateJump = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!value) return;
    jumpToDate(value);
  }, [jumpToDate]);

  // Navigate to a message on this page, or resolve its location
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

  // Handle scrolling to bottom
  const handleJumpToBottom = useCallback(() => {
    if (hasNewer) {
      jumpToNewest();
    } else {
      const container = scrollRef.current;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [hasNewer, jumpToNewest, scrollRef]);

  return (
    <div className="animate-fade-in flex flex-col" style={{ height: 'calc(100vh - 6rem)' }}>
      {/* Sticky header */}
      <div className="z-30 -mx-4 border-b border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(Paths.dialog(chatId))}>
              <ChevronLeft className="h-4 w-4" /> Dialog Info
            </Button>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Messages</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {dateRange && dateRange.oldest && (
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                <input
                  type="date"
                  className="h-8 rounded-md border border-zinc-200 bg-white pl-8 pr-2 text-xs text-zinc-700 shadow-sm hover:border-zinc-300 focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-300"
                  min={dateRange.oldest ? new Date(dateRange.oldest).toISOString().split('T')[0] : undefined}
                  max={dateRange.newest ? new Date(dateRange.newest).toISOString().split('T')[0] : undefined}
                  onChange={handleDateJump}
                />
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate(Paths.dialogTimeline(chatId, 1))}>
              Timeline
            </Button>
          </div>
        </div>
      </div>

      {actBadge && activity?.phase !== 'idle' && (
        <div className="mx-auto w-full max-w-7xl px-0">
          <div className="my-2 rounded-xl bg-indigo-50 p-3 ring-1 ring-indigo-100">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={activityVariant(activity?.phase)}>{actBadge}</Badge>
              {actProgress && <span className="text-sm text-indigo-700">{actProgress}</span>}
            </div>
          </div>
        </div>
      )}

      {/* Scrollable message area */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto"
      >
        {loading ? (
          <div className="space-y-2 rounded-xl bg-zinc-100/50 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={`flex ${i % 3 === 0 ? 'justify-end' : ''}`}>
                <Skeleton className={`h-12 rounded-2xl ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto max-w-7xl">
            <div className="rounded-xl bg-zinc-100/50 p-2 sm:p-3 space-y-0.5 overflow-hidden">
              {/* Top sentinel for infinite scroll */}
              <div ref={topSentinelRef} className="h-px" />

              {/* Loading older indicator */}
              {loadState === 'loading-older' && (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                  <span className="ml-2 text-sm text-zinc-500">Loading older messages...</span>
                </div>
              )}

              {!hasOlder && messages.length > 0 && (
                <div className="py-3 text-center text-xs text-zinc-400">Beginning of conversation</div>
              )}

              {messages.map((msg, idx) => {
                const prevMsg = messages[idx - 1];
                const curDate = msg.metadata?.originalDate ? new Date(msg.metadata.originalDate as any) : null;
                const prevDate = prevMsg?.metadata?.originalDate ? new Date(prevMsg.metadata.originalDate as any) : null;
                const showDate = curDate && (!prevDate || curDate.toDateString() !== prevDate.toDateString());
                const sameSender = !showDate && isSameSenderAsPrev(messages, idx);
                return (
                  <div key={msg.tgMessageId}>
                    {showDate && curDate ? <DateSeparator date={curDate} /> : null}
                    <MessageCard message={msg} onNavigateMessage={navigateMessage} side={getMessageSide(msg)} showSender={!sameSender} />
                  </div>
                );
              })}

              {/* Loading newer indicator */}
              {loadState === 'loading-newer' && (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                  <span className="ml-2 text-sm text-zinc-500">Loading newer messages...</span>
                </div>
              )}

              {/* Bottom sentinel */}
              <div ref={bottomSentinelRef} className="h-px" />
            </div>
          </div>
        )}
      </div>

      {/* Jump to bottom FAB */}
      {showJumpButton && (
        <button
          onClick={handleJumpToBottom}
          className="absolute bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-white shadow-lg transition-all hover:bg-zinc-700 active:scale-95 sm:right-10"
          title="Jump to newest"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
