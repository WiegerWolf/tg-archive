import { useCallback, useEffect, useRef, useState } from 'react';
import { Paths } from '@shared/api';
import type { Dialog } from '../types';
import type { ArchiveMessage } from '../components/MessageCard';

export function useDialogDetail(chatId: string | null) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [messages, setMessages] = useState<ArchiveMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  const loadDetail = useCallback(async (preserveCurrent = false) => {
    if (!chatId) {
      requestIdRef.current += 1;
      setDialog(null);
      setMessages([]);
      setLoading(false);
      setRefreshing(false);
      setError('');
      return;
    }

    const requestId = ++requestIdRef.current;
    setError('');

    if (preserveCurrent) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setDialog(null);
      setMessages([]);
    }

    try {
      const response = await fetch(Paths.apiDialog(chatId), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Dialog not found');
      const payload = (await response.json()) as { dialog: Dialog; messages: ArchiveMessage[] };
      if (requestId !== requestIdRef.current) return;
      setDialog(payload.dialog);
      setMessages(payload.messages);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load dialog');
    } finally {
      if (requestId !== requestIdRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [chatId]);

  useEffect(() => {
    if (!chatId) {
      setDialog(null);
      setMessages([]);
      setLoading(false);
      setRefreshing(false);
      setError('');
      return;
    }

    void loadDetail(false);
    const timer = window.setInterval(() => {
      void loadDetail(true);
    }, 15000);

    return () => window.clearInterval(timer);
  }, [chatId, loadDetail]);

  return {
    dialog,
    messages,
    loading,
    refreshing,
    error,
    reload: () => loadDetail(true),
  };
}
