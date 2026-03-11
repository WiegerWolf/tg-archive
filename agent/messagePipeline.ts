import { LocationInfo, MediaInfo, MessageDocument, MessageReaction, ServiceInfo, TextEntity, TextPart } from './types';

export interface MessageBuildInput {
  type: MessageDocument['type'];
  tgMessageId: number;
  tgChatId: string | number | bigint;
  chatName?: string;
  chatType?: string;
  senderName?: string;
  senderId?: string | number | bigint;
  text?: string | Array<string | TextPart>;
  entities?: TextEntity[];
  media?: MediaInfo;
  location?: LocationInfo;
  service?: ServiceInfo;
  reactions?: MessageReaction[];
  replyToMessageId?: number;
  forwardedFrom?: string;
  edited?: {
    date: Date;
    unixtime: number;
  };
  originalDate: Date;
  originalUnixtime: number;
  source: MessageDocument['metadata']['source'];
  sourceDir?: string;
  importedAt?: Date;
}

export interface MessageRepairFlags {
  sender: boolean;
  chat: boolean;
  formatting: boolean;
  reply: boolean;
  geo: boolean;
  reactions: boolean;
  service: boolean;
  payload: boolean;
}

export interface MessageRepairOperations {
  set: Record<string, unknown>;
  unset: Record<string, ''>;
  changed: boolean;
  flags: MessageRepairFlags;
}

function toBigInt(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') {
    return value;
  }

  try {
    return BigInt(String(value));
  } catch {
    return BigInt(0);
  }
}

function normalizeText(text: MessageBuildInput['text']): string | TextPart[] | undefined {
  if (typeof text === 'string') {
    return text;
  }

  if (!Array.isArray(text)) {
    return undefined;
  }

  const parts: TextPart[] = [];
  for (const part of text) {
    if (typeof part === 'string') {
      parts.push({ type: 'plain', text: part });
      continue;
    }

    if (!part || typeof part.text !== 'string') {
      continue;
    }

    parts.push({
      type: part.type || 'plain',
      text: part.text,
      href: part.href,
      url: part.url,
      language: part.language,
    });
  }

  return parts.length > 0 ? parts : undefined;
}

function toJoinedText(text: MessageBuildInput['text']): string {
  if (typeof text === 'string') {
    return text;
  }

  if (!Array.isArray(text)) {
    return '';
  }

  return text
    .map((part) => (typeof part === 'string' ? part : (part?.text || '')))
    .join(' ')
    .trim();
}

function toSignedDms(degrees: number, minutes: number, seconds: number, hemisphere: string): number {
  const absolute = degrees + (minutes / 60) + (seconds / 3600);
  const sign = hemisphere === 'S' || hemisphere === 'W' ? -1 : 1;
  return absolute * sign;
}

function parseDmsCoordinates(input: string): LocationInfo | undefined {
  const dmsPattern = /(\d{1,2})\s*[°º]\s*(\d{1,2})\s*['’]\s*(\d{1,2}(?:\.\d+)?)\s*["”]?\s*([NS])\s*[,; ]+\s*(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['’]\s*(\d{1,2}(?:\.\d+)?)\s*["”]?\s*([EW])/i;
  const match = input.match(dmsPattern);
  if (!match) {
    return undefined;
  }

  const latDeg = Number(match[1]);
  const latMin = Number(match[2]);
  const latSec = Number(match[3]);
  const latHem = (match[4] || '').toUpperCase();
  const lonDeg = Number(match[5]);
  const lonMin = Number(match[6]);
  const lonSec = Number(match[7]);
  const lonHem = (match[8] || '').toUpperCase();

  if (
    !Number.isFinite(latDeg) || !Number.isFinite(latMin) || !Number.isFinite(latSec)
    || !Number.isFinite(lonDeg) || !Number.isFinite(lonMin) || !Number.isFinite(lonSec)
  ) {
    return undefined;
  }

  const latitude = toSignedDms(latDeg, latMin, latSec, latHem);
  const longitude = toSignedDms(lonDeg, lonMin, lonSec, lonHem);

  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return undefined;
  }

  return { latitude, longitude };
}

function inferLocationFromText(text: MessageBuildInput['text']): LocationInfo | undefined {
  const joinedText = toJoinedText(text);
  if (!joinedText) {
    return undefined;
  }

  return parseDmsCoordinates(joinedText);
}

function normalizeReactions(reactions: MessageBuildInput['reactions']): MessageReaction[] | undefined {
  if (!Array.isArray(reactions)) {
    return undefined;
  }

  const normalized = reactions
    .map((reaction) => {
      if (!reaction || typeof reaction !== 'object') {
        return undefined;
      }

      const type = reaction.type === 'emoji' || reaction.type === 'custom_emoji'
        ? reaction.type
        : 'unknown';
      const count = typeof reaction.count === 'number' && Number.isFinite(reaction.count)
        ? reaction.count
        : Number.parseInt(String(reaction.count || ''), 10);

      if (!Number.isFinite(count) || count <= 0) {
        return undefined;
      }

      const entry: MessageReaction = {
        type,
        count,
      };

      if (typeof reaction.emoji === 'string' && reaction.emoji.trim().length > 0) {
        entry.emoji = reaction.emoji;
      }

      if (typeof reaction.customEmojiId === 'string' && reaction.customEmojiId.trim().length > 0) {
        entry.customEmojiId = reaction.customEmojiId;
      }

      if (typeof reaction.chosenOrder === 'number' && Number.isFinite(reaction.chosenOrder)) {
        entry.chosenOrder = reaction.chosenOrder;
      }

      if (typeof reaction.rawType === 'string' && reaction.rawType.trim().length > 0) {
        entry.rawType = reaction.rawType;
      }

      return entry;
    })
    .filter((reaction): reaction is MessageReaction => Boolean(reaction));

  return normalized.length > 0 ? normalized : undefined;
}

function reactionsEqual(left: MessageReaction[] | undefined, right: MessageReaction[] | undefined): boolean {
  const normalize = (items: MessageReaction[] | undefined) => (Array.isArray(items) ? items : [])
    .map((item) => ({
      type: item.type,
      emoji: item.emoji || '',
      customEmojiId: item.customEmojiId || '',
      count: item.count,
      chosenOrder: typeof item.chosenOrder === 'number' ? item.chosenOrder : -1,
      rawType: item.rawType || '',
    }))
    .sort((a, b) => {
      const keyA = `${a.type}|${a.emoji}|${a.customEmojiId}|${a.rawType}|${a.chosenOrder}`;
      const keyB = `${b.type}|${b.emoji}|${b.customEmojiId}|${b.rawType}|${b.chosenOrder}`;
      return keyA.localeCompare(keyB);
    });

  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function hasMeaningfulText(text: MessageDocument['content']['text'] | undefined): boolean {
  if (typeof text === 'string') {
    return text.length > 0;
  }

  if (!Array.isArray(text)) {
    return false;
  }

  return text.some((part) => {
    if (typeof part === 'string') {
      return part.length > 0;
    }
    return typeof part?.text === 'string' && part.text.length > 0;
  });
}

function resolveContentType(params: {
  type: MessageDocument['type'];
  text: MessageDocument['content']['text'] | undefined;
  media?: MediaInfo;
  location?: LocationInfo;
}): MessageDocument['content']['type'] {
  if (params.type === 'service') {
    return 'service';
  }

  const hasText = hasMeaningfulText(params.text);
  const hasMedia = Boolean(params.media);
  const hasLocation = Boolean(params.location);

  if (hasLocation && hasText) {
    return 'mixed';
  }
  if (hasLocation) {
    return 'location';
  }
  if (hasMedia && hasText) {
    return 'mixed';
  }
  if (hasMedia) {
    return 'media';
  }
  return 'text';
}

export function createMessageDocument(input: MessageBuildInput): MessageDocument {
  const normalizedText = normalizeText(input.text);
  const normalizedEntities = Array.isArray(input.entities) && input.entities.length > 0
    ? input.entities
    : undefined;
  const normalizedReactions = normalizeReactions(input.reactions);
  const resolvedLocation = input.location || inferLocationFromText(input.text);
  const normalizedSenderName = typeof input.senderName === 'string' && input.senderName.trim().length > 0
    ? input.senderName.trim()
    : 'Unknown';
  const normalizedSenderId = input.senderId !== undefined && input.senderId !== null
    ? String(input.senderId)
    : 'unknown';

  const content: MessageDocument['content'] = {
    type: resolveContentType({
      type: input.type,
      text: normalizedText,
      media: input.media,
      location: resolvedLocation,
    }),
  };

  if (normalizedText !== undefined) {
    content.text = normalizedText;
  }

  if (normalizedEntities) {
    content.entities = normalizedEntities;
  }

  if (input.media) {
    content.media = input.media;
  }

  if (resolvedLocation) {
    content.location = resolvedLocation;
  }

  if (input.service) {
    content.service = input.service;
  }

  const messageDoc: MessageDocument = {
    tgMessageId: input.tgMessageId,
    tgChatId: toBigInt(input.tgChatId),
    chatName: input.chatName && input.chatName.trim().length > 0 ? input.chatName : 'Unknown',
    chatType: input.chatType && input.chatType.trim().length > 0 ? input.chatType : 'unknown',
    sender: {
      name: normalizedSenderName,
      id: normalizedSenderId,
    },
    type: input.type,
    content,
    metadata: {
      importedAt: input.importedAt || new Date(),
      originalDate: input.originalDate,
      originalUnixtime: input.originalUnixtime,
      source: input.source,
      ...(input.sourceDir ? { sourceDir: input.sourceDir } : {}),
    },
  };

  if (typeof input.replyToMessageId === 'number' && Number.isFinite(input.replyToMessageId)) {
    messageDoc.replyTo = {
      messageId: input.replyToMessageId,
    };
  }

  if (input.forwardedFrom) {
    messageDoc.forwarded = {
      from: input.forwardedFrom,
    };
  }

  if (input.edited) {
    messageDoc.edited = {
      date: input.edited.date,
      unixtime: input.edited.unixtime,
    };
  }

  if (input.type === 'service' && input.service) {
    messageDoc.service = input.service;
  }

  if (normalizedReactions) {
    messageDoc.reactions = normalizedReactions;
  }

  return messageDoc;
}

function isUnknownValue(value: unknown): boolean {
  if (typeof value !== 'string') {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized === 'unknown';
}

function hasValidLocation(value: unknown): value is LocationInfo {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const maybeLocation = value as LocationInfo;
  return typeof maybeLocation.latitude === 'number' && typeof maybeLocation.longitude === 'number';
}

function hasAnyMedia(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.keys(value as Record<string, unknown>).length > 0;
}

function docHasRenderablePayload(doc: any): boolean {
  if (!doc || typeof doc !== 'object') {
    return false;
  }

  if (doc.type === 'service' || doc.content?.type === 'service' || doc.service || doc.content?.service) {
    return true;
  }

  if (hasMeaningfulText(doc.content?.text)) {
    return true;
  }

  if (hasValidLocation(doc.content?.location)) {
    return true;
  }

  if (hasAnyMedia(doc.content?.media)) {
    return true;
  }

  return false;
}

export function buildMessageRepairOperations(
  existingDoc: any,
  candidateDoc: MessageDocument,
): MessageRepairOperations {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  const flags: MessageRepairFlags = {
    sender: false,
    chat: false,
    formatting: false,
    reply: false,
    geo: false,
    reactions: false,
    service: false,
    payload: false,
  };

  const existingSource = existingDoc?.metadata?.source;
  const isLiveExisting = existingSource === 'live';

  const candidateIsService = candidateDoc.type === 'service' && Boolean(candidateDoc.service);
  if (candidateIsService && existingDoc?.type !== 'service') {
    set.type = 'service';
    set.service = candidateDoc.service;
    set['content.type'] = 'service';
    set['content.service'] = candidateDoc.service;
    unset['content.media'] = '';
    unset['content.location'] = '';
    flags.service = true;
  }

  if (isUnknownValue(existingDoc?.chatName) && !isUnknownValue(candidateDoc.chatName)) {
    set.chatName = candidateDoc.chatName;
    flags.chat = true;
  }

  if (isUnknownValue(existingDoc?.chatType) && !isUnknownValue(candidateDoc.chatType)) {
    set.chatType = candidateDoc.chatType;
    flags.chat = true;
  }

  const existingSenderName = existingDoc?.sender?.name;
  const existingSenderId = existingDoc?.sender?.id;
  const candidateSenderName = candidateDoc.sender?.name;
  const candidateSenderId = candidateDoc.sender?.id;

  if (isUnknownValue(existingSenderName) && !isUnknownValue(candidateSenderName)) {
    set['sender.name'] = candidateSenderName;
    flags.sender = true;
  }

  if (isUnknownValue(existingSenderId) && !isUnknownValue(candidateSenderId)) {
    set['sender.id'] = candidateSenderId;
    flags.sender = true;
  }

  if (isLiveExisting && candidateDoc.metadata.source === 'live') {
    const candidateEntities = Array.isArray(candidateDoc.content.entities) ? candidateDoc.content.entities : [];
    const existingEntities = Array.isArray(existingDoc?.content?.entities) ? existingDoc.content.entities : [];
    const existingTextStructured = Array.isArray(existingDoc?.content?.text);

    if (candidateEntities.length > 0 && (existingEntities.length === 0 || !existingTextStructured)) {
      set['content.entities'] = candidateEntities;
      set['content.text'] = candidateDoc.content.text;
      flags.formatting = true;
    }

    const candidateReplyTo = candidateDoc.replyTo?.messageId;
    const existingReplyTo = existingDoc?.replyTo?.messageId;
    if (
      typeof candidateReplyTo === 'number'
      && Number.isFinite(candidateReplyTo)
      && existingReplyTo !== candidateReplyTo
    ) {
      set['replyTo.messageId'] = candidateReplyTo;
      flags.reply = true;
    }
  }

  const candidateLocation = candidateDoc.content.location;
  const existingLocation = existingDoc?.content?.location;
  const hasStoredLocation = hasValidLocation(existingLocation);
  const hasCandidateLocation = hasValidLocation(candidateLocation);
  const isLegacyGeoPlaceholder = (
    existingDoc?.content?.media?.mimeType === 'application/geo+json'
    && !existingDoc?.content?.media?.file
  );

  if (hasCandidateLocation && (!hasStoredLocation || isLegacyGeoPlaceholder)) {
    set['content.location'] = candidateLocation;
    set['content.type'] = hasMeaningfulText(candidateDoc.content.text) ? 'mixed' : 'location';
    unset['content.media'] = '';
    flags.geo = true;
  }

  const candidateReactions = normalizeReactions(candidateDoc.reactions);
  const existingReactions = normalizeReactions(existingDoc?.reactions);
  if (candidateReactions && !reactionsEqual(existingReactions, candidateReactions)) {
    set.reactions = candidateReactions;
    flags.reactions = true;
  }

  const existingHasPayload = docHasRenderablePayload(existingDoc);
  const candidateHasPayload = docHasRenderablePayload(candidateDoc);
  if (!existingHasPayload && candidateHasPayload) {
    set.type = candidateDoc.type;
    set['content.type'] = candidateDoc.content.type;

    if (candidateDoc.content.text !== undefined) {
      set['content.text'] = candidateDoc.content.text;
    }
    if (candidateDoc.content.entities !== undefined) {
      set['content.entities'] = candidateDoc.content.entities;
    }
    if (candidateDoc.content.media !== undefined) {
      set['content.media'] = candidateDoc.content.media;
    }
    if (candidateDoc.content.location !== undefined) {
      set['content.location'] = candidateDoc.content.location;
    }
    if (candidateDoc.content.service !== undefined) {
      set['content.service'] = candidateDoc.content.service;
    }
    if (candidateDoc.service !== undefined) {
      set.service = candidateDoc.service;
    }

    flags.payload = true;
  }

  const changed = Object.keys(set).length > 0 || Object.keys(unset).length > 0;
  return { set, unset, changed, flags };
}
