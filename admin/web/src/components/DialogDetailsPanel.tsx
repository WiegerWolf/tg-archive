import type { ReactNode } from 'react';
import type { Dialog } from '../types';
import { Badge } from './ui/badge';
import { dialogType } from '../lib/format';

function formatDateTime(value: unknown) {
  if (!value) return null;
  if (typeof value === 'number') {
    const date = new Date(value > 1e12 ? value : value * 1000);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
    return null;
  }

  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">{title}</h3>
      <div className="mt-2 divide-y divide-zinc-50">{children}</div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className={`text-right text-zinc-900 ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</span>
    </div>
  );
}

function StatusFlags({ dialog }: { dialog: Dialog }) {
  const flags: Array<{ label: string; variant: 'success' | 'danger' | 'warning' | 'info' | 'muted' }> = [];
  if (dialog.archived) flags.push({ label: 'Archived', variant: 'muted' });
  if (dialog.verified || dialog.entity?.verified) flags.push({ label: 'Verified', variant: 'info' });
  if (dialog.premium) flags.push({ label: 'Premium', variant: 'warning' });
  if (dialog.scam) flags.push({ label: 'Scam', variant: 'danger' });
  if (dialog.fake) flags.push({ label: 'Fake', variant: 'danger' });
  if (dialog.restricted || dialog.entity?.className === 'ChatForbidden') flags.push({ label: 'Restricted', variant: 'danger' });
  if (dialog.entity?.deleted) flags.push({ label: 'Deleted', variant: 'danger' });
  if (dialog.entity?.noforwards) flags.push({ label: 'No forwards', variant: 'danger' });

  if (flags.length === 0) return null;

  return (
    <div>
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Flags</h3>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {flags.map((flag) => <Badge key={flag.label} variant={flag.variant}>{flag.label}</Badge>)}
      </div>
    </div>
  );
}

function ArchiveSection({ dialog }: { dialog: Dialog }) {
  const updateCount = typeof dialog.metadata?.updateCount === 'number' && dialog.metadata.updateCount > 0
    ? dialog.metadata.updateCount.toLocaleString()
    : null;

  return (
    <Section title="Archive">
      <Row label="First archived" value={formatDateTime(dialog.metadata?.firstArchived)} />
      <Row label="Last updated" value={formatDateTime(dialog.metadata?.lastUpdated)} />
      <Row label="Updates" value={updateCount} />
      <Row label="Folder" value={typeof dialog.folderId === 'number' ? String(dialog.folderId) : null} />
      <Row label="Created" value={formatDateTime(dialog.date || dialog.entity?.date)} />
    </Section>
  );
}

function UserSection({ dialog }: { dialog: Dialog }) {
  return (
    <Section title="Contact">
      <Row label="Username" value={dialog.username ? `@${dialog.username}` : null} />
      <Row label="Phone" value={dialog.entity?.phone || null} mono={Boolean(dialog.entity?.phone)} />
      <Row label="In contacts" value={typeof dialog.entity?.contact === 'boolean' ? (dialog.entity.contact ? 'Yes' : 'No') : null} />
      <Row label="Mutual contact" value={typeof dialog.entity?.mutualContact === 'boolean' ? (dialog.entity.mutualContact ? 'Yes' : 'No') : null} />
    </Section>
  );
}

function BotSection({ dialog }: { dialog: Dialog }) {
  return (
    <Section title="Bot">
      <Row label="Username" value={dialog.entity?.username ? `@${dialog.entity.username}` : null} />
      <Row label="Info version" value={typeof dialog.entity?.botInfoVersion === 'number' ? String(dialog.entity.botInfoVersion) : null} />
      <Row label="Can edit" value={typeof dialog.entity?.botCanEdit === 'boolean' ? (dialog.entity.botCanEdit ? 'Yes' : 'No') : null} />
      <Row label="Inline geo" value={typeof dialog.entity?.botInlineGeo === 'boolean' ? (dialog.entity.botInlineGeo ? 'Enabled' : 'Disabled') : null} />
      <Row label="Chat history" value={typeof dialog.entity?.botChatHistory === 'boolean' ? (dialog.entity.botChatHistory ? 'Enabled' : 'Disabled') : null} />
      <Row label="No chats" value={typeof dialog.entity?.botNochats === 'boolean' ? (dialog.entity.botNochats ? 'Yes' : 'No') : null} />
    </Section>
  );
}

function GroupSection({ dialog }: { dialog: Dialog }) {
  const rights = Object.entries(dialog.entity?.adminRights || {}).filter(([, enabled]) => enabled);

  return (
    <>
      <Section title="Group">
        <Row label="Members" value={typeof dialog.entity?.participantsCount === 'number' ? dialog.entity.participantsCount.toLocaleString() : 'Unknown'} />
        <Row label="Access" value={dialog.entity?.className === 'ChatForbidden' ? 'Restricted' : 'Available'} />
      </Section>
      {rights.length > 0 && (
        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Admin rights</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {rights.map(([key]) => <Badge key={key} variant="success">{key}</Badge>)}
          </div>
        </div>
      )}
    </>
  );
}

function ChannelSection({ dialog }: { dialog: Dialog }) {
  const usernames = dialog.entity?.usernames || [];

  return (
    <>
      <Section title="Channel">
        <Row label="Subscribers" value={typeof dialog.entity?.participantsCount === 'number' ? dialog.entity.participantsCount.toLocaleString() : null} />
        <Row label="Level" value={typeof dialog.entity?.level === 'number' ? String(dialog.entity.level) : null} />
        <Row label="Broadcast" value={typeof dialog.entity?.broadcast === 'boolean' ? (dialog.entity.broadcast ? 'Yes' : 'No') : null} />
        <Row label="Signatures" value={typeof dialog.entity?.signatures === 'boolean' ? (dialog.entity.signatures ? 'On' : 'Off') : null} />
      </Section>
      {usernames.length > 0 && (
        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Usernames</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {usernames.map((entry) => (
              <Badge key={entry.username || 'unknown'} variant={entry.active ? 'info' : 'muted'}>
                @{entry.username || 'unknown'}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function DialogDetailsPanel({ dialog }: { dialog: Dialog }) {
  const type = dialogType(dialog);
  const isDeleted = Boolean(dialog.isUser && dialog.entity?.deleted);

  return (
    <div className="space-y-5">
      <StatusFlags dialog={dialog} />
      <ArchiveSection dialog={dialog} />
      {isDeleted ? (
        <Section title="Account state">
          <Row label="Status" value="Deactivated" />
          <Row label="Last seen" value={formatDateTime(dialog.metadata?.lastUpdated)} />
        </Section>
      ) : type === 'bot' ? (
        <BotSection dialog={dialog} />
      ) : type === 'group' ? (
        <GroupSection dialog={dialog} />
      ) : type === 'channel' ? (
        <ChannelSection dialog={dialog} />
      ) : (
        <UserSection dialog={dialog} />
      )}
    </div>
  );
}
