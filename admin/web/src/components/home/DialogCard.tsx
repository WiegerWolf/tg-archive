import type { MouseEvent } from 'react';
import { User, Users, Radio, Bot, BadgeCheck, Check, Trash2 } from 'lucide-react';
import { Paths, type DialogActivityItem } from '@shared/api';
import { Badge } from '../ui/badge';
import type { Dialog } from '../../types';
import { dialogType, dialogStatus, dialogDisplayTitle, dialogSubtitle, activityLabel, activityVariant } from '../../lib/format';
import { navigate } from '../../hooks/useRouter';

const TypeIcon = ({ type, className }: { type: string; className?: string }) => {
  const props = { className };
  if (type === 'group') return <Users {...props} />;
  if (type === 'channel') return <Radio {...props} />;
  if (type === 'bot') return <Bot {...props} />;
  return <User {...props} />;
};

const typeColor = (type: string) => {
  if (type === 'user') return 'text-emerald-500';
  if (type === 'group') return 'text-violet-500';
  if (type === 'channel') return 'text-sky-500';
  if (type === 'bot') return 'text-amber-500';
  return 'text-zinc-400';
};

function primaryBadge(entry: Dialog, type: string, activity?: DialogActivityItem) {
  const badges: Array<{ label: string; variant: 'info' | 'warning' | 'success' | 'muted' | 'danger' }> = [];
  const actBadge = activityLabel(activity?.phase);
  if (actBadge) badges.push({ label: actBadge, variant: activityVariant(activity?.phase) });
  const status = dialogStatus(entry);
  if (status === 'archived') badges.push({ label: 'Hidden', variant: 'muted' });
  if (type === 'group' && entry.entity?.className === 'ChatForbidden') badges.push({ label: 'Restricted', variant: 'danger' });
  if (entry.entity?.deleted) badges.push({ label: 'Deleted', variant: 'danger' });
  return badges.slice(0, 2);
}

function progressFraction(activity?: DialogActivityItem): number | null {
  if (!activity?.chatProgress) return null;
  if (activity.phase !== 'importing_backup' && activity.phase !== 'backfilling') return null;
  const scanned = activity.chatProgress.scannedMessages ?? 0;
  const imported = activity.chatProgress.importedMessages ?? 0;
  const existing = activity.chatProgress.skippedExistingMessages ?? 0;
  const total = scanned > 0 ? scanned : imported + existing;
  if (total <= 0) return null;
  return Math.min((imported + existing) / total, 1);
}

export function DialogCard({ entry, activity, liveSyncSelected, selectionMode = false, selected = false, onSelect }: {
  entry: Dialog;
  activity?: DialogActivityItem;
  liveSyncSelected: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const type = dialogType(entry);
  const status = dialogStatus(entry);
  const progress = progressFraction(activity);
  const selectionIndicator = (
    <div
      className={`absolute left-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${selected
        ? 'border-indigo-600 bg-indigo-600 text-white'
        : 'border-zinc-200 bg-white/95 text-transparent group-hover:text-zinc-300'}`}
      title={selected ? 'Selected' : 'Not selected'}
    >
      <Check className="h-3.5 w-3.5" />
    </div>
  );

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (selectionMode) {
      onSelect?.();
      return;
    }
    navigate(Paths.dialog(entry.tgDialogId));
  }

  if (status === 'deleted') {
    return (
      <a
        href={Paths.dialog(entry.tgDialogId)}
        className={`group relative flex items-center gap-3 rounded-xl bg-white p-3.5 shadow-sm ring-1 ring-zinc-900/5 opacity-50 transition-all hover:opacity-70 hover:shadow-md ${selectionMode && selected ? 'ring-2 ring-indigo-500/70 ring-offset-2 ring-offset-zinc-50' : ''}`}
        onClick={handleClick}
      >
        {selectionMode && selectionIndicator}
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-red-400">
          <Trash2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-500">Deleted Account</p>
          <p className="text-xs font-mono text-zinc-400">{entry.tgDialogId}</p>
        </div>
      </a>
    );
  }

  const title = dialogDisplayTitle(entry);
  const subtitle = dialogSubtitle(entry);
  const badges = primaryBadge(entry, type, activity);

  return (
    <a
      href={Paths.dialog(entry.tgDialogId)}
      className={`group relative flex items-center gap-3 rounded-xl bg-white p-3.5 shadow-sm ring-1 ring-zinc-900/5 transition-all hover:shadow-md hover:ring-zinc-900/10 ${status === 'archived' ? 'opacity-70' : ''} ${selectionMode && selected ? 'ring-2 ring-indigo-500/70 ring-offset-2 ring-offset-zinc-50' : ''}`}
      onClick={handleClick}
    >
      {selectionMode && selectionIndicator}
      <img src={entry.avatar ? Paths.media(entry.avatar) : '/logo.svg'} alt="" className="h-12 w-12 flex-shrink-0 rounded-full object-cover bg-zinc-100" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold text-zinc-900">{title}</h3>
          {(entry.verified || entry.entity?.verified) && <BadgeCheck className="h-3.5 w-3.5 flex-shrink-0 text-indigo-500" />}
        </div>
        <p className="truncate text-xs text-zinc-500">
          {subtitle}
          {entry.messageCount ? <span className="text-zinc-400"> · {entry.messageCount.toLocaleString()} msgs</span> : null}
          {(type === 'group' || type === 'channel') && entry.entity?.participantsCount ? (
            <span className="text-zinc-400"> · {entry.entity.participantsCount.toLocaleString()} {type === 'channel' ? 'subs' : 'members'}</span>
          ) : null}
        </p>
        {badges.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {badges.map((b) => <Badge key={b.label} variant={b.variant}>{b.label}</Badge>)}
          </div>
        )}
      </div>
      {/* Type icon + live sync dot */}
      <div className="absolute right-3 top-3 flex items-center gap-1.5">
        {liveSyncSelected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Live Sync enabled" />}
        <TypeIcon type={type} className={`h-4 w-4 opacity-50 ${typeColor(type)}`} />
      </div>
      {/* Activity progress bar */}
      {progress !== null && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden rounded-b-xl bg-zinc-100">
          <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </a>
  );
}
