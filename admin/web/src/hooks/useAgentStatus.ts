import { FormEvent, useEffect, useState } from 'react';
import { AgentStatusResponse, ROUTES } from '@shared/api';
import { prettyNumber, isLiveIngestActive, backgroundTaskLabel } from '../lib/format';

export function useAgentStatus() {
  const [agentStatus, setAgentStatus] = useState<AgentStatusResponse>({ state: 'loading', message: 'Loading...' });
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function loadAgentStatus() {
    const response = await fetch(ROUTES.api.agentStatus, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Failed to load agent status');
    setAgentStatus((await response.json()) as AgentStatusResponse);
  }

  useEffect(() => {
    loadAgentStatus().catch(() => {});
    const timer = setInterval(() => loadAgentStatus().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, []);

  // Auto-open drawer when auth is needed
  useEffect(() => {
    if (agentStatus.state === 'needs_auth' || agentStatus.state === 'awaiting_2fa_password') {
      setDrawerOpen(true);
    }
  }, [agentStatus.state]);

  async function submitTwoFactorPassword(event: FormEvent) {
    event.preventDefault();
    if (!password) { setFeedback('Password is required'); return; }
    setIsSending(true);
    setFeedback('');
    try {
      const response = await fetch(ROUTES.api.agentPassword, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message || 'Failed to submit 2FA password');
      }
      setPassword('');
      setFeedback('Password submitted to agent');
      await loadAgentStatus();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Failed to submit 2FA password');
    } finally {
      setIsSending(false);
    }
  }

  const backfill = agentStatus.backfill;
  const reconcile = agentStatus.reconcile;
  const liveIngestActive = isLiveIngestActive(agentStatus.state);
  const backgroundWork = backgroundTaskLabel(agentStatus.state);
  const agentNeedsAttention = agentStatus.state === 'needs_auth' || agentStatus.state === 'awaiting_2fa_password';
  const progressLine = agentStatus.progress?.total ? `${agentStatus.progress.processed || 0}/${agentStatus.progress.total}` : null;

  const activeChatName = (typeof backfill?.currentChatName === 'string' && backfill.currentChatName)
    || (typeof reconcile?.currentChatName === 'string' && reconcile.currentChatName)
    || null;
  const activeChatId = (typeof backfill?.currentChatId === 'string' && backfill.currentChatId)
    || (typeof reconcile?.currentChatId === 'string' && reconcile.currentChatId)
    || null;
  const chatProgressLine = reconcile?.chatProgress?.totalMessages
    ? `${prettyNumber(reconcile.chatProgress.processedMessages)}/${prettyNumber(reconcile.chatProgress.totalMessages)}`
    : null;
  const backfillChatStatsLine = backfill?.chatProgress
    ? `${prettyNumber(backfill.chatProgress.scannedMessages)} scanned, +${prettyNumber(backfill.chatProgress.importedMessages)} imported, ${prettyNumber(backfill.chatProgress.skippedExistingMessages)} existing${(backfill.chatProgress.enrichedMessages || 0) > 0 ? `, ${prettyNumber(backfill.chatProgress.enrichedMessages)} enriched` : ''}`
    : null;

  return {
    agentStatus,
    liveIngestActive,
    backgroundWork,
    agentNeedsAttention,
    progressLine,
    activeChatName,
    activeChatId,
    chatProgressLine,
    backfillChatStatsLine,
    reconcile,
    drawerOpen,
    setDrawerOpen,
    password,
    setPassword,
    feedback,
    isSending,
    submitTwoFactorPassword,
    loadAgentStatus,
  };
}
