export interface TextEntity {
    type: string;
    text: string;
    href?: string;  // for text_links
    url?: string;   // for regular links
    language?: string;
}

export interface TextPart {
    type: string;
    text: string;
    href?: string;
    url?: string;
    language?: string;
}

export interface MessageReaction {
    type: 'emoji' | 'custom_emoji' | 'unknown';
    emoji?: string;
    customEmojiId?: string;
    count: number;
    chosenOrder?: number;
    rawType?: string;
}

// Interface for tracking dialog sync status
export interface DialogSyncStatus {
    tgDialogId: TelegramDialogId;
    lastMessageId?: number;
    isSyncing: boolean;
    lastSyncDate?: Date;
    backfillOffsetId?: number | null;
    backfillScannedMessages?: number;
    backfillImportedMessages?: number;
    backfillSkippedExistingMessages?: number;
    backfillCompletedAt?: Date;
    backfillUpdatedAt?: Date;
    forceBackfillRequestedAt?: Date;
    forceBackfillMode?: 'full' | 'recent';
    forceBackfillAfterDate?: Date;
    forceBackfillWindowDays?: number;
    forceBackfillHandledAt?: Date;
    forceBackfillLastStartedAt?: Date;
    forceBackfillLastCompletedAt?: Date;
}

export interface LiveSyncConfigDocument {
    _id: string;
    liveSyncChatIds?: string[];
    updatedAt?: Date;
}

export type TelegramDialogId = string & { readonly __brand: unique symbol };

export interface DialogDocument {
    _id?: string;
    tgDialogId: TelegramDialogId;
    metadata: {
        firstArchived: Date;
        lastUpdated: Date;
        version: number;
        updateCount: number;
        changeHistory: Array<{
            version: number;
            timestamp: Date;
            changes: Record<string, { old: any; new: any }>;
        }>;
    };
    [key: string]: any;
}

export interface MediaInfo {
    type: 'sticker' | 'photo' | 'video' | 'video_file' | 'voice' | 'document' | 'audio' | 'animation';
    file?: string;
    thumbnail?: string;
    emoji?: string;
    width?: number;
    height?: number;
    duration?: number;
    mimeType?: string;
    fileName?: string;
    fileSize?: number;
    extension?: string;
    url?: string; // Add this field for web pages
}

export interface ServiceInfo {
    type: string;  // phone_call, chat_created, member_joined, etc.
    actor: {
        name: string;
        id: string;
    };
    details?: {
        discardReason?: string;
        duration?: number;
        pinnedMessageId?: number;  // Add this for pin_message actions
    };
}

export interface BackupMessage {
    id: number;
    type: 'message' | 'service';  // Add explicit type
    actor?: string;
    actor_id?: string;
    action?: string;
    message_id?: number;  // For pin_message actions
    discard_reason?: string;
    date: string;
    date_unixtime: string;
    // Add edited fields
    edited?: string;
    edited_unixtime?: string;
    from: string;
    from_id: string;
    forwarded_from?: string;
    text?: string | Array<string | TextPart>;
    text_entities?: TextEntity[];
    // Media fields
    file?: string;
    thumbnail?: string;
    media_type?: string;
    sticker_emoji?: string;
    width?: number;
    height?: number;
    duration_seconds?: number;
    mime_type?: string;
    // Direct photo field
    photo?: string;
    location_information?: {
        latitude: number;
        longitude: number;
    };
    reply_to_message_id?: number;
    reactions?: BackupReaction[];
}

export interface BackupReaction {
    type?: string;
    emoji?: string;
    emoticon?: string;
    count?: number | string;
    custom_emoji_id?: string | number;
    document_id?: string | number;
    documentId?: string | number;
    chosen_order?: number | string;
    chosenOrder?: number | string;
}

export interface LocationInfo {
    latitude: number;
    longitude: number;
}

export interface MessageDocument {
    tgMessageId: number;
    tgChatId: number | bigint;
    chatName: string;
    chatType: string;
    sender: {
        name: string;
        id: string;
    };
    forwarded?: {
        from: string;
    };
    replyTo?: {
        messageId: number;
    };
    edited?: {
        date: Date;
        unixtime: number;
    };
    deleted?: {
        at: Date;
        source: 'backup' | 'live';
        note?: string;
    };
    type: 'message' | 'service';  // Add message type
    service?: ServiceInfo;  // Add service info
    reactions?: MessageReaction[];
    content: {
        type: 'text' | 'media' | 'mixed' | 'location' | 'service';
        text?: string | TextPart[];
        entities?: TextEntity[];
        media?: MediaInfo;
        location?: LocationInfo;
        service?: ServiceInfo;
    };
    metadata: {
        importedAt: Date;
        originalDate: Date;
        originalUnixtime: number;
        source: 'backup' | 'live';
        sourceDir?: string;
        firstSeenAt?: Date;
        lastMutationAt?: Date;
        currentVersion?: number;
    };
}

export type MessageMutationEventType = 'created' | 'baseline' | 'edited' | 'reactions_updated' | 'deleted' | 'sync_updated';

export interface MessageHistoryDocument {
    tgMessageId: number;
    tgChatId: number | bigint;
    version: number;
    eventType: MessageMutationEventType;
    observedAt: Date;
    source: 'backup' | 'live';
    changedFields: string[];
    summary: string;
    changes: Record<string, { old: unknown; new: unknown }>;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
}
