import { FormEvent } from 'react';
import type { AgentStatusResponse } from '@shared/api';
import { Drawer } from '../ui/drawer';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { statusTone, liveStateTone, prettyState, prettyNumber, backgroundTaskLabel, isLiveIngestActive } from '../../lib/format';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className={`text-right ${highlight ? 'font-medium text-emerald-600' : 'text-zinc-700'}`}>{value}</span>
    </div>
  );
}

export function AgentDrawer({ open, onClose, agentStatus, progressLine, activeChatName, activeChatId, chatProgressLine, backfillChatStatsLine, reconcile, password, setPassword, feedback, isSending, submitTwoFactorPassword }: {
  open: boolean;
  onClose: () => void;
  agentStatus: AgentStatusResponse;
  progressLine: string | null;
  activeChatName: string | null;
  activeChatId: string | null;
  chatProgressLine: string | null;
  backfillChatStatsLine: string | null;
  reconcile: AgentStatusResponse['reconcile'];
  password: string;
  setPassword: (v: string) => void;
  feedback: string;
  isSending: boolean;
  submitTwoFactorPassword: (e: FormEvent) => void;
}) {
  const liveActive = isLiveIngestActive(agentStatus.state);
  const backgroundWork = backgroundTaskLabel(agentStatus.state);

  return (
    <Drawer open={open} onClose={onClose}>
      <div className="space-y-6">
        {/* Status header */}
        <div>
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${liveActive ? 'bg-emerald-500' : agentStatus.state === 'error' ? 'bg-red-500' : agentStatus.state === 'needs_auth' || agentStatus.state === 'awaiting_2fa_password' ? 'bg-amber-500 animate-pulse-slow' : 'bg-zinc-400'}`} />
            <span className="text-lg font-semibold text-zinc-900">{prettyState(agentStatus.state)}</span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">{agentStatus.message || 'Waiting for updates'}</p>
          <p className="mt-0.5 text-xs text-zinc-400">Updated {agentStatus.updatedAt ? new Date(agentStatus.updatedAt).toLocaleTimeString() : 'unknown'}</p>
        </div>

        {/* Connection */}
        <Section title="Connection">
          <div className="flex items-center gap-2">
            <Badge variant={liveStateTone(agentStatus.state)}>{liveActive ? 'Live: On' : 'Live: Off'}</Badge>
            {backgroundWork && <Badge variant="warning">{backgroundWork}</Badge>}
          </div>
        </Section>

        {/* Progress */}
        {(progressLine || activeChatName || backfillChatStatsLine || chatProgressLine) && (
          <Section title="Progress">
            <InfoRow label="Overall" value={progressLine} />
            <InfoRow label="Chat" value={activeChatName ? `${activeChatName}${activeChatId ? ` (${activeChatId})` : ''}` : null} />
            {backfillChatStatsLine && <p className="text-sm text-zinc-600">{backfillChatStatsLine}</p>}
            {chatProgressLine && (
              <div className="text-sm text-zinc-600">
                {chatProgressLine} scanned, <span className="font-medium text-emerald-600">+{prettyNumber(reconcile?.chatProgress?.importedMessages)}</span> imported, {prettyNumber(reconcile?.chatProgress?.skippedExistingMessages)} existing
              </div>
            )}
          </Section>
        )}

        {/* Totals */}
        {reconcile?.totals && (
          <Section title="Totals">
            <InfoRow label="Chats" value={`${prettyNumber(reconcile.totals.importedChats)}/${prettyNumber(reconcile.totals.scannedChats)}`} />
            <InfoRow label="Imported" value={`+${prettyNumber(reconcile.totals.importedMessages)}`} highlight />
            <InfoRow label="Existing" value={prettyNumber(reconcile.totals.skippedExistingMessages)} />
          </Section>
        )}

        {/* Auth: QR */}
        {agentStatus.state === 'needs_auth' && agentStatus.qrDataUrl && (
          <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
            <p className="text-sm font-medium text-amber-900">Authentication Required</p>
            <p className="mt-1 text-sm text-amber-700">Scan this QR code with the Telegram app on your phone.</p>
            <img src={agentStatus.qrDataUrl} alt="Telegram login QR" className="mt-3 h-44 w-44 rounded-lg border border-zinc-200 bg-white" />
          </div>
        )}

        {/* Auth: 2FA */}
        {agentStatus.state === 'awaiting_2fa_password' && (
          <form onSubmit={submitTwoFactorPassword} className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
            <p className="text-sm font-medium text-amber-900">Two-Factor Authentication</p>
            <p className="mt-1 text-sm text-amber-700">Telegram requires your cloud password to complete login.</p>
            <div className="mt-3 flex gap-2">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="2FA password" required className="max-w-xs bg-white" />
              <Button type="submit" disabled={isSending}>{isSending ? 'Sending...' : 'Submit'}</Button>
            </div>
            {feedback && <p className="mt-2 text-xs text-amber-700">{feedback}</p>}
          </form>
        )}
      </div>
    </Drawer>
  );
}
