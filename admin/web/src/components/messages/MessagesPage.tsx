import { ChevronLeft } from 'lucide-react';
import { Paths, type DialogActivityItem } from '@shared/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { DateSeparator, MessageCard, type ArchiveMessage } from '../MessageCard';
import { MessagesPagination } from './MessagesPagination';
import { navigate } from '../../hooks/useRouter';
import { activityLabel, activityVariant, formatActivityProgress } from '../../lib/format';

export function MessagesPage({ chatId, messages, pagination, loading, activity, getMessageSide, isSameSenderAsPrev }: {
  chatId: string;
  messages: ArchiveMessage[];
  pagination: { current: number; total: number; limit: number } | null;
  loading: boolean;
  activity?: DialogActivityItem;
  getMessageSide: (msg: ArchiveMessage) => 'left' | 'right';
  isSameSenderAsPrev: (msgs: ArchiveMessage[], idx: number) => boolean;
}) {
  const actBadge = activityLabel(activity?.phase);
  const actProgress = formatActivityProgress(activity);

  function navigateMessage(id: number) {
    const hash = `#msg-${id}`;
    const hasMessageOnPage = messages.some((message) => message.tgMessageId === id);
    if (hasMessageOnPage) {
      if (window.location.hash === hash) {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } else {
        window.location.hash = hash;
      }
      return;
    }
    navigate(Paths.message(id, chatId));
  }

  return (
    <div className="animate-fade-in">
      {/* Sticky header */}
      <div className="sticky top-14 z-30 -mx-4 mb-5 border-b border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(Paths.dialog(chatId))}>
              <ChevronLeft className="h-4 w-4" /> Dialog Info
            </Button>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Messages</h1>
              {pagination && <p className="text-xs text-zinc-500">Page {pagination.current} of {pagination.total}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(Paths.dialogTimeline(chatId, 1))}>
              Timeline
            </Button>
          </div>
        </div>
      </div>

      {actBadge && activity?.phase !== 'idle' && (
        <div className="mb-4 rounded-xl bg-indigo-50 p-3 ring-1 ring-indigo-100">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={activityVariant(activity?.phase)}>{actBadge}</Badge>
            {actProgress && <span className="text-sm text-indigo-700">{actProgress}</span>}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2 rounded-xl bg-zinc-100/50 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`flex ${i % 3 === 0 ? 'justify-end' : ''}`}>
              <Skeleton className={`h-12 rounded-2xl ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`} />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-zinc-100/50 p-2 sm:p-3 space-y-0.5 overflow-hidden">
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
        </div>
      )}

      {pagination && <MessagesPagination current={pagination.current} total={pagination.total} onNavigate={(page) => navigate(Paths.dialogMessages(chatId, page))} />}
    </div>
  );
}
