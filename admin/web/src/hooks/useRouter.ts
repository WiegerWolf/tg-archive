import { useEffect, useState } from 'react';
import type { RouteState } from '../types';

function parseCurrentRoute(): RouteState {
  const { pathname, search } = window.location;
  if (pathname === '/') return { name: 'home' };
  if (pathname === '/messages/search') {
    const params = new URLSearchParams(search);
    const pageFromQuery = Number(params.get('page') || '1');
    const chatId = params.get('chatId')?.trim() || undefined;
    return {
      name: 'search',
      query: params.get('q') || '',
      page: Number.isFinite(pageFromQuery) && pageFromQuery > 0 ? pageFromQuery : 1,
      ...(chatId ? { chatId } : {}),
    };
  }
  const dialogMatch = pathname.match(/^\/dialog\/(-?\d+)$/);
  if (dialogMatch) return { name: 'dialog', chatId: dialogMatch[1] };
  const messagesMatch = pathname.match(/^\/dialog\/(-?\d+)\/messages$/);
  if (messagesMatch) {
    const pageFromQuery = Number(new URLSearchParams(search).get('page') || '1');
    return { name: 'messages', chatId: messagesMatch[1], page: Number.isFinite(pageFromQuery) && pageFromQuery > 0 ? pageFromQuery : 1 };
  }
  const timelineMatch = pathname.match(/^\/dialog\/(-?\d+)\/timeline$/);
  if (timelineMatch) {
    const pageFromQuery = Number(new URLSearchParams(search).get('page') || '1');
    return { name: 'timeline', chatId: timelineMatch[1], page: Number.isFinite(pageFromQuery) && pageFromQuery > 0 ? pageFromQuery : 1 };
  }
  const messageMatch = pathname.match(/^\/message\/(\d+)$/);
  if (messageMatch) {
    const chatId = new URLSearchParams(search).get('chatId')?.trim() || undefined;
    return { name: 'message', messageId: messageMatch[1], ...(chatId ? { chatId } : {}) };
  }
  const messageHistoryMatch = pathname.match(/^\/message\/(\d+)\/history$/);
  if (messageHistoryMatch) {
    const chatId = new URLSearchParams(search).get('chatId')?.trim() || undefined;
    return { name: 'messageHistory', messageId: messageHistoryMatch[1], ...(chatId ? { chatId } : {}) };
  }
  return { name: 'notFound' };
}

export function navigate(path: string, options?: { replace?: boolean }) {
  const method = options?.replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRouter() {
  const [route, setRoute] = useState<RouteState>(parseCurrentRoute());

  useEffect(() => {
    const onPopState = () => setRoute(parseCurrentRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return route;
}
