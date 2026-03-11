import { ChevronLeft } from 'lucide-react';
import { Paths, type MessageHistoryEntry } from '@shared/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { MessageCard, type ArchiveMessage } from '../MessageCard';
import { MessagesPagination } from './MessagesPagination';
import { navigate } from '../../hooks/useRouter';

function formatObservedAt(value: unknown) {
  if (!value) return 'Unknown time';
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function eventLabel(eventType?: MessageHistoryEntry['eventType']) {
  switch (eventType) {
    case 'created':
      return 'Created';
    case 'baseline':
      return 'Baseline';
    case 'edited':
      return 'Edited';
    case 'reactions_updated':
      return 'Reactions';
    case 'deleted':
      return 'Deleted';
    case 'sync_updated':
    default:
      return 'Snapshot';
  }
}

function eventVariant(eventType?: MessageHistoryEntry['eventType']): 'default' | 'danger' | 'success' | 'muted' | 'info' {
  switch (eventType) {
    case 'created':
      return 'success';
    case 'deleted':
      return 'danger';
    case 'edited':
      return 'info';
    case 'reactions_updated':
      return 'default';
    case 'baseline':
      return 'muted';
    default:
      return 'default';
  }
}

export function TimelinePage({ chatId, timeline, pagination, loading }: {
  chatId: string;
  timeline: MessageHistoryEntry[];
  pagination: { current: number; total: number; totalCount: number; limit: number } | null;
  loading: boolean;
}) {
  return (
    <div className="animate-fade-in space-y-5">
      <div className="sticky top-14 z-30 -mx-4 border-b border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(Paths.dialogMessages(chatId, 1))}>
              <ChevronLeft className="h-4 w-4" /> Latest Messages
            </Button>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Mutation Timeline</h1>
              {pagination ? <p className="text-xs text-zinc-500">{pagination.totalCount.toLocaleString()} recorded events</p> : null}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <Skeleton className="mb-3 h-4 w-40" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : timeline.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center text-sm text-zinc-500">
          No message mutations have been recorded for this dialog yet.
        </div>
      ) : (
        <div className="space-y-4">
          {timeline.map((entry) => {
            const snapshot = (entry.after || entry.before || null) as ArchiveMessage | null;

            return (
              <section key={`${entry.chatId}:${entry.tgMessageId}:${entry.version}`} className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={eventVariant(entry.eventType)}>{eventLabel(entry.eventType)}</Badge>
                    <span className="text-xs font-medium text-zinc-700">v{entry.version}</span>
                    <span className="text-xs text-zinc-500">{formatObservedAt(entry.observedAt)}</span>
                    <a href={Paths.messageHistory(entry.tgMessageId, entry.chatId)} className="text-xs text-blue-600 hover:underline">Message history</a>
                  </div>
                  {entry.summary ? <p className="mt-1 text-sm text-zinc-600">{entry.summary}</p> : null}
                  {entry.changedFields && entry.changedFields.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {entry.changedFields.map((field) => (
                        <span key={field} className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600">{field}</span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="bg-zinc-50/70 py-2">
                  {snapshot ? (
                    <MessageCard
                      message={snapshot}
                      onNavigateMessage={(id, targetChatId) => navigate(Paths.message(id, targetChatId || entry.chatId))}
                      showSender
                      side="left"
                    />
                  ) : (
                    <div className="px-4 py-5 text-sm text-zinc-500">No snapshot payload available for this event.</div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {pagination && pagination.total > 1 ? (
        <MessagesPagination current={pagination.current} total={pagination.total} onNavigate={(page) => navigate(Paths.dialogTimeline(chatId, page))} />
      ) : null}
    </div>
  );
}
