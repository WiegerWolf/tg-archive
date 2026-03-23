export type Dialog = {
  tgDialogId: string;
  title?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  username?: string;
  about?: string;
  phone?: string;
  isUser?: boolean;
  isGroup?: boolean;
  isChannel?: boolean;
  pinned?: boolean;
  archived?: boolean;
  verified?: boolean;
  premium?: boolean;
  archived?: boolean;
  folderId?: number;
  scam?: boolean;
  fake?: boolean;
  restricted?: boolean;
  contact?: boolean;
  messageCount?: number;
  date?: number;
  metadata?: {
    lastUpdated?: string;
    firstArchived?: string;
    version?: number;
    updateCount?: number;
  };
  sync?: {
    backfillCompletedAt?: string;
  };
  entity?: {
    bot?: boolean;
    deleted?: boolean;
    className?: string;
    title?: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    phone?: string;
    contact?: boolean;
    mutualContact?: boolean;
    participantsCount?: number;
    verified?: boolean;
    botCanEdit?: boolean;
    botInfoVersion?: number;
    botInlineGeo?: boolean;
    botChatHistory?: boolean;
    botNochats?: boolean;
    noforwards?: boolean;
    date?: number;
    level?: number;
    broadcast?: boolean;
    signatures?: boolean;
    adminRights?: Record<string, boolean>;
    usernames?: Array<{ username?: string; active?: boolean }>;
  };
};

export type RouteState =
  | { name: 'home' }
  | { name: 'dialog'; chatId: string; around?: number; date?: string }
  | { name: 'messages'; chatId: string; page?: number; around?: number; date?: string }
  | { name: 'timeline'; chatId: string; page: number }
  | { name: 'search'; query: string; page: number; chatId?: string }
  | { name: 'message'; messageId: string; chatId?: string }
  | { name: 'messageHistory'; messageId: string; chatId?: string }
  | { name: 'notFound' };
