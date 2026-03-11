import { useEffect, useState, type FormEvent } from 'react';
import { ChevronRight, ChevronDown, Search } from 'lucide-react';
import { Paths } from '@shared/api';
import { navigate } from '../../hooks/useRouter';
import { statusColor, prettyState, isLiveIngestActive } from '../../lib/format';
import type { RouteState } from '../../types';
import { Input } from '../ui/input';

export function NavBar({ route, agentState, dialogTitle, searchScopeChatId, searchScopeTitle, onAgentClick, agentDrawerOpen }: {
  route: RouteState;
  agentState?: string;
  dialogTitle?: string;
  searchScopeChatId?: string | null;
  searchScopeTitle?: string;
  onAgentClick: () => void;
  agentDrawerOpen: boolean;
}) {
  const liveIngestActive = isLiveIngestActive(agentState);
  const chatId = (route.name === 'dialog' || route.name === 'messages' || route.name === 'timeline')
    ? route.chatId
    : route.name === 'messageHistory'
      ? route.chatId || null
      : null;
  const [searchText, setSearchText] = useState(route.name === 'search' ? route.query : '');
  const isScopedSearch = Boolean(searchScopeChatId);
  const searchPlaceholder = isScopedSearch
    ? `Search in ${searchScopeTitle || searchScopeChatId}`
    : 'Search all archived messages';

  useEffect(() => {
    setSearchText(route.name === 'search' ? route.query : '');
  }, [route]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(Paths.messageSearch(searchText, 1, searchScopeChatId || undefined));
  }

  return (
    <nav className="sticky top-0 z-40 border-b border-zinc-900 bg-zinc-950">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-5">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }} className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <img src="/logo.svg" alt="" className="h-6 w-6" />
            <span className="text-sm font-semibold text-white">TG Archive</span>
          </a>

          {route.name !== 'home' && route.name !== 'notFound' && (
            <div className="hidden items-center gap-1 text-sm sm:flex">
              <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }} className="rounded-md px-2 py-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300">
                Dialogs
              </a>
              {chatId && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                  {route.name === 'dialog' ? (
                    <span className="rounded-md px-2 py-1 text-zinc-300 truncate max-w-[200px]">{dialogTitle || chatId}</span>
                  ) : (
                    <a href={`/dialog/${chatId}`} onClick={(e) => { e.preventDefault(); navigate(`/dialog/${chatId}`); }} className="rounded-md px-2 py-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 truncate max-w-[200px]">
                      {dialogTitle || chatId}
                    </a>
                  )}
                </>
              )}
              {route.name === 'messages' && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                  <span className="rounded-md px-2 py-1 text-zinc-300">Messages</span>
                </>
              )}
              {route.name === 'timeline' && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                  <span className="rounded-md px-2 py-1 text-zinc-300">Timeline</span>
                </>
              )}
              {route.name === 'messageHistory' && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                  <span className="rounded-md px-2 py-1 text-zinc-300">Message History</span>
                </>
              )}
              {route.name === 'search' && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 text-zinc-600" />
                  <span className="rounded-md px-2 py-1 text-zinc-300">Search</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <form onSubmit={submitSearch} className="hidden items-center sm:flex">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 border-zinc-800 bg-zinc-900 pl-9 text-zinc-100 placeholder:text-zinc-500 focus-visible:border-indigo-500"
              />
            </div>
          </form>

          <button
            type="button"
            onClick={() => navigate(Paths.messageSearch('', 1, searchScopeChatId || undefined))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 sm:hidden"
            aria-label="Search archived messages"
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            onClick={onAgentClick}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-zinc-800"
          >
            <span className={`h-2 w-2 rounded-full ${statusColor(agentState)}`} />
            <span className="hidden text-zinc-400 sm:inline">{liveIngestActive ? 'Live' : prettyState(agentState)}</span>
            <ChevronDown className={`h-3.5 w-3.5 text-zinc-500 transition-transform ${agentDrawerOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
    </nav>
  );
}
