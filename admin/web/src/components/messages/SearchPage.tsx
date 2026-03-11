import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Search, SearchX } from 'lucide-react';
import { Paths, type MessageSearchResult } from '@shared/api';
import { MessageCard, type ArchiveMessage } from '../MessageCard';
import { MessagesPagination } from './MessagesPagination';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { navigate } from '../../hooks/useRouter';

type SearchMessage = ArchiveMessage & MessageSearchResult;

function formatSearchTimestamp(value: unknown) {
  if (!value) return '';
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SearchPage({ query, chatId, scopeTitle, messages, pagination, loading, error }: {
  query: string;
  chatId?: string;
  scopeTitle?: string;
  messages: SearchMessage[];
  pagination: { current: number; total: number; totalCount: number; limit: number } | null;
  loading: boolean;
  error: string;
}) {
  const [draft, setDraft] = useState(query);

  useEffect(() => {
    setDraft(query);
  }, [query]);

  const normalizedQuery = useMemo(() => query.trim(), [query]);
  const scopeSummary = chatId ? (scopeTitle || chatId) : 'All archived messages';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(Paths.messageSearch(draft, 1, chatId));
  }

  function clearSearch() {
    setDraft('');
    navigate(Paths.messageSearch('', 1, chatId));
  }

  return (
    <div className="animate-fade-in space-y-5">
      <div className="space-y-3 border-b border-zinc-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Search</h1>
          <p className="mt-1 text-sm text-zinc-500">{scopeSummary}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:hidden">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="pl-9"
              placeholder={chatId ? `Search in ${scopeTitle || chatId}` : 'Search all archived messages'}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="default">Search</Button>
            {draft && <Button type="button" variant="outline" onClick={clearSearch}>Clear</Button>}
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-500">
          {normalizedQuery && pagination && (
            <p>
              {pagination.totalCount.toLocaleString()} matches for <span className="font-medium text-zinc-900">{normalizedQuery}</span>
            </p>
          )}
          {chatId && normalizedQuery && (
            <button
              type="button"
              onClick={() => navigate(Paths.messageSearch(query, 1))}
              className="text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-900"
            >
              Search all messages instead
            </button>
          )}
        </div>
      </div>

      {!normalizedQuery ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
          <Search className="mx-auto h-8 w-8 text-zinc-300" />
          <p className="mt-3 text-sm font-medium text-zinc-700">Search the archive</p>
          <p className="mt-1 text-sm text-zinc-500">Enter words from a message to scan archived contents.</p>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : loading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-6 py-16 text-center shadow-sm">
          <SearchX className="mx-auto h-8 w-8 text-zinc-300" />
          <p className="mt-3 text-sm font-medium text-zinc-700">No archived messages matched</p>
          <p className="mt-1 text-sm text-zinc-500">Try a shorter phrase or different wording from the message text.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <section key={`${message.chatId}:${message.tgMessageId}`} className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <p className="text-sm font-medium text-zinc-900">{chatId ? (scopeTitle || chatId) : (message.chatName || message.chatId)}</p>
                <p className="text-xs text-zinc-500">{formatSearchTimestamp(message.metadata?.originalDate)}</p>
              </div>

              <div className="bg-zinc-50/70 py-2">
                <MessageCard
                  message={message}
                  onNavigateMessage={(id, targetChatId) => navigate(Paths.message(id, targetChatId || message.chatId))}
                  showSender
                  side="left"
                />
              </div>
            </section>
          ))}
        </div>
      )}

      {normalizedQuery && pagination && pagination.total > 1 && (
        <MessagesPagination current={pagination.current} total={pagination.total} onNavigate={(page) => navigate(Paths.messageSearch(query, page, chatId))} />
      )}
    </div>
  );
}
