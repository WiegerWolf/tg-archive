import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Paths, type CursorMessagesResponse } from '@shared/api';
import type { ArchiveMessage } from '../components/MessageCard';

const BATCH_SIZE = 50;
const SCROLL_SETTLE_MS = 80;

type LoadState = 'idle' | 'loading-older' | 'loading-newer' | 'loading-initial';

export function useChatScroll(chatId: string | null, options?: { around?: number; date?: string }) {
  const [messages, setMessages] = useState<ArchiveMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [dialogTypeInfo, setDialogTypeInfo] = useState<{ isUser?: boolean; isGroup?: boolean; isChannel?: boolean } | null>(null);
  const [dialogPeerId, setDialogPeerId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  // Ref for scroll container
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Track whether we should scroll to bottom after initial load
  const shouldScrollBottom = useRef(false);
  // Track the anchor message for "around" loads
  const anchorMessageId = useRef<number | null>(null);
  // Pending scroll restoration after prepending older messages
  const pendingScrollRestore = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);

  const fetchMessages = useCallback(async (
    cid: string,
    cursorOptions: { around?: number; before?: number; after?: number; date?: string },
  ): Promise<CursorMessagesResponse | null> => {
    try {
      const response = await fetch(
        Paths.apiDialogMessagesCursor(cid, { ...cursorOptions, limit: BATCH_SIZE }),
        { headers: { Accept: 'application/json' } },
      );
      if (!response.ok) throw new Error('Failed to load messages');
      return (await response.json()) as CursorMessagesResponse;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages');
      return null;
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!chatId) return;

    setLoadState('loading-initial');
    setError('');
    setMessages([]);
    setHasOlder(false);
    setHasNewer(false);
    setInitialLoadDone(false);

    const cursorOptions: { around?: number; date?: string } = {};
    if (options?.around) {
      cursorOptions.around = options.around;
      anchorMessageId.current = options.around;
      shouldScrollBottom.current = false;
    } else if (options?.date) {
      cursorOptions.date = options.date;
      shouldScrollBottom.current = false;
    } else {
      shouldScrollBottom.current = true;
    }

    fetchMessages(chatId, cursorOptions).then((result) => {
      if (!result) {
        setLoadState('idle');
        setInitialLoadDone(true);
        return;
      }
      setMessages(result.messages as ArchiveMessage[]);
      setHasOlder(result.hasOlder);
      setHasNewer(result.hasNewer);
      setDialogTypeInfo(result.dialogType ?? null);
      setDialogPeerId(result.chatId != null ? String(result.chatId) : null);
      setLoadState('idle');
      setInitialLoadDone(true);
    });
  }, [chatId, options?.around, options?.date, fetchMessages]);

  // Load older messages (scroll up)
  const loadOlder = useCallback(async () => {
    if (!chatId || loadState !== 'idle' || !hasOlder || messages.length === 0) return;
    setLoadState('loading-older');

    const oldestMsg = messages[0];
    const result = await fetchMessages(chatId, { before: oldestMsg.tgMessageId });
    if (!result || result.messages.length === 0) {
      setHasOlder(false);
      setLoadState('idle');
      return;
    }

    // Record scroll position before React updates the DOM
    const container = scrollRef.current;
    if (container) {
      pendingScrollRestore.current = {
        prevScrollHeight: container.scrollHeight,
        prevScrollTop: container.scrollTop,
      };
    }

    setMessages((prev) => [...(result.messages as ArchiveMessage[]), ...prev]);
    setHasOlder(result.hasOlder);
    setLoadState('idle');
  }, [chatId, loadState, hasOlder, messages, fetchMessages]);

  // Restore scroll position synchronously after DOM update from prepend
  useLayoutEffect(() => {
    const restore = pendingScrollRestore.current;
    if (!restore) return;
    pendingScrollRestore.current = null;
    const container = scrollRef.current;
    if (!container) return;
    const newScrollHeight = container.scrollHeight;
    container.scrollTop = restore.prevScrollTop + (newScrollHeight - restore.prevScrollHeight);
  }, [messages, scrollRef]);

  // Load newer messages (scroll down) - rarely needed
  const loadNewer = useCallback(async () => {
    if (!chatId || loadState !== 'idle' || !hasNewer || messages.length === 0) return;
    setLoadState('loading-newer');

    const newestMsg = messages[messages.length - 1];
    const result = await fetchMessages(chatId, { after: newestMsg.tgMessageId });
    if (!result || result.messages.length === 0) {
      setHasNewer(false);
      setLoadState('idle');
      return;
    }

    setMessages((prev) => [...prev, ...(result.messages as ArchiveMessage[])]);
    setHasNewer(result.hasNewer);
    setLoadState('idle');
  }, [chatId, loadState, hasNewer, messages, fetchMessages]);

  // Jump to newest messages
  const jumpToNewest = useCallback(async () => {
    if (!chatId) return;
    setLoadState('loading-initial');
    anchorMessageId.current = null;
    shouldScrollBottom.current = true;

    const result = await fetchMessages(chatId, {});
    if (!result) {
      setLoadState('idle');
      return;
    }
    setMessages(result.messages as ArchiveMessage[]);
    setHasOlder(result.hasOlder);
    setHasNewer(result.hasNewer);
    setLoadState('idle');
  }, [chatId, fetchMessages]);

  // Jump to a specific date
  const jumpToDate = useCallback(async (date: string) => {
    if (!chatId) return;
    setLoadState('loading-initial');
    shouldScrollBottom.current = false;
    anchorMessageId.current = null;

    const result = await fetchMessages(chatId, { date });
    if (!result) {
      setLoadState('idle');
      return;
    }
    setMessages(result.messages as ArchiveMessage[]);
    setHasOlder(result.hasOlder);
    setHasNewer(result.hasNewer);
    setLoadState('idle');

    // Scroll to top to see the target date
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, [chatId, fetchMessages]);

  // One-to-one detection
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
    hasOlder,
    hasNewer,
    loadState,
    loading: loadState === 'loading-initial',
    error,
    initialLoadDone,
    scrollRef,
    shouldScrollBottom,
    anchorMessageId,
    dialogTypeInfo,
    isOneToOne,
    getMessageSide,
    isSameSenderAsPrev,
    loadOlder,
    loadNewer,
    jumpToNewest,
    jumpToDate,
  };
}
