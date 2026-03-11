export const ROUTES = {
  web: {
    home: '/',
    dialog: '/dialog/:id',
    dialogMessages: '/dialog/:id/messages',
    dialogTimeline: '/dialog/:id/timeline',
    messageSearch: '/messages/search',
    message: '/message/:id',
    messageHistory: '/message/:id/history',
    media: '/media/:key',
  },
  api: {
    dialogs: '/api/dialogs',
    dialog: '/api/dialog/:id',
    dialogMessages: '/api/dialog/:id/messages',
    dialogTimeline: '/api/dialog/:id/timeline',
    dialogBackfill: '/api/dialog/:id/backfill',
    recentDialogsBackfill: '/api/backfill/recent',
    messageSearch: '/api/messages/search',
    messageContext: '/api/message/:id/context',
    messageHistory: '/api/message/:id/history',
    agentStatus: '/api/agent/status',
    agentPassword: '/api/agent/auth/password',
    syncConfig: '/api/sync-config',
    dialogActivity: '/api/dialog-activity',
  },
} as const;

export const Paths = {
  dialog: (chatId: string | number) => `/dialog/${chatId}`,
  dialogMessages: (chatId: string | number, page = 1, limit?: number) => {
    const params = new URLSearchParams({ page: String(page) });
    if (limit) params.set('limit', String(limit));
    return `/dialog/${chatId}/messages?${params.toString()}`;
  },
  dialogTimeline: (chatId: string | number, page = 1, limit?: number) => {
    const params = new URLSearchParams({ page: String(page) });
    if (limit) params.set('limit', String(limit));
    return `/dialog/${chatId}/timeline?${params.toString()}`;
  },
  messageSearch: (query = '', page = 1, chatId?: string | number) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (page > 1) params.set('page', String(page));
    if (chatId !== undefined && String(chatId).trim()) params.set('chatId', String(chatId));
    const qs = params.toString();
    return qs ? `/messages/search?${qs}` : '/messages/search';
  },
  message: (messageId: string | number, chatId?: string | number) => {
    const params = new URLSearchParams();
    if (chatId !== undefined && String(chatId).trim()) params.set('chatId', String(chatId));
    const qs = params.toString();
    return qs ? `/message/${messageId}?${qs}` : `/message/${messageId}`;
  },
  messageHistory: (messageId: string | number, chatId?: string | number) => {
    const params = new URLSearchParams();
    if (chatId !== undefined && String(chatId).trim()) params.set('chatId', String(chatId));
    const qs = params.toString();
    return qs ? `/message/${messageId}/history?${qs}` : `/message/${messageId}/history`;
  },
  media: (key: string) => `/media/${key}`,
  apiDialog: (chatId: string | number) => `/api/dialog/${chatId}`,
  apiDialogMessages: (chatId: string | number, page = 1, limit = 50) =>
    `/api/dialog/${chatId}/messages?page=${page}&limit=${limit}`,
  apiDialogTimeline: (chatId: string | number, page = 1, limit = 50) =>
    `/api/dialog/${chatId}/timeline?page=${page}&limit=${limit}`,
  apiDialogBackfill: (chatId: string | number) => `/api/dialog/${chatId}/backfill`,
  apiRecentDialogsBackfill: () => '/api/backfill/recent',
  apiMessageSearch: (query = '', page = 1, limit = 20, chatId?: string | number) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (chatId !== undefined && String(chatId).trim()) params.set('chatId', String(chatId));
    return `/api/messages/search?${params.toString()}`;
  },
  apiMessageContext: (messageId: string | number, chatId?: string | number) => {
    const params = new URLSearchParams();
    if (chatId !== undefined && String(chatId).trim()) params.set('chatId', String(chatId));
    const qs = params.toString();
    return qs ? `/api/message/${messageId}/context?${qs}` : `/api/message/${messageId}/context`;
  },
  apiMessageHistory: (messageId: string | number, chatId?: string | number) => {
    const params = new URLSearchParams();
    if (chatId !== undefined && String(chatId).trim()) params.set('chatId', String(chatId));
    const qs = params.toString();
    return qs ? `/api/message/${messageId}/history?${qs}` : `/api/message/${messageId}/history`;
  },
  apiSyncConfig: () => '/api/sync-config',
  apiDialogActivity: () => '/api/dialog-activity',
} as const;

export type MessageSearchResult = {
  tgMessageId: number;
  chatId: string;
  chatName?: string;
  chatType?: string;
  sender?: { name?: string; id?: string };
  reactions?: Array<{
    type?: string;
    emoji?: string;
    customEmojiId?: string;
    count?: number;
    rawType?: string;
    chosenOrder?: number;
  }>;
  metadata?: { originalDate?: string | number | Date; source?: string; currentVersion?: number; lastMutationAt?: string | number | Date };
  edited?: { date?: string | number | Date };
  deleted?: { at?: string | number | Date; source?: string; note?: string };
  forwarded?: { from?: string };
  replyTo?: { messageId?: number };
  type?: string;
  service?: { type?: string; actor?: { name?: string }; details?: { duration?: number; discardReason?: string; pinnedMessageId?: number } };
  content?: {
    text?: string | Array<string | { type?: string; text?: string; href?: string; url?: string; language?: string }>;
    entities?: Array<string | { type?: string; text?: string; href?: string; url?: string; language?: string }>;
    media?: {
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
    } | null;
    location?: { latitude?: number; longitude?: number; title?: string } | null;
  };
};

export type MessageSearchResponse = {
  query: string;
  messages: MessageSearchResult[];
  pagination: {
    current: number;
    total: number;
    totalCount: number;
    limit: number;
  };
  chatId?: string;
};

export type MessageHistoryEntry = {
  tgMessageId: number;
  chatId: string;
  version: number;
  eventType: 'created' | 'baseline' | 'edited' | 'reactions_updated' | 'deleted' | 'sync_updated';
  observedAt?: string | number | Date;
  source?: string;
  changedFields?: string[];
  summary?: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  before?: MessageSearchResult | null;
  after?: MessageSearchResult | null;
};

export type MessageHistoryResponse = {
  messageId: number;
  chatId?: string;
  current?: MessageSearchResult | null;
  history: MessageHistoryEntry[];
};

export type DialogTimelineResponse = {
  chatId: string;
  timeline: MessageHistoryEntry[];
  pagination: {
    current: number;
    total: number;
    totalCount: number;
    limit: number;
  };
  dialogType?: { isUser?: boolean; isGroup?: boolean; isChannel?: boolean };
};

export type DialogActivityItem = {
  chatId: string;
  liveSyncSelected: boolean;
  phase: 'importing_backup' | 'backfilling' | 'stale' | 'queued' | 'complete' | 'idle';
  updatedAt?: string;
  chatProgress?: {
    scannedMessages?: number;
    importedMessages?: number;
    skippedExistingMessages?: number;
    enrichedMessages?: number;
  };
};

export type DialogActivityResponse = {
  activities: Record<string, DialogActivityItem>;
};

export type SyncConfigResponse = {
  liveSyncChatIds: string[];
  updatedAt?: string;
  autoBackfill?: {
    queuedCount: number;
    skippedAlreadyBackfilledCount: number;
    skippedAlreadyQueuedCount: number;
    skippedUnknownDialogCount: number;
  };
};

export type RecentDialogsBackfillResponse = {
  ok: true;
  windowDays: number;
  liveSyncSelectedCount: number;
  queuedCount: number;
  skippedAlreadyQueuedCount: number;
  skippedUnknownDialogCount: number;
  requestedAt?: string | Date;
  afterDate?: string | Date;
};

export type AgentStatusResponse = {
  _id?: string;
  state?: string;
  message?: string;
  qrDataUrl?: string | null;
  progress?: { processed?: number; total?: number };
  backfill?: {
    currentChatId?: string | null;
    currentChatName?: string | null;
    chatIndex?: number;
    totalChats?: number;
    chatProgress?: {
      scannedMessages?: number;
      importedMessages?: number;
      skippedExistingMessages?: number;
      enrichedMessages?: number;
    };
  };
  reconcile?: {
    phase?: 'scanning' | 'importing' | 'done';
    currentChatId?: string;
    currentChatName?: string;
    chatIndex?: number;
    totalChats?: number;
    chatProgress?: {
      processedMessages?: number;
      totalMessages?: number;
      importedMessages?: number;
      skippedExistingMessages?: number;
    };
    totals?: {
      scannedChats?: number;
      importedChats?: number;
      skippedNonWhitelistedChats?: number;
      scannedMessages?: number;
      importedMessages?: number;
      skippedExistingMessages?: number;
    };
  };
  updatedAt?: string;
  authPasswordUpdatedAt?: string;
};

export type ApiErrorResponse = {
  message: string;
};
