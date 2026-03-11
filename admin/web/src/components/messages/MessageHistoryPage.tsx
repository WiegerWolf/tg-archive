import { ChevronLeft } from 'lucide-react';
import { Paths, type MessageHistoryEntry, type MessageSearchResult } from '@shared/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { MessageCard, type ArchiveMessage } from '../MessageCard';
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

function HistorySnapshot({ label, snapshot, chatId }: { label: string; snapshot: MessageSearchResult | null | undefined; chatId?: string }) {
  if (!snapshot) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <a href={Paths.message(snapshot.tgMessageId, chatId || snapshot.chatId)} className="text-xs text-blue-600 hover:underline">Open message</a>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 py-2">
        <MessageCard
          message={snapshot as ArchiveMessage}
          onNavigateMessage={(id, targetChatId) => navigate(Paths.message(id, targetChatId || chatId || snapshot.chatId))}
          showSender
          side="left"
          showHistoryLink={false}
        />
      </div>
    </div>
  );
}

export function MessageHistoryPage({ messageId, chatId, current, history, loading }: {
  messageId: string;
  chatId?: string | null;
  current: MessageSearchResult | null;
  history: MessageHistoryEntry[];
  loading: boolean;
}) {
  return (
    <div className="animate-fade-in space-y-5">
      <div className="sticky top-14 z-30 -mx-4 border-b border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => chatId ? navigate(Paths.message(messageId, chatId)) : navigate('/') }>
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Message History</h1>
              <p className="text-xs text-zinc-500">Message #{messageId}</p>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <Skeleton className="mb-3 h-4 w-40" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {current ? (
            <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-zinc-900">Current snapshot</h2>
                <p className="text-xs text-zinc-500">Latest preserved state of this message.</p>
              </div>
              <div className="bg-zinc-50/70 py-2">
                <MessageCard
                  message={current as ArchiveMessage}
                  onNavigateMessage={(id, targetChatId) => navigate(Paths.message(id, targetChatId || chatId || current.chatId))}
                  showSender
                  side="left"
                  showHistoryLink={false}
                />
              </div>
            </section>
          ) : null}

          {history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center text-sm text-zinc-500">
              No immutable history has been recorded for this message yet.
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((entry) => (
                <section key={`${entry.chatId}:${entry.tgMessageId}:${entry.version}`} className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                  <div className="border-b border-zinc-200 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={eventVariant(entry.eventType)}>{eventLabel(entry.eventType)}</Badge>
                      <span className="text-xs font-medium text-zinc-700">v{entry.version}</span>
                      <span className="text-xs text-zinc-500">{formatObservedAt(entry.observedAt)}</span>
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

                  <div className="space-y-4 p-4">
                    <HistorySnapshot label="Before" snapshot={entry.before} chatId={chatId || entry.chatId} />
                    <HistorySnapshot label="After" snapshot={entry.after} chatId={chatId || entry.chatId} />
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
