import { useEffect, useMemo, useState } from 'react';
import { Paths, type DialogTimelineResponse, type MessageHistoryResponse, type MessageSearchResponse, type MessageSearchResult } from '@shared/api';
import type { ArchiveMessage } from '../components/MessageCard';
import { navigate } from './useRouter';

const MESSAGE_HIGHLIGHT_MS = 2000;
const MESSAGE_SCROLL_STABILIZE_MS = 2200;

function stabilizeHashMessage(hash: string) {
  if (!hash.startsWith('#msg-')) return () => {};

  let frameId = 0;
  let closed = false;
  let settledTimer = 0;
  let highlightTimer = 0;
  const targetSelector = hash;

  const getTarget = () => {
    const element = document.querySelector(targetSelector);
    return element instanceof HTMLElement ? element : null;
  };

  const alignTarget = (behavior: ScrollBehavior) => {
    const target = getTarget();
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const delta = rect.top + rect.height / 2 - viewportHeight / 2;
    if (Math.abs(delta) <= 24) return;
    window.scrollBy({ top: delta, behavior });
  };

  const scheduleAlign = (behavior: ScrollBehavior) => {
    if (closed || frameId) return;
    frameId = window.requestAnimationFrame(() => {
      frameId = 0;
      alignTarget(behavior);
    });
  };

  const target = getTarget();
  if (!target) return () => {};

  target.classList.add('animate-card-highlight');
  highlightTimer = window.setTimeout(() => {
    target.classList.remove('animate-card-highlight');
  }, MESSAGE_HIGHLIGHT_MS);

  scheduleAlign('smooth');

  const onPotentialShift = () => {
    if (closed) return;
    scheduleAlign('auto');
  };

  document.addEventListener('load', onPotentialShift, true);
  document.addEventListener('loadedmetadata', onPotentialShift, true);
  window.addEventListener('resize', onPotentialShift);

  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => onPotentialShift())
    : null;

  const observedRoot = document.querySelector('main') || document.body || document.documentElement;
  resizeObserver?.observe(observedRoot);

  settledTimer = window.setTimeout(() => {
    cleanup();
  }, MESSAGE_SCROLL_STABILIZE_MS);

  function cleanup() {
    if (closed) return;
    closed = true;
    if (frameId) window.cancelAnimationFrame(frameId);
    if (settledTimer) window.clearTimeout(settledTimer);
    if (highlightTimer) window.clearTimeout(highlightTimer);
    target.classList.remove('animate-card-highlight');
    document.removeEventListener('load', onPotentialShift, true);
    document.removeEventListener('loadedmetadata', onPotentialShift, true);
    window.removeEventListener('resize', onPotentialShift);
    resizeObserver?.disconnect();
  }

  return cleanup;
}

export function useMessages(chatId: string | null, page: number | null) {
  const [messages, setMessages] = useState<ArchiveMessage[]>([]);
  const [pagination, setPagination] = useState<{ current: number; total: number; limit: number } | null>(null);
  const [dialogTypeInfo, setDialogTypeInfo] = useState<{ isUser?: boolean; isGroup?: boolean; isChannel?: boolean } | null>(null);
  const [dialogPeerId, setDialogPeerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!chatId || page == null) return;
    setLoading(true);
    setError('');
    setMessages([]);
    setPagination(null);

    fetch(Paths.apiDialogMessages(chatId, page, 50), { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load messages');
        const payload = (await response.json()) as {
          messages: ArchiveMessage[];
          pagination: { current: number; total: number; limit: number };
          chatId?: string | number;
          dialogType?: { isUser?: boolean; isGroup?: boolean; isChannel?: boolean };
        };
        setMessages(payload.messages);
        setPagination(payload.pagination);
        setDialogTypeInfo(payload.dialogType ?? null);
        setDialogPeerId(payload.chatId != null ? String(payload.chatId) : null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load messages'))
      .finally(() => setLoading(false));
  }, [chatId, page]);

  // Hash-based message highlighting
  useEffect(() => {
    let cleanup = () => {};

    const focusHashMessage = () => {
      cleanup();
      cleanup = stabilizeHashMessage(window.location.hash);
    };

    const timer = window.setTimeout(focusHashMessage, 120);
    window.addEventListener('hashchange', focusHashMessage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('hashchange', focusHashMessage);
      cleanup();
    };
  }, [messages]);

  const isOneToOne = useMemo(() => {
    const isUserChat = dialogTypeInfo?.isUser || (!dialogTypeInfo && messages.length > 0 && messages[0].chatType === 'User');
    const isGroupOrChannel = dialogTypeInfo?.isGroup || dialogTypeInfo?.isChannel;
    return !!(isUserChat && !isGroupOrChannel && dialogPeerId);
  }, [messages, dialogTypeInfo, dialogPeerId]);

  function getMessageSide(msg: ArchiveMessage): 'left' | 'right' {
    if (!isOneToOne || !msg.sender?.id) return 'left';
    const numericSenderId = msg.sender.id.replace(/^user/, '');
    return numericSenderId === dialogPeerId ? 'left' : 'right';
  }

  function isSameSenderAsPrev(msgs: ArchiveMessage[], idx: number): boolean {
    if (idx === 0) return false;
    const prev = msgs[idx - 1];
    const curr = msgs[idx];
    if (prev.type === 'service' || curr.type === 'service') return false;
    return prev.sender?.name === curr.sender?.name;
  }

  return {
    messages,
    pagination,
    dialogTypeInfo,
    dialogPeerId,
    loading,
    error,
    isOneToOne,
    getMessageSide,
    isSameSenderAsPrev,
    setDialogTypeInfo,
    setDialogPeerId,
  };
}

export function useDialogTimeline(chatId: string | null, page: number | null) {
  const [timeline, setTimeline] = useState<DialogTimelineResponse['timeline']>([]);
  const [pagination, setPagination] = useState<DialogTimelineResponse['pagination'] | null>(null);
  const [dialogTypeInfo, setDialogTypeInfo] = useState<DialogTimelineResponse['dialogType'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!chatId || page == null) return;
    setLoading(true);
    setError('');
    setTimeline([]);
    setPagination(null);

    fetch(Paths.apiDialogTimeline(chatId, page, 50), { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load dialog timeline');
        const payload = (await response.json()) as DialogTimelineResponse;
        setTimeline(payload.timeline);
        setPagination(payload.pagination);
        setDialogTypeInfo(payload.dialogType ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dialog timeline'))
      .finally(() => setLoading(false));
  }, [chatId, page]);

  return {
    timeline,
    pagination,
    dialogTypeInfo,
    loading,
    error,
  };
}

export function useMessageContext(messageId: string | null, chatId?: string | null) {
  const [error, setError] = useState('');

  useEffect(() => {
    if (!messageId) return;
    setError('');
    fetch(Paths.apiMessageContext(messageId, chatId || undefined), { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Message not found');
        const payload = (await response.json()) as { chatId: string | number; page: number; messageId: number };
        navigate(`${Paths.dialogMessages(payload.chatId, payload.page)}#msg-${payload.messageId}`, { replace: true });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to resolve message link'));
  }, [messageId, chatId]);

  return { error };
}

export function useMessageHistory(messageId: string | null, chatId?: string | null) {
  const [history, setHistory] = useState<MessageHistoryResponse['history']>([]);
  const [current, setCurrent] = useState<MessageHistoryResponse['current'] | null>(null);
  const [resolvedChatId, setResolvedChatId] = useState<string | null>(chatId || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!messageId) return;
    setLoading(true);
    setError('');
    setHistory([]);
    setCurrent(null);

    fetch(Paths.apiMessageHistory(messageId, chatId || undefined), { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load message history');
        const payload = (await response.json()) as MessageHistoryResponse;
        setHistory(payload.history);
        setCurrent(payload.current || null);
        setResolvedChatId(payload.chatId || chatId || null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load message history'))
      .finally(() => setLoading(false));
  }, [messageId, chatId]);

  return {
    history,
    current,
    chatId: resolvedChatId,
    loading,
    error,
  };
}

export function useArchivedMessageSearch(query: string | null, page: number | null, chatId?: string | null) {
  const [messages, setMessages] = useState<Array<ArchiveMessage & MessageSearchResult>>([]);
  const [pagination, setPagination] = useState<{ current: number; total: number; totalCount: number; limit: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const normalizedQuery = useMemo(() => query?.trim() || '', [query]);

  useEffect(() => {
    if (page == null) return;
    if (!normalizedQuery) {
      setMessages([]);
      setPagination(null);
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    setMessages([]);
    setPagination(null);

    fetch(Paths.apiMessageSearch(normalizedQuery, page, 20, chatId || undefined), { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to search archived messages');
        const payload = (await response.json()) as MessageSearchResponse;
        setMessages(payload.messages as Array<ArchiveMessage & MessageSearchResult>);
        setPagination(payload.pagination);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to search archived messages'))
      .finally(() => setLoading(false));
  }, [normalizedQuery, page, chatId]);

  return {
    messages,
    pagination,
    loading,
    error,
    query: normalizedQuery,
  };
}
