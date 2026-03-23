import { type CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';
import { CornerUpRight } from 'lucide-react';
import { Paths } from '@shared/api';
import lottie from 'lottie-web';
import pako from 'pako';

type EntityPart = string | { type?: string; text?: string; href?: string; url?: string; language?: string };

type Media = {
  type?: string;
  file?: string;
  thumbnail?: string;
  mimeType?: string;
  fileName?: string;
  extension?: string;
  emoji?: string;
  duration?: number;
  width?: number;
  height?: number;
};

type Reaction = {
  type?: string;
  emoji?: string;
  customEmojiId?: string;
  count?: number;
  rawType?: string;
  chosenOrder?: number;
};

export type ReplyPreview = {
  senderName?: string;
  text?: string;
  mediaType?: string;
};

export type ArchiveMessage = {
  tgMessageId: number;
  chatId?: string;
  chatName?: string;
  chatType?: string;
  sender?: { name?: string; id?: string };
  reactions?: Reaction[];
  metadata?: { originalDate?: string | number | Date; source?: string; currentVersion?: number; lastMutationAt?: string | number | Date };
  edited?: { date?: string | number | Date };
  deleted?: { at?: string | number | Date; source?: string; note?: string };
  forwarded?: { from?: string };
  replyTo?: { messageId?: number };
  type?: string;
  service?: { type?: string; actor?: { name?: string }; details?: { duration?: number; discardReason?: string; pinnedMessageId?: number } };
  content?: {
    text?: string | EntityPart[];
    entities?: EntityPart[];
    media?: Media | null;
    location?: { latitude?: number; longitude?: number; title?: string } | null;
  };
};

// Consistent color for each sender name
const SENDER_COLORS = [
  'text-red-600',
  'text-blue-600',
  'text-green-700',
  'text-purple-600',
  'text-orange-600',
  'text-teal-600',
  'text-pink-600',
  'text-indigo-600',
];

function senderColor(name?: string) {
  if (!name) return SENDER_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

function toDate(value: unknown) {
  if (!value) return null;
  const date = new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(date: Date) {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function withLineBreaks(text: string) {
  return text.split('\n').flatMap((line, index, arr) => (index < arr.length - 1 ? [line, <br key={`br-${index}`} />] : [line]));
}

function normalizeHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function renderEntity(part: EntityPart, idx: number): ReactNode {
  if (typeof part === 'string') return <span key={idx}>{withLineBreaks(part)}</span>;
  const type = part.type || 'plain';
  const text = part.text || '';
  const content = withLineBreaks(text);
  const linkClass = 'text-blue-500 hover:underline';

  if (type === 'text_link' || type === 'link' || type === 'url') {
    const href = normalizeHref(part.href || part.url || text);
    return <a key={idx} href={href} target="_blank" rel="noreferrer" className={linkClass}>{content}</a>;
  }
  if (type === 'text_mention') return <a key={idx} href={part.href || '#'} target="_blank" rel="noreferrer" className={linkClass}>{content}</a>;
  if (type === 'mention') return <a key={idx} href={`https://t.me/${text.startsWith('@') ? text.slice(1) : text}`} target="_blank" rel="noreferrer" className={linkClass}>{content}</a>;
  if (type === 'email') return <a key={idx} href={`mailto:${text}`} className={linkClass}>{content}</a>;
  if (type === 'phone') return <a key={idx} href={`tel:${text}`} className={linkClass}>{content}</a>;
  if (type === 'bold') return <strong key={idx}>{content}</strong>;
  if (type === 'italic') return <em key={idx}>{content}</em>;
  if (type === 'underline') return <span key={idx} className="underline decoration-zinc-500">{content}</span>;
  if (type === 'strikethrough') return <span key={idx} className="line-through text-zinc-500">{content}</span>;
  if (type === 'code') return <code key={idx} className="rounded bg-zinc-700/10 px-1 py-0.5 font-mono text-[13px] text-zinc-800">{content}</code>;
  if (type === 'pre') return <pre key={idx} className="my-1.5 overflow-x-auto rounded-lg bg-zinc-800 p-3 font-mono text-xs leading-relaxed text-zinc-100">{text}</pre>;
  if (type === 'spoiler') return <span key={idx} className="rounded bg-zinc-800 px-1 py-0.5 text-zinc-800 hover:text-zinc-100 transition-colors cursor-pointer">{content}</span>;
  if (type === 'blockquote') return <blockquote key={idx} className="my-1 border-l-2 border-zinc-400 pl-2.5 text-zinc-600">{content}</blockquote>;
  if (type === 'hashtag') return <span key={idx} className={linkClass}>{content}</span>;
  if (type === 'cashtag') return <span key={idx} className="text-emerald-600 font-medium">{content}</span>;
  return <span key={idx}>{content}</span>;
}

function renderText(message: ArchiveMessage) {
  const text = message.content?.text;
  const entities = message.content?.entities;
  if (Array.isArray(text)) {
    const onlyCode = text.length === 2 && typeof text[0] !== 'string' && text[0]?.type === 'code' && (text[1] === '' || text[1] === undefined);
    if (onlyCode) {
      const codeText = typeof text[0] === 'string' ? text[0] : text[0]?.text || '';
      return <pre className="my-1.5 overflow-x-auto rounded-lg bg-zinc-800 p-3 font-mono text-xs leading-relaxed text-zinc-100">{codeText}</pre>;
    }
    return <>{text.map((part, idx) => renderEntity(part, idx))}</>;
  }
  if (typeof text === 'string' && text.length > 0) return <>{withLineBreaks(text)}</>;
  if (Array.isArray(entities)) return <>{entities.map((part, idx) => renderEntity(part, idx))}</>;
  return null;
}

function fileIcon(ext?: string) {
  const value = (ext || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(value)) return '🖼';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(value)) return '🎬';
  if (['mp3', 'ogg', 'wav', 'flac', 'm4a'].includes(value)) return '🎵';
  if (['pdf'].includes(value)) return '📄';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(value)) return '🗜';
  return '📎';
}

function AnimatedTgsSticker({ src, fallbackEmoji }: { src: string; fallbackEmoji?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let destroyed = false;
    const controller = new AbortController();
    let animation: ReturnType<typeof lottie.loadAnimation> | undefined;

    async function loadAnimation() {
      try {
        const response = await fetch(src, { signal: controller.signal });
        if (!response.ok) throw new Error(`Failed to load sticker: ${response.status}`);
        const compressed = new Uint8Array(await response.arrayBuffer());
        const jsonText = new TextDecoder().decode(pako.ungzip(compressed));
        const animationData = JSON.parse(jsonText);
        if (destroyed || !containerRef.current) return;
        animation = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
        });
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }

    loadAnimation();
    return () => { destroyed = true; controller.abort(); animation?.destroy(); };
  }, [src]);

  if (failed) return <span className="inline-flex h-28 w-28 items-center justify-center text-4xl">{fallbackEmoji || '✨'}</span>;
  return <div ref={containerRef} className="h-28 w-28" />;
}

function isWebmStickerLike(media: Media) {
  if (media.mimeType !== 'video/webm') return false;
  if (media.extension === 'webm' && media.fileName?.toLowerCase().includes('sticker')) return true;
  if (media.emoji) return true;
  if (media.width === 512 && media.height === 512 && typeof media.duration === 'number' && media.duration <= 10) return true;
  return false;
}

function mediaFrameStyle(media: Media, maxWidth = 320): CSSProperties | undefined {
  if (!media.width || !media.height || media.width <= 0 || media.height <= 0) return undefined;
  return {
    width: `${Math.min(media.width, maxWidth)}px`,
    aspectRatio: `${media.width} / ${media.height}`,
  };
}

function renderMedia(media: Media) {
  const type = media.type;
  const mediaUrl = media.file
    ? `${Paths.media(media.file)}${media.fileName ? `?filename=${encodeURIComponent(media.fileName)}` : ''}`
    : undefined;
  const visualStyle = mediaFrameStyle(media);
  if (!type) return null;

  if (type === 'animation' && media.file) {
    return (
      <div className="relative inline-block">
        <video autoPlay loop muted playsInline className="h-auto max-w-full rounded-lg sm:max-w-[320px]" style={visualStyle}>
          <source src={Paths.media(media.file)} type={media.mimeType || 'video/mp4'} />
        </video>
        <span className="absolute right-1.5 top-1.5 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white">GIF</span>
      </div>
    );
  }
  if (type === 'photo' && media.file) return <img src={Paths.media(media.file)} alt="Photo" className="h-auto max-w-full rounded-lg sm:max-w-[320px]" style={visualStyle} loading="lazy" />;
  if (type === 'document' && media.file && media.mimeType?.startsWith('image/')) {
    return <img src={Paths.media(media.file)} alt={media.fileName || 'Image attachment'} className="h-auto max-w-full rounded-lg sm:max-w-[320px]" style={visualStyle} loading="lazy" />;
  }
  if (type === 'document' && !media.file && media.mimeType === 'application/geo+json') {
    return <div className="inline-flex items-center gap-2 rounded-lg bg-white/60 px-3 py-2 text-sm text-zinc-600"><span>📍</span><span>Shared location</span></div>;
  }
  if (type === 'document' && !media.file && media.mimeType === 'application/vcard') {
    return <div className="inline-flex items-center gap-2 rounded-lg bg-white/60 px-3 py-2 text-sm text-zinc-600"><span>👤</span><span>Shared contact</span></div>;
  }
  if ((type === 'video' || type === 'video_file') && media.file) {
    return <video className="h-auto max-w-full rounded-lg sm:max-w-[320px]" style={visualStyle} controls preload="metadata" poster={media.thumbnail ? Paths.media(media.thumbnail) : undefined}><source src={Paths.media(media.file)} type={media.mimeType || 'video/mp4'} /></video>;
  }
  if (type === 'document' && mediaUrl && (media.mimeType === 'application/pdf' || media.extension === 'pdf')) {
    return (
      <div className="w-full max-w-[500px] overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <iframe src={mediaUrl} title={media.fileName || 'PDF preview'} className="h-[400px] w-full" loading="lazy" />
        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600">
          <span className="truncate">{media.fileName || 'PDF document'}</span>
          <a href={mediaUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">Open</a>
        </div>
      </div>
    );
  }
  if (type === 'voice' && media.file) {
    return <audio controls className="w-full max-w-[280px]"><source src={Paths.media(media.file)} type={media.mimeType || 'audio/ogg'} /></audio>;
  }
  if (mediaUrl && ((type === 'sticker' && media.extension === 'webm') || (type === 'document' && isWebmStickerLike(media)))) {
    return (
      <a className="inline-block" href={mediaUrl} target="_blank" rel="noreferrer" title="Open animated sticker">
        <video autoPlay loop muted playsInline className="h-28 w-28 object-contain" preload="metadata">
          <source src={mediaUrl} type="video/webm" />
        </video>
      </a>
    );
  }
  if (type === 'sticker') {
    if (mediaUrl && media.extension === 'tgs') {
      return (
        <a className="inline-block" href={mediaUrl} target="_blank" rel="noreferrer" title="Open animated sticker">
          <AnimatedTgsSticker src={mediaUrl} fallbackEmoji={media.emoji} />
        </a>
      );
    }
    if (media.file) return <img src={Paths.media(media.file)} alt="Sticker" className="h-24 w-24 object-contain" loading="lazy" />;
    return <div className="text-4xl">{media.emoji || '🙂'}</div>;
  }
  if ((type === 'document' || type === 'animation') && mediaUrl) {
    return (
      <a className="group/file inline-flex max-w-[300px] items-center gap-2.5 rounded-lg bg-white/60 p-2.5 text-sm transition-colors hover:bg-white/80" href={mediaUrl} target="_blank" rel="noreferrer">
        <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-base">{fileIcon(media.extension)}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-zinc-900">{media.fileName || 'Attachment'}</span>
          <span className="block text-xs text-zinc-500">{[media.extension, media.mimeType].filter(Boolean).join(' · ') || 'file'}</span>
        </span>
      </a>
    );
  }
  return <div className="text-xs text-zinc-400">[{type} media]</div>;
}

function renderService(serviceType?: string) {
  if (!serviceType) return null;
  if (serviceType === 'chat_created') return 'Chat created';
  if (serviceType === 'member_joined') return 'Member joined';
  if (serviceType === 'member_left') return 'Member left';
  if (serviceType === 'phone_call') return 'Phone call';
  if (serviceType === 'pin_message') return 'Message pinned';
  return serviceType;
}

function formatDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function normalizeReactionCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function reactionSymbol(reaction: Reaction) {
  if (reaction.type === 'emoji' && typeof reaction.emoji === 'string' && reaction.emoji.trim().length > 0) {
    return reaction.emoji;
  }
  if (reaction.type === 'custom_emoji') {
    return '⭐';
  }
  if (typeof reaction.rawType === 'string' && reaction.rawType.length > 0) {
    return reaction.rawType.replace(/^Reaction/, '') || 'Reaction';
  }
  return 'Reaction';
}

function normalizeReactions(reactions: Reaction[] | undefined): Reaction[] {
  if (!Array.isArray(reactions)) return [];

  const normalized = reactions
    .map((reaction) => {
      const count = normalizeReactionCount(reaction.count);
      if (!count || count <= 0) return undefined;
      return {
        ...reaction,
        count,
      };
    })
    .filter((reaction): reaction is Reaction => Boolean(reaction));

  normalized.sort((left, right) => {
    const leftOrder = typeof left.chosenOrder === 'number' ? left.chosenOrder : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.chosenOrder === 'number' ? right.chosenOrder : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return (right.count || 0) - (left.count || 0);
  });

  return normalized;
}

function renderReactions(reactions: Reaction[], align: 'left' | 'right' = 'left') {
  if (reactions.length === 0) return null;

  return (
    <div className={`mt-1 flex flex-wrap gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
      {reactions.map((reaction, index) => (
        <span
          key={`${reaction.type || 'unknown'}:${reaction.emoji || reaction.customEmojiId || reaction.rawType || 'x'}:${index}`}
          className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700"
          title={reaction.type === 'custom_emoji' && reaction.customEmojiId ? `Custom emoji ${reaction.customEmojiId}` : undefined}
        >
          <span>{reactionSymbol(reaction)}</span>
          <span className="font-medium">{reaction.count}</span>
        </span>
      ))}
    </div>
  );
}

/** Checks if a message is purely a sticker (no text alongside it) */
function isStickerOnly(message: ArchiveMessage) {
  const media = message.content?.media;
  const stickerLike = media?.type === 'sticker' || (media?.type === 'document' && isWebmStickerLike(media));
  if (!stickerLike) return false;
  const text = message.content?.text;
  const entities = message.content?.entities;
  const hasText = (typeof text === 'string' && text.length > 0) || (Array.isArray(text) && text.length > 0) || (Array.isArray(entities) && entities.length > 0);
  return !hasText;
}

export function DateSeparator({ date, onDateClick }: { date: Date; onDateClick?: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex justify-center py-2">
      <button
        type="button"
        onClick={onDateClick}
        className="rounded-full bg-zinc-200/90 px-3 py-1 text-xs font-medium text-zinc-600 shadow-sm backdrop-blur-sm transition-colors hover:bg-zinc-300/90 cursor-pointer"
      >
        {formatDate(date)}
      </button>
    </div>
  );
}

export function MessageCard({ message, onNavigateMessage, showSender, side = 'left', showHistoryLink = true, replyPreview }: { message: ArchiveMessage; onNavigateMessage: (id: number, chatId?: string) => void; showSender?: boolean; side?: 'left' | 'right'; showHistoryLink?: boolean; replyPreview?: ReplyPreview | null }) {
  const originalDate = toDate(message.metadata?.originalDate);
  const editedDate = toDate(message.edited?.date);
  const deletedDate = toDate(message.deleted?.at);
  const content = message.content || {};
  const isService = message.type === 'service';
  const stickerOnly = isStickerOnly(message);
  const isRight = side === 'right';
  const messageReactions = normalizeReactions(message.reactions);
  const messageChatId = message.chatId;
  const versionCount = typeof message.metadata?.currentVersion === 'number' && message.metadata.currentVersion > 0
    ? message.metadata.currentVersion
    : 1;
  const hasTextContent = (
    (typeof content.text === 'string' && content.text.length > 0)
    || (Array.isArray(content.text) && content.text.length > 0)
    || (Array.isArray(content.entities) && content.entities.length > 0)
  );
  const hasVisualContent = Boolean(content.media) || Boolean(content.location);
  const showEmptyFallback = !isService && !stickerOnly && !hasTextContent && !hasVisualContent;

  if (isService) {
    return (
      <div id={`msg-${message.tgMessageId}`} className="flex justify-center py-1.5">
        <span className="rounded-full bg-zinc-200 px-3 py-1 text-xs text-zinc-600">
            {message.service?.type === 'phone_call'
              ? message.service?.details?.duration
                ? <>Call {formatDuration(message.service.details.duration)}</>
                : <>Missed call{message.service?.details?.discardReason ? ` (${message.service.details.discardReason})` : ''}</>
              : message.service?.type === 'pin_message'
              ? <>{message.service?.actor?.name || 'Someone'} pinned {message.service?.details?.pinnedMessageId ? <a href={Paths.message(message.service.details.pinnedMessageId, messageChatId)} className="font-medium text-blue-600 hover:underline" onClick={(event) => { event.preventDefault(); onNavigateMessage(message.service!.details!.pinnedMessageId!, messageChatId); }}>#{message.service.details.pinnedMessageId}</a> : 'a message'}</>
              : renderService(message.service?.type)}
        </span>
      </div>
    );
  }

  // Sticker messages render without a bubble
  if (stickerOnly) {
    return (
      <div id={`msg-${message.tgMessageId}`} className={`group/msg flex px-2 py-0.5 sm:px-4 ${isRight ? 'justify-end' : ''}`}>
        <div className="max-w-[85%] sm:max-w-[65%]">
          {(showSender !== false && !isRight) && (
            <div className={`mb-0.5 text-[13px] font-medium ${senderColor(message.sender?.name)}`}>
              {message.sender?.name || 'Unknown'}
            </div>
          )}
          {message.forwarded?.from ? (
            <div className="mb-1 flex items-center gap-1 text-xs text-zinc-400">
              <CornerUpRight className="h-3 w-3" />
              Forwarded from {message.forwarded.from}
            </div>
          ) : null}
          {content.media ? <div>{renderMedia(content.media)}</div> : null}
          {renderReactions(messageReactions, isRight ? 'right' : 'left')}
          <div className={`mt-0.5 flex items-center gap-2 ${isRight ? 'justify-end' : ''}`}>
            <span className="text-[11px] text-zinc-400">{originalDate ? formatTime(originalDate) : ''}</span>
            {editedDate ? <span className="text-[11px] text-zinc-400 italic">edited</span> : null}
            {deletedDate ? <span className="text-[11px] text-rose-500 italic">deleted</span> : null}
            {showHistoryLink ? <a href={Paths.messageHistory(message.tgMessageId, messageChatId)} className="text-[11px] text-zinc-400 transition-colors hover:text-blue-500">v{versionCount}</a> : null}
            <a href={Paths.message(message.tgMessageId, messageChatId)} onClick={(e) => { e.preventDefault(); onNavigateMessage(message.tgMessageId, messageChatId); }} className="text-[11px] text-zinc-400 transition-colors hover:text-blue-500 sm:opacity-0 sm:group-hover/msg:opacity-100">#{message.tgMessageId}</a>
          </div>
        </div>
      </div>
    );
  }

  const bubbleClasses = isRight
    ? 'max-w-[85%] sm:max-w-[65%] rounded-2xl rounded-tr-md bg-indigo-50 shadow-sm ring-1 ring-indigo-100 px-3 py-1.5'
    : 'max-w-[85%] sm:max-w-[65%] rounded-2xl rounded-tl-md bg-white shadow-sm ring-1 ring-zinc-900/5 px-3 py-1.5';

  return (
    <div id={`msg-${message.tgMessageId}`} className={`group/msg flex px-2 py-0.5 sm:px-4 ${isRight ? 'justify-end' : ''}`}>
      <div className={bubbleClasses}>
        {/* Sender name - hidden for right-side bubbles in 1:1 */}
        {(showSender !== false && !isRight) && (
          <div className={`text-[13px] font-medium leading-snug ${senderColor(message.sender?.name)}`}>
            {message.sender?.name || 'Unknown'}
          </div>
        )}

        {/* Forwarded */}
        {message.forwarded?.from ? (
          <div className={`mt-0.5 flex items-center gap-1 rounded-md border-l-2 ${isRight ? 'border-indigo-300 bg-indigo-100/60' : 'border-blue-400 bg-blue-50/60'} px-2 py-1 text-xs text-zinc-500`}>
            <CornerUpRight className={`h-3 w-3 flex-shrink-0 ${isRight ? 'text-indigo-400' : 'text-blue-400'}`} />
            Forwarded from <span className="font-medium text-zinc-700">{message.forwarded.from}</span>
          </div>
        ) : null}

        {/* Reply */}
        {message.replyTo?.messageId ? (
          <button
            className={`mt-1 flex w-full flex-col rounded-md border-l-2 ${isRight ? 'border-indigo-300 bg-indigo-100/60' : 'border-blue-400 bg-blue-50/60'} px-2 py-1 text-left text-xs hover:brightness-95 transition-all`}
            onClick={() => onNavigateMessage(message.replyTo!.messageId!, messageChatId)}
          >
            {replyPreview ? (
              <>
                <span className={`font-medium leading-tight ${senderColor(replyPreview.senderName)}`}>{replyPreview.senderName || 'Unknown'}</span>
                <span className="text-zinc-500 line-clamp-1 leading-snug">
                  {replyPreview.mediaType && !replyPreview.text ? (
                    <span className="italic">{replyPreview.mediaType}</span>
                  ) : replyPreview.text ? (
                    <>{replyPreview.mediaType ? <span className="italic">{replyPreview.mediaType} </span> : null}{replyPreview.text}</>
                  ) : (
                    <span className="italic">Message</span>
                  )}
                </span>
              </>
            ) : (
              <span className="text-zinc-500">Reply to <span className="font-medium text-blue-600">#{message.replyTo.messageId}</span></span>
            )}
          </button>
        ) : null}

        {deletedDate ? (
          <div className={`mt-1 inline-flex items-center gap-1.5 rounded-md border ${isRight ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-rose-200 bg-rose-50 text-rose-700'} px-2 py-1 text-[11px]`}>
            <span>Deleted {formatTime(deletedDate)}</span>
            {message.deleted?.note ? <span className="text-rose-600/80">- {message.deleted.note}</span> : null}
          </div>
        ) : null}

        {/* Media */}
        {content.media ? <div className="mt-1.5 -mx-1">{renderMedia(content.media)}</div> : null}

        {/* Location */}
        {content.location ? (
          <a
            className="mt-1.5 -mx-1 block overflow-hidden rounded-lg"
            href={`https://www.openstreetmap.org/?mlat=${content.location.latitude}&mlon=${content.location.longitude}#map=16/${content.location.latitude}/${content.location.longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            <div className="relative">
              <iframe
                className="pointer-events-none h-40 w-full border-0 sm:h-48"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${(content.location.longitude ?? 0) - 0.008}%2C${(content.location.latitude ?? 0) - 0.005}%2C${(content.location.longitude ?? 0) + 0.008}%2C${(content.location.latitude ?? 0) + 0.005}&layer=mapnik&marker=${content.location.latitude}%2C${content.location.longitude}`}
                loading="lazy"
                title="Location"
              />
            </div>
            {content.location.title ? (
              <div className="bg-zinc-50 px-2.5 py-1.5 text-xs font-medium text-zinc-700">{content.location.title}</div>
            ) : (
              <div className="bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-500">{(content.location.latitude ?? 0).toFixed(5)}, {(content.location.longitude ?? 0).toFixed(5)}</div>
            )}
          </a>
        ) : null}

        {/* Text content */}
        {content.text || content.entities ? <div className="text-[14px] leading-relaxed text-zinc-800">{renderText(message)}</div> : null}

        {showEmptyFallback ? (
          <div className="text-[13px] italic text-zinc-500">Unsupported or empty Telegram message</div>
        ) : null}

        {renderReactions(messageReactions, isRight ? 'right' : 'left')}

        {/* Timestamp row */}
        <div className="mt-0.5 flex items-center justify-end gap-1.5">
          {editedDate ? <span className={`text-[11px] italic ${isRight ? 'text-indigo-400' : 'text-zinc-400'}`}>edited</span> : null}
          {deletedDate ? <span className="text-[11px] italic text-rose-500">deleted</span> : null}
          <span className={`text-[11px] ${isRight ? 'text-indigo-400' : 'text-zinc-400'}`}>{originalDate ? formatTime(originalDate) : ''}</span>
          {showHistoryLink ? <a href={Paths.messageHistory(message.tgMessageId, messageChatId)} className="text-[11px] text-zinc-400 transition-colors hover:text-blue-500">v{versionCount}</a> : null}
          <a href={Paths.message(message.tgMessageId, messageChatId)} onClick={(e) => { e.preventDefault(); onNavigateMessage(message.tgMessageId, messageChatId); }} className="text-[11px] text-zinc-400 transition-colors hover:text-blue-500 sm:opacity-0 sm:group-hover/msg:opacity-100">#{message.tgMessageId}</a>
        </div>
      </div>
    </div>
  );
}
