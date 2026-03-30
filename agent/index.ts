import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent, Raw } from "telegram/events";
import QRCode from "qrcode";
import { Db, MongoClient } from "mongodb";
import { omitPaths } from "./helper";
import { DialogSyncStatus, TelegramDialogId, DialogDocument, MessageDocument, LiveSyncConfigDocument, TextPart, TextEntity, LocationInfo, MessageReaction, ServiceInfo, MessageHistoryDocument, MessageMutationEventType } from "./types";
import 'dotenv/config'
import { Dialog } from "telegram/tl/custom/dialog";
import { uploadFile } from "./s3";
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConnectionTCPFull } from "telegram/network";
import { Logger } from "telegram/extensions/Logger";
import { importBackupsFromRoot } from "./importBackup";
import { createMessageDocument, hasMeaningfulText } from './messagePipeline';

const {
  TELEGRAM_API_ID,
  TELEGRAM_API_HASH,
  TELEGRAM_PASSWORD,
  TELEGRAM_SESSION_STRING,
  MONGO_URI,
  TELEGRAM_EXPORTS_DIR,
  IMPORT_BEFORE_LIVE_SYNC,
  BACKFILL_STALE_LOCK_MS,
  DIALOG_AVATAR_DOWNLOAD_TIMEOUT_MS,
} = process.env;

const SHOULD_IMPORT_BEFORE_LIVE_SYNC = IMPORT_BEFORE_LIVE_SYNC?.toLowerCase() === "true";
const BOOTSTRAP_EXPORTS_DIR = TELEGRAM_EXPORTS_DIR || "/exports";
const LIVE_SYNC_CONFIG_ID = 'primary';
const LIVE_SYNC_CONFIG_CACHE_TTL_MS = 10_000;
const AGENT_AUTH_DOC_ID = 'primary';
const DEFAULT_BACKFILL_STALE_LOCK_MS = 30 * 60 * 1000;
const DIALOG_BACKFILL_POLL_MS = 10_000;
const parsedBackfillStaleLockMs = Number(BACKFILL_STALE_LOCK_MS || DEFAULT_BACKFILL_STALE_LOCK_MS);
const EFFECTIVE_BACKFILL_STALE_LOCK_MS = Number.isFinite(parsedBackfillStaleLockMs) && parsedBackfillStaleLockMs > 0
  ? parsedBackfillStaleLockMs
  : DEFAULT_BACKFILL_STALE_LOCK_MS;
const DEFAULT_DIALOG_AVATAR_DOWNLOAD_TIMEOUT_MS = 15_000;
const TELEGRAM_HEALTH_CHECK_INTERVAL_MS = 60_000;
const parsedDialogAvatarDownloadTimeoutMs = Number(
  DIALOG_AVATAR_DOWNLOAD_TIMEOUT_MS || DEFAULT_DIALOG_AVATAR_DOWNLOAD_TIMEOUT_MS,
);
const EFFECTIVE_DIALOG_AVATAR_DOWNLOAD_TIMEOUT_MS = Number.isFinite(parsedDialogAvatarDownloadTimeoutMs)
  && parsedDialogAvatarDownloadTimeoutMs > 0
  ? parsedDialogAvatarDownloadTimeoutMs
  : DEFAULT_DIALOG_AVATAR_DOWNLOAD_TIMEOUT_MS;

function checkTelegramConfig({
  apiId,
  apiHash,
  password,
}: {
  apiId: number;
  apiHash: string;
  password: string;
}) {
  if (!apiId) {
    throw new Error("TELEGRAM_API_ID is missing");
  }
  if (!apiHash) {
    throw new Error("TELEGRAM_API_HASH is missing");
  }
  if (!password || password === "") {
    console.warn("TELEGRAM_PASSWORD is missing");
  }
}

let tgClient: TelegramClient;
let tgClientPromise: Promise<TelegramClient> | undefined;
let messageHistoryIndexesReady: Promise<void> | null = null;
const liveEventHandlersBoundClients = new WeakSet<TelegramClient>();

function attachLiveEventHandlers(client: TelegramClient) {
  if (liveEventHandlersBoundClients.has(client)) {
    return;
  }

  client.addEventHandler(handleNewMessageEvent, new NewMessage({}));
  client.addEventHandler(handleReactionUpdateEvent, new Raw({ types: [Api.UpdateMessageReactions] }));
  client.addEventHandler(handleEditedMessageEvent, new Raw({ types: [Api.UpdateEditMessage, Api.UpdateEditChannelMessage] }));
  client.addEventHandler(handleDeletedMessageEvent, new Raw({ types: [Api.UpdateDeleteMessages, Api.UpdateDeleteChannelMessages] }));
  liveEventHandlersBoundClients.add(client);
}

async function disconnectTelegramClient(client: TelegramClient | undefined, reason: string) {
  if (!client) {
    return;
  }

  try {
    console.warn(`Disconnecting Telegram client: ${reason}`);
    await client.disconnect();
  } catch (error) {
    console.error(`Error disconnecting Telegram client (${reason}):`, error);
  }
}

async function resetTelegramClient(reason: string, client: TelegramClient | undefined = tgClient) {
  if (client && tgClient === client) {
    tgClient = undefined;
  }

  await disconnectTelegramClient(client, reason);
}

async function getTelegramClient() {
  if (tgClient && tgClient.connected) {
    return tgClient;
  }

  if (tgClientPromise) {
    return tgClientPromise;
  }

  tgClientPromise = (async () => {
    if (tgClient && !tgClient.connected) {
      await resetTelegramClient('stale disconnected client before reconnect', tgClient);
    }

  const apiId = Number(TELEGRAM_API_ID);
  const apiHash = TELEGRAM_API_HASH || "";
  const persistedSessionString = await loadPersistedTelegramSession();
  const envSessionString = typeof TELEGRAM_SESSION_STRING === 'string'
    ? TELEGRAM_SESSION_STRING.trim()
    : '';
  const initialSessionString = envSessionString || persistedSessionString || '';
  const stringSession = new StringSession(initialSessionString);
  const password = TELEGRAM_PASSWORD || "";

  checkTelegramConfig({ apiId, apiHash, password });

  let client: TelegramClient | undefined;
  try {
    client = new TelegramClient(
      stringSession,
      apiId,
      apiHash,
      {
        baseLogger: new Logger(),
        connectionRetries: 5,
        maxConcurrentDownloads: 10,
        requestRetries: 5,
        timeout: 30000,
        useWSS: false, // Changed to false
        connection: ConnectionTCPFull, // Using TCP Full connection
        deviceModel: "Desktop",
        systemVersion: "Windows 10",
        appVersion: "1.0.0",
        langCode: "en",
      }
    );

    await client.connect();
    
    if (!await client.checkAuthorization()) {
      await setAgentStatus("needs_auth", {
        message: "Telegram login required",
      });
      console.log("Need to sign in with QR code...");
      while (!await client.checkAuthorization()) {
        try {
          await client.signInUserWithQrCode(
            { apiId, apiHash },
            {
              password: async () => {
                if (password && password !== "") {
                  return password;
                }

                await setAgentStatus("awaiting_2fa_password", {
                  message: "Two-factor password required. Enter it in Admin UI.",
                  qrDataUrl: null,
                });

                return await waitForTwoFactorPassword();
              },
              qrCode: async ({ token }) => {
                const telegramLoginUrl = `tg://login?token=${token.toString("base64url")}`;
                console.log("Scan the QR code with your Telegram app to login:");

                try {
                  const qrCodeAsciiArt = await QRCode.toString(telegramLoginUrl, { type: "terminal" });
                  console.log(qrCodeAsciiArt);
                  const qrDataUrl = await QRCode.toDataURL(telegramLoginUrl, {
                    margin: 1,
                    width: 320,
                  });

                  await setAgentStatus("needs_auth", {
                    message: "Scan the QR code in Admin UI to authenticate Telegram",
                    qrDataUrl,
                  });
                } catch (error) {
                  console.error("Failed to render QR code:", error);
                  await setAgentStatus("needs_auth", {
                    message: "Telegram login required",
                  });
                }
              },
              onError: (err) => {
                throw err;
              },
            }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("Error during QR code sign in:", err);

          if (message.includes("PASSWORD_HASH_INVALID")) {
            await setAgentStatus("awaiting_2fa_password", {
              message: "Incorrect 2FA password. Please try again.",
              qrDataUrl: null,
            });
            continue;
          }

          if (message.includes("AUTH_TOKEN_EXPIRED")) {
            console.warn("QR auth token expired; requesting a fresh QR token...");
            await setAgentStatus("needs_auth", {
              message: "QR code expired. Refreshing with a new code...",
            });
            continue;
          }

          await setAgentStatus("error", {
            message: `QR sign-in failed: ${message}`,
          });
          throw err;
        }
      }
    }

    console.log("Successfully connected to Telegram.");
    await setAgentStatus("authenticated", {
      message: "Telegram authenticated",
      qrDataUrl: null,
    });
    const savedSessionString = stringSession.save();
    await savePersistedTelegramSession(savedSessionString);

    if (!envSessionString && !persistedSessionString) {
      console.log("Telegram session created and stored locally. Copy it from your persisted environment only if you explicitly need it.");
    }

    tgClient = client;
    return tgClient;

  } catch (error) {
    console.error("Error connecting to Telegram:", error);

    await disconnectTelegramClient(client, 'connection failure during setup');
    await resetTelegramClient('connection failure');

    throw error;
  } finally {
    tgClientPromise = undefined;
  }
  })();

  return tgClientPromise;
}

let dbClient: Db;
let mongoClientConnection: MongoClient | undefined;
let liveSyncChatIdsCache = new Set<string>();
let liveSyncChatIdsCacheUpdatedAt = 0;
const DIALOG_CONTEXT_CACHE_TTL_MS = 60_000;
let backfillRunInProgress = false;
let dialogBackfillPollTimer: ReturnType<typeof setInterval> | undefined;
let telegramHealthCheckTimer: ReturnType<typeof setInterval> | undefined;
let telegramHealthCheckInFlight = false;

type DialogContextSnapshot = {
  chatName?: string;
  chatType?: string;
  defaultSenderName?: string;
  cachedAt: number;
};

const dialogContextCache = new Map<string, DialogContextSnapshot>();
const liveDiscoveredDialogIds = new Set<string>();

async function getMongoDbClient() {
  if (dbClient) {
    return dbClient;
  }
  mongoClientConnection = new MongoClient(MONGO_URI || "");
  await mongoClientConnection.connect();
  dbClient = mongoClientConnection.db("tgArchive");
  return dbClient;
}

type AgentAuthDocument = {
  _id: string;
  telegramSessionString?: string;
  updatedAt?: Date;
};

async function loadPersistedTelegramSession(): Promise<string | undefined> {
  try {
    const db = await getMongoDbClient();
    const authDoc = await db.collection<AgentAuthDocument>('agentAuth').findOne(
      { _id: AGENT_AUTH_DOC_ID },
      { projection: { telegramSessionString: 1 } },
    );

    const session = typeof authDoc?.telegramSessionString === 'string'
      ? authDoc.telegramSessionString.trim()
      : '';

    return session || undefined;
  } catch (error) {
    console.error('Failed to load persisted Telegram session:', error);
    return undefined;
  }
}

async function savePersistedTelegramSession(sessionString: string) {
  const normalized = sessionString.trim();
  if (!normalized) {
    return;
  }

  try {
    const db = await getMongoDbClient();
    await db.collection<AgentAuthDocument>('agentAuth').updateOne(
      { _id: AGENT_AUTH_DOC_ID },
      {
        $set: {
          telegramSessionString: normalized,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    console.error('Failed to persist Telegram session:', error);
  }
}

async function getLiveSyncChatIds(forceRefresh = false): Promise<Set<string>> {
  if (!forceRefresh && Date.now() - liveSyncChatIdsCacheUpdatedAt < LIVE_SYNC_CONFIG_CACHE_TTL_MS) {
    return liveSyncChatIdsCache;
  }

  const db = await getMongoDbClient();
  const config = await db.collection<LiveSyncConfigDocument>('syncConfig').findOne({ _id: LIVE_SYNC_CONFIG_ID });
  const ids = Array.isArray(config?.liveSyncChatIds)
    ? config.liveSyncChatIds.filter((id): id is string => typeof id === 'string')
    : [];

  liveSyncChatIdsCache = new Set(ids);
  liveSyncChatIdsCacheUpdatedAt = Date.now();
  return liveSyncChatIdsCache;
}

async function isLiveSyncEnabled(chatId: string | number | bigint): Promise<boolean> {
  const chatIds = await getLiveSyncChatIds();
  return chatIds.has(chatId.toString());
}

function parseDateValue(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const candidate = new Date(value);
    if (!Number.isNaN(candidate.getTime())) {
      return candidate;
    }
  }

  return undefined;
}

type RequestedBackfillMode = 'full' | 'recent';

function normalizeRequestedBackfillMode(value: unknown): RequestedBackfillMode {
  return value === 'recent' ? 'recent' : 'full';
}

function getTelegramMessageDateMs(message: any): number {
  if (typeof message?.date === 'number' && Number.isFinite(message.date)) {
    return message.date * 1000;
  }

  const parsedDate = parseDateValue(message?.date);
  return parsedDate ? parsedDate.getTime() : 0;
}

function describeBackfillWindow(mode: RequestedBackfillMode, windowDays?: number): string {
  if (mode !== 'recent') {
    return 'history';
  }

  const days = typeof windowDays === 'number' && Number.isFinite(windowDays) && windowDays > 0
    ? Math.max(1, Math.round(windowDays))
    : 7;
  return `last ${days} days`;
}

function extractPeerIdentifier(peer: any): string | undefined {
  if (!peer) {
    return undefined;
  }

  if (peer.userId !== undefined && peer.userId !== null) {
    return peer.userId.toString();
  }
  if (peer.channelId !== undefined && peer.channelId !== null) {
    return peer.channelId.toString();
  }
  if (peer.chatId !== undefined && peer.chatId !== null) {
    return peer.chatId.toString();
  }

  return undefined;
}

function resolveDisplayName(entity: any): string | undefined {
  if (!entity) {
    return undefined;
  }

  const firstName = typeof entity.firstName === 'string' ? entity.firstName.trim() : '';
  const lastName = typeof entity.lastName === 'string' ? entity.lastName.trim() : '';
  const title = typeof entity.title === 'string' ? entity.title.trim() : '';
  const username = typeof entity.username === 'string' ? entity.username.trim() : '';

  const personalName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (personalName.length > 0) {
    return personalName;
  }
  if (title.length > 0) {
    return title;
  }
  if (username.length > 0) {
    return `@${username}`;
  }

  return undefined;
}

async function getDialogContextSnapshot(chatId: string): Promise<DialogContextSnapshot | undefined> {
  const cached = dialogContextCache.get(chatId);
  if (cached && Date.now() - cached.cachedAt < DIALOG_CONTEXT_CACHE_TTL_MS) {
    return cached;
  }

  const db = await getMongoDbClient();
  const dialog = await db.collection<DialogDocument>('dialogs').findOne(
    { tgDialogId: chatId as TelegramDialogId },
    {
      projection: {
        title: 1,
        firstName: 1,
        lastName: 1,
        username: 1,
        chatType: 1,
      },
    },
  );

  if (!dialog) {
    return undefined;
  }

  const firstName = typeof dialog.firstName === 'string' ? dialog.firstName.trim() : '';
  const lastName = typeof dialog.lastName === 'string' ? dialog.lastName.trim() : '';
  const title = typeof dialog.title === 'string' ? dialog.title.trim() : '';
  const username = typeof dialog.username === 'string' ? dialog.username.trim() : '';
  const nameFromParts = [firstName, lastName].filter(Boolean).join(' ').trim();
  const chatName = title || nameFromParts || (username ? `@${username}` : undefined);

  const snapshot: DialogContextSnapshot = {
    chatName,
    chatType: typeof dialog.chatType === 'string' ? dialog.chatType : undefined,
    defaultSenderName: nameFromParts || title || (username ? `@${username}` : undefined),
    cachedAt: Date.now(),
  };

  dialogContextCache.set(chatId, snapshot);
  return snapshot;
}

async function shouldRunBackupBootstrap() {
  if (!SHOULD_IMPORT_BEFORE_LIVE_SYNC) {
    return false;
  }

  return true;
}

async function runBackupBootstrapIfNeeded() {
  if (!(await shouldRunBackupBootstrap())) {
    console.log("Backup bootstrap skipped");
    return;
  }

  await setAgentStatus("bootstrap_import", {
    message: `Reconciling Telegram exports from ${BOOTSTRAP_EXPORTS_DIR}`,
    qrDataUrl: null,
    reconcile: {
      phase: 'scanning',
      currentChatId: null,
      currentChatName: null,
      chatIndex: 0,
      totalChats: 0,
      chatProgress: {
        processedMessages: 0,
        totalMessages: 0,
        importedMessages: 0,
        skippedExistingMessages: 0,
      },
    },
  });

  let summary;
  try {
    summary = await importBackupsFromRoot(BOOTSTRAP_EXPORTS_DIR, {
      onChatStart: async ({ chatId, chatName, chatIndex, totalChats }) => {
        await setAgentStatus("bootstrap_import", {
          message: `Reconciling ${chatName} (${chatIndex}/${totalChats})`,
          progress: { processed: chatIndex - 1, total: totalChats },
          reconcile: {
            phase: 'importing',
            currentChatId: String(chatId),
            currentChatName: chatName,
            chatIndex,
            totalChats,
            chatProgress: {
              processedMessages: 0,
              totalMessages: 0,
              importedMessages: 0,
              skippedExistingMessages: 0,
            },
          },
        });
      },
      onChatProgress: async ({ chatId, chatName, chatIndex, totalChats, progress }) => {
        await setAgentStatus("bootstrap_import", {
          message: `Reconciling ${chatName} (${chatIndex}/${totalChats})`,
          progress: { processed: chatIndex - 1, total: totalChats },
          reconcile: {
            phase: 'importing',
            currentChatId: String(chatId),
            currentChatName: chatName,
            chatIndex,
            totalChats,
            chatProgress: {
              processedMessages: progress.processedMessages,
              totalMessages: progress.totalMessages,
              importedMessages: progress.importedMessages,
              skippedExistingMessages: progress.skippedExistingMessages,
            },
          },
        });
      },
      onChatDone: async ({ chatId, chatName, chatIndex, totalChats, result }) => {
        await setAgentStatus("bootstrap_import", {
          message: `Reconciled ${chatName}: +${result.importedMessages} imported, ${result.skippedExistingMessages} already archived`,
          progress: { processed: chatIndex, total: totalChats },
          reconcile: {
            phase: 'importing',
            currentChatId: String(chatId),
            currentChatName: chatName,
            chatIndex,
            totalChats,
            chatProgress: {
              processedMessages: result.scannedMessages,
              totalMessages: result.scannedMessages,
              importedMessages: result.importedMessages,
              skippedExistingMessages: result.skippedExistingMessages,
            },
          },
        });
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === `No result.json files found under ${BOOTSTRAP_EXPORTS_DIR}`) {
      console.log(`No Telegram export backups found under ${BOOTSTRAP_EXPORTS_DIR}; skipping bootstrap import.`);
      await setAgentStatus("bootstrap_import_done", {
        message: `No Telegram exports found under ${BOOTSTRAP_EXPORTS_DIR}; live sync starting`,
        qrDataUrl: null,
        progress: { processed: 0, total: 0 },
        reconcile: {
          phase: 'done',
          totals: {
            scannedChats: 0,
            importedChats: 0,
            skippedNonWhitelistedChats: 0,
            scannedMessages: 0,
            importedMessages: 0,
            skippedExistingMessages: 0,
          },
        },
      });
      return;
    }

    throw error;
  }

  await setAgentStatus("bootstrap_import_done", {
    message: `Reconciled backups: chats ${summary.importedChats}/${summary.scannedChats}, imported ${summary.importedMessages}, skipped existing ${summary.skippedExistingMessages}`,
    qrDataUrl: null,
    progress: { processed: summary.scannedChats, total: summary.scannedChats },
    reconcile: {
      phase: 'done',
      totals: {
        scannedChats: summary.scannedChats,
        importedChats: summary.importedChats,
        skippedNonWhitelistedChats: summary.skippedNonWhitelistedChats,
        scannedMessages: summary.scannedMessages,
        importedMessages: summary.importedMessages,
        skippedExistingMessages: summary.skippedExistingMessages,
      },
    },
  });

  console.log(
    `Backup reconcile completed: scanned chats=${summary.scannedChats}, imported chats=${summary.importedChats}, skipped by import filter=${summary.skippedNonWhitelistedChats}, scanned messages=${summary.scannedMessages}, imported messages=${summary.importedMessages}, skipped existing messages=${summary.skippedExistingMessages}`,
  );
}

async function setAgentStatus(
  state: string,
  extra: Record<string, unknown> = {},
) {
  try {
    const db = await getMongoDbClient();
    const unsetFields: Record<string, ''> = {};
    const keepProgressStates = new Set(['syncing_dialogs', 'syncing_messages', 'bootstrap_import', 'bootstrap_import_done']);

    if (!state.startsWith('bootstrap_import')) {
      unsetFields.reconcile = '';
    }

    if (!keepProgressStates.has(state)) {
      unsetFields.progress = '';
    }

    if (state !== 'syncing_messages') {
      unsetFields.backfill = '';
    }

    await db.collection("agentStatus").updateOne(
      { _id: "primary" },
      {
        $set: {
          state,
          updatedAt: new Date(),
          ...extra,
        },
        ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
      },
      { upsert: true },
    );
  } catch (error) {
    console.error("Failed to update agent status:", error);
  }
}

async function waitForTwoFactorPassword(timeoutMs = 10 * 60 * 1000): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const db = await getMongoDbClient();
    const statusDoc = await db.collection("agentStatus").findOne(
      { _id: "primary" },
      { projection: { authPassword: 1 } },
    );

    const authPassword = typeof statusDoc?.authPassword === "string"
      ? statusDoc.authPassword.trim()
      : "";

    if (authPassword) {
      await db.collection("agentStatus").updateOne(
        { _id: "primary" },
        {
          $unset: {
            authPassword: "",
          },
          $set: {
            updatedAt: new Date(),
          },
        },
      );

      return authPassword;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error("Timed out waiting for 2FA password input");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms while ${label}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function processAllDialogs(client: TelegramClient) {
  let totalDialogs = 0;
  let processedDialogs = 0;

  // First, count total dialogs
  for await (const _ of client.iterDialogs({})) {
    totalDialogs++;
  }

  console.log(`Found ${totalDialogs} dialogs to process`);
  await setAgentStatus("syncing_dialogs", {
    message: "Syncing dialogs",
    progress: {
      processed: 0,
      total: totalDialogs,
    },
    qrDataUrl: null,
  });

  // Then process each dialog
  for await (const dialog of client.iterDialogs({})) {
    try {
      processedDialogs++;
      const dialogLabel = dialog.title || String(dialog.id);
      console.log(`Processing dialog ${processedDialogs}/${totalDialogs}: ${dialogLabel}`);

      await setAgentStatus("syncing_dialogs", {
        message: `Syncing dialogs (${processedDialogs}/${totalDialogs}): ${dialogLabel}`,
        progress: {
          processed: processedDialogs,
          total: totalDialogs,
        },
        qrDataUrl: null,
      });

      await saveDialog(dialog);
      
      // Optional: Add some delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`Error processing dialog ${dialog.id}:`, error);
      // Continue with next dialog despite error
      continue;
    }
  }

  console.log('Completed processing all dialogs and avatars');
}

function resolveDialogName(dialog: DialogDocument): string {
  return dialog.title
    || [dialog.firstName, dialog.lastName].filter(Boolean).join(' ')
    || (dialog.username ? `@${dialog.username}` : '')
    || dialog.tgDialogId;
}

async function backfillSingleDialog(
  dialog: DialogDocument,
  processedCount: number,
  totalChats: number,
  request?: {
    mode?: RequestedBackfillMode;
    afterDate?: Date;
    windowDays?: number;
  },
) {
  const dialogName = resolveDialogName(dialog);
  const backfillMode = normalizeRequestedBackfillMode(request?.mode);
  const backfillWindowLabel = describeBackfillWindow(backfillMode, request?.windowDays);
  const statusVerb = backfillMode === 'recent' ? `Gap-filling ${backfillWindowLabel}` : 'Backfilling history';
  console.log(`Syncing messages for dialog: ${dialogName} (${dialog.tgDialogId}) [${backfillWindowLabel}]`);

  await setAgentStatus("syncing_messages", {
    message: `${statusVerb} for ${dialogName} (${processedCount}/${totalChats})`,
    progress: {
      processed: processedCount,
      total: totalChats,
    },
    backfill: {
      currentChatId: dialog.tgDialogId,
      currentChatName: dialogName,
      chatIndex: processedCount,
      totalChats,
    },
    qrDataUrl: null,
  });

  if (!isValidTelegramDialogId(dialog.tgDialogId)) {
    console.warn(`Skipping invalid dialog ID: ${dialog.tgDialogId}`);
    await setAgentStatus("syncing_messages", {
      message: `Unable to resolve ${dialogName} (${processedCount}/${totalChats})`,
      progress: {
        processed: processedCount,
        total: totalChats,
      },
      backfill: {
        currentChatId: dialog.tgDialogId,
        currentChatName: dialogName,
        chatIndex: processedCount,
        totalChats,
      },
      qrDataUrl: null,
    });
    return;
  }

  const summary = await syncHistoricalMessages(dialog.tgDialogId, {
    mode: backfillMode,
    afterDate: request?.afterDate,
    windowDays: request?.windowDays,
    onProgress: async (progress) => {
      await setAgentStatus("syncing_messages", {
        message: `${statusVerb} for ${dialogName} (${processedCount}/${totalChats})`,
        progress: {
          processed: processedCount,
          total: totalChats,
        },
        backfill: {
          currentChatId: dialog.tgDialogId,
          currentChatName: dialogName,
          chatIndex: processedCount,
          totalChats,
          chatProgress: {
            scannedMessages: progress.scannedMessages,
            importedMessages: progress.importedMessages,
            skippedExistingMessages: progress.skippedExistingMessages,
            enrichedMessages: progress.enrichedMessages,
          },
        },
        qrDataUrl: null,
      });
    },
  });

  await setAgentStatus("syncing_messages", {
    message: `${statusVerb} for ${dialogName} (${processedCount}/${totalChats})`,
    progress: {
      processed: processedCount,
      total: totalChats,
    },
    backfill: {
      currentChatId: dialog.tgDialogId,
      currentChatName: dialogName,
      chatIndex: processedCount,
      totalChats,
      chatProgress: {
        scannedMessages: summary.scannedMessages,
        importedMessages: summary.importedMessages,
        skippedExistingMessages: summary.skippedExistingMessages,
        enrichedMessages: summary.enrichedExistingMessages,
      },
    },
    qrDataUrl: null,
  });
}

async function processAllMessages() {
  const db = await getMongoDbClient();
  const dialogsCollection = db.collection<DialogDocument>("dialogs");
  const liveSyncChatIds = await getLiveSyncChatIds(true);

  if (liveSyncChatIds.size === 0) {
    console.log('No chats selected for live sync; skipping historical and live message sync.');
    await setAgentStatus("syncing_messages", {
      message: "No chats selected for live sync",
      progress: {
        processed: 0,
        total: 0,
      },
      backfill: {
        currentChatId: null,
        currentChatName: null,
        chatIndex: 0,
        totalChats: 0,
      },
      qrDataUrl: null,
    });
    return;
  }
  
  // Get only live-sync-selected dialogs from database
  const selectedDialogs = await dialogsCollection.find({
      tgDialogId: { 
          $in: Array.from(liveSyncChatIds).map(id => id as TelegramDialogId)
      }
  }).toArray();

  const dialogs = selectedDialogs;
  let dialogsToBackfill = dialogs;

  if (dialogs.length > 0) {
    const syncRows = await db.collection<DialogSyncStatus>('dialogSync').find(
      {
        tgDialogId: {
          $in: dialogs.map((dialog) => dialog.tgDialogId),
        },
      },
      {
        projection: {
          _id: 0,
          tgDialogId: 1,
          backfillCompletedAt: 1,
        },
      },
    ).toArray();

    const completedSet = new Set(
      syncRows
        .filter((row) => !!row?.backfillCompletedAt)
        .map((row) => row.tgDialogId),
    );

    dialogsToBackfill = dialogs.filter((dialog) => !completedSet.has(dialog.tgDialogId));
  }

  if (dialogsToBackfill.length === 0) {
    const selectedCount = dialogs.length;
    console.log(`No pending dialogs for historical backfill (${selectedCount} selected).`);
    await setAgentStatus("listening", {
      message: "All selected chats already backfilled",
      qrDataUrl: null,
    });
    return;
  }
  
  console.log(
    `Starting historical backfill for ${dialogsToBackfill.length} dialogs (selected=${dialogs.length})`,
  );
  await setAgentStatus("syncing_messages", {
    message: `Backfilling history for ${dialogsToBackfill.length} selected chats`,
    progress: {
      processed: 0,
      total: dialogsToBackfill.length,
    },
    backfill: {
      currentChatId: null,
      currentChatName: null,
      chatIndex: 0,
      totalChats: dialogsToBackfill.length,
    },
    qrDataUrl: null,
  });

  // Process messages for each dialog sequentially
  for (const [index, dialog] of dialogsToBackfill.entries()) {
      try {
          const processedCount = index + 1;
          await backfillSingleDialog(dialog, processedCount, dialogsToBackfill.length);

          await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
          console.error(`Error processing messages for dialog ${dialog.tgDialogId}:`, error);
          const processedCount = index + 1;
          await setAgentStatus("syncing_messages", {
            message: `Error backfilling chat ${dialog.tgDialogId} (${processedCount}/${dialogsToBackfill.length})`,
            progress: {
              processed: processedCount,
              total: dialogsToBackfill.length,
            },
            backfill: {
              currentChatId: dialog.tgDialogId,
              currentChatName: dialog.tgDialogId,
              chatIndex: processedCount,
              totalChats: dialogsToBackfill.length,
            },
            qrDataUrl: null,
          });
          continue;
      }
  }

  console.log('Completed historical backfill for selected dialogs');
}

type PendingDialogBackfillRequest = {
  chatId: TelegramDialogId;
  requestedAt: Date;
  mode: RequestedBackfillMode;
  afterDate?: Date;
  windowDays?: number;
};

async function claimPendingDialogBackfillRequest(): Promise<PendingDialogBackfillRequest | undefined> {
  try {
    const db = await getMongoDbClient();
    const syncCollection = db.collection<DialogSyncStatus>('dialogSync');
    const rows = await syncCollection.find(
      { forceBackfillRequestedAt: { $exists: true } },
        {
          projection: {
            _id: 0,
            tgDialogId: 1,
            forceBackfillRequestedAt: 1,
            forceBackfillMode: 1,
            forceBackfillAfterDate: 1,
            forceBackfillWindowDays: 1,
            forceBackfillHandledAt: 1,
          },
        },
    ).toArray();

    let candidate: PendingDialogBackfillRequest | undefined;
    for (const row of rows) {
      if (!isValidTelegramDialogId(row?.tgDialogId)) {
        continue;
      }
      const requestedAt = parseDateValue(row?.forceBackfillRequestedAt);
      const handledAt = parseDateValue(row?.forceBackfillHandledAt);
      if (!requestedAt) {
        continue;
      }
      if (handledAt && handledAt.getTime() >= requestedAt.getTime()) {
        continue;
      }

      if (!candidate || requestedAt.getTime() < candidate.requestedAt.getTime()) {
        const mode = normalizeRequestedBackfillMode(row?.forceBackfillMode);
        const windowDays = typeof row?.forceBackfillWindowDays === 'number' && Number.isFinite(row.forceBackfillWindowDays)
          ? row.forceBackfillWindowDays
          : undefined;
        const afterDate = parseDateValue(row?.forceBackfillAfterDate)
          || (mode === 'recent'
            ? new Date(requestedAt.getTime() - ((windowDays || 7) * 24 * 60 * 60 * 1000))
            : undefined);
        candidate = {
          chatId: row.tgDialogId,
          requestedAt,
          mode,
          afterDate,
          windowDays,
        };
      }
    }

    if (!candidate) {
      return undefined;
    }

    const claimedAt = new Date();
    const claimResult = await syncCollection.updateOne(
      {
        tgDialogId: candidate.chatId,
        forceBackfillRequestedAt: candidate.requestedAt,
        $or: [
          { forceBackfillHandledAt: { $exists: false } },
          { forceBackfillHandledAt: { $lt: candidate.requestedAt } },
        ],
      },
      {
        $set: {
          forceBackfillHandledAt: candidate.requestedAt,
          forceBackfillLastStartedAt: claimedAt,
          backfillUpdatedAt: claimedAt,
          lastSyncDate: claimedAt,
        },
      },
    );

    if ((claimResult.modifiedCount || 0) === 0) {
      return undefined;
    }

    return candidate;
  } catch (error) {
    console.error('Failed to claim pending dialog backfill request:', error);
    return undefined;
  }
}

async function markDialogBackfillRequestCompleted(chatId: TelegramDialogId) {
  try {
    const db = await getMongoDbClient();
    const now = new Date();
    await db.collection<DialogSyncStatus>('dialogSync').updateOne(
      { tgDialogId: chatId },
      {
        $set: {
          forceBackfillLastCompletedAt: now,
          backfillUpdatedAt: now,
          lastSyncDate: now,
        },
      },
    );
  } catch (error) {
    console.error(`Failed to mark dialog backfill request complete for ${chatId}:`, error);
  }
}

async function runBackfillPass(reason: string) {
  if (backfillRunInProgress) {
    console.log(`Backfill pass skipped (${reason}): another pass is already running.`);
    return false;
  }

  backfillRunInProgress = true;
  try {
    console.log(`Starting backfill pass (${reason})`);
    await processAllMessages();
    await setAgentStatus("listening", {
      message: "Listening for new messages",
      qrDataUrl: null,
    });
    return true;
  } finally {
    backfillRunInProgress = false;
  }
}

async function runSingleDialogBackfillPass(request: PendingDialogBackfillRequest, reason: string) {
  if (backfillRunInProgress) {
    console.log(`Single-chat backfill skipped (${reason}): another pass is already running.`);
    return false;
  }

  backfillRunInProgress = true;
  try {
    const dialog = await getDialogById(request.chatId);
    if (!dialog) {
      console.warn(`Skipping requested backfill; dialog not found in DB: ${request.chatId}`);
      return false;
    }

    console.log(`Starting single-chat backfill (${reason}) for ${request.chatId} [${describeBackfillWindow(request.mode, request.windowDays)}]`);
    await backfillSingleDialog(dialog, 1, 1, {
      mode: request.mode,
      afterDate: request.afterDate,
      windowDays: request.windowDays,
    });
    await setAgentStatus("listening", {
      message: "Listening for new messages",
      qrDataUrl: null,
    });
    return true;
  } finally {
    backfillRunInProgress = false;
  }
}

async function tryRunRequestedDialogBackfill(trigger: string) {
  if (backfillRunInProgress) {
    return;
  }

  const request = await claimPendingDialogBackfillRequest();
  if (!request) {
    return;
  }

  console.log(
    `Processing requested dialog backfill (${trigger}) for ${request.chatId} at ${request.requestedAt.toISOString()} [${describeBackfillWindow(request.mode, request.windowDays)}]`,
  );

  try {
    if (!(await isLiveSyncEnabled(request.chatId))) {
      console.log(`Skipping requested backfill for ${request.chatId}: chat is no longer selected for live sync.`);
      await markDialogBackfillRequestCompleted(request.chatId);
      return;
    }

    const didRun = await runSingleDialogBackfillPass(request, `requested:${trigger}`);

    if (didRun) {
      await markDialogBackfillRequestCompleted(request.chatId);
    }
  } catch (error) {
    console.error(`Requested dialog backfill failed for ${request.chatId}:`, error);
    await setAgentStatus("error", {
      message: error instanceof Error
        ? `Dialog backfill failed for ${request.chatId}: ${error.message}`
        : `Dialog backfill failed for ${request.chatId}`,
    });
  }
}

function startDialogBackfillRequestPolling() {
  if (dialogBackfillPollTimer) {
    return;
  }

  dialogBackfillPollTimer = setInterval(() => {
    if (isShuttingDown) {
      return;
    }

    tryRunRequestedDialogBackfill('poll').catch((error) => {
      console.error('Failed while polling dialog backfill requests:', error);
    });
  }, DIALOG_BACKFILL_POLL_MS);
}

async function runStartupSyncInBackground(client: TelegramClient) {
  try {
    console.log('Phase 2.5: Seeding immutable message history baselines...');
    await seedMissingMessageHistoryBaselines();

    if (isShuttingDown) {
      return;
    }

    console.log('Phase 3: Starting dialog and avatar processing in background...');
    await processAllDialogs(client);

    if (isShuttingDown) {
      return;
    }

    console.log('Phase 4: Starting historical backfill in background...');
    await runBackfillPass('startup');
    await tryRunRequestedDialogBackfill('post_startup');

    await setAgentStatus("listening", {
      message: "Listening for new messages",
      qrDataUrl: null,
    });
  } catch (error) {
    console.error('Background startup sync failed:', error);
    await setAgentStatus("listening", {
      message: error instanceof Error
        ? `Listening for new messages (background sync failed: ${error.message})`
        : "Listening for new messages (background sync failed)",
      qrDataUrl: null,
    });
  }
}

async function ensureTelegramClientHealthy(trigger: string) {
  if (isShuttingDown || telegramHealthCheckInFlight) {
    return;
  }

  telegramHealthCheckInFlight = true;
  try {
    const client = await getTelegramClient();
    attachLiveEventHandlers(client);
    await client.invoke(new Api.updates.GetState());
  } catch (error) {
    console.error(`Telegram health check failed (${trigger}):`, error);

    await setAgentStatus('error', {
      message: error instanceof Error
        ? `Telegram reconnecting after health check failure: ${error.message}`
        : 'Telegram reconnecting after health check failure',
      qrDataUrl: null,
    });

    await resetTelegramClient(`health check failure (${trigger})`);

    try {
      const recoveredClient = await getTelegramClient();
      attachLiveEventHandlers(recoveredClient);
      await setAgentStatus('listening', {
        message: 'Listening for new messages',
        qrDataUrl: null,
      });
      console.log(`Telegram client recovered after ${trigger}.`);
    } catch (recoveryError) {
      console.error(`Telegram client recovery failed (${trigger}):`, recoveryError);
    }
  } finally {
    telegramHealthCheckInFlight = false;
  }
}

function startTelegramHealthChecks() {
  if (telegramHealthCheckTimer) {
    return;
  }

  telegramHealthCheckTimer = setInterval(() => {
    ensureTelegramClientHealthy('interval').catch((error) => {
      console.error('Unexpected Telegram health check failure:', error);
    });
  }, TELEGRAM_HEALTH_CHECK_INTERVAL_MS);
}

async function main() {
  try {
    await setAgentStatus("starting", {
      message: "Agent starting",
      qrDataUrl: null,
    });

    // Phase 1: Optional backup bootstrap import
    console.log('Phase 1: Checking backup bootstrap import...');
    await runBackupBootstrapIfNeeded();

    const client = await getTelegramClient();

    // Phase 2: Start listening for new messages immediately
    console.log('Phase 2: Starting live message listener...');
    attachLiveEventHandlers(client);
    console.log('Now listening for new messages...');
    await setAgentStatus("listening", {
      message: "Listening for new messages",
      qrDataUrl: null,
    });
    startDialogBackfillRequestPolling();
    startTelegramHealthChecks();

    console.log('Phase 3: Scheduling startup dialog sync and historical backfill...');
    void runStartupSyncInBackground(client);

  } catch (error) {
    await setAgentStatus("error", {
      message: error instanceof Error ? error.message : "Unknown fatal error",
    });
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

let isShuttingDown = false;

async function releaseDialogSyncLocks() {
  try {
    const db = await getMongoDbClient();
    const syncCollection = db.collection<DialogSyncStatus>('dialogSync');
    const now = new Date();
    const result = await syncCollection.updateMany(
      { isSyncing: true },
      {
        $set: {
          isSyncing: false,
          lastSyncDate: now,
          backfillUpdatedAt: now,
        },
      },
    );

    if ((result.modifiedCount || 0) > 0) {
      console.log(`Released ${result.modifiedCount} dialog sync lock(s) during shutdown.`);
    }
  } catch (error) {
    console.error('Failed to release dialog sync locks during shutdown:', error);
  }
}

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`Received ${signal}, shutting down agent...`);

  if (dialogBackfillPollTimer) {
    clearInterval(dialogBackfillPollTimer);
    dialogBackfillPollTimer = undefined;
  }

  if (telegramHealthCheckTimer) {
    clearInterval(telegramHealthCheckTimer);
    telegramHealthCheckTimer = undefined;
  }

  await releaseDialogSyncLocks();

  if (tgClient) {
    await resetTelegramClient(`shutdown (${signal})`, tgClient);
  }

  if (mongoClientConnection) {
    try {
      await mongoClientConnection.close();
    } catch (error) {
      console.error('Error closing MongoDB connection during shutdown:', error);
    }
  }

  process.exit(0);
}

// Add some basic error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').catch((error) => {
    console.error('Error during SIGINT shutdown:', error);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch((error) => {
    console.error('Error during SIGTERM shutdown:', error);
    process.exit(1);
  });
});

// Helper function to safely stringify values including BigInt
function safeStringify(value: any): string {
  return JSON.stringify(value, (_, v) =>
    typeof v === 'bigint' ? v.toString() : v
  );
}

// Helper function to normalize object for comparison
function normalizeForComparison(obj: any): any {
  // Deep clone the object
  const normalized = JSON.parse(safeStringify(obj));

  // Remove MongoDB and metadata fields that shouldn't trigger changes
  const fieldsToRemove = [
    '_id',
    'metadata',
    'tgDialogId'
  ];

  function removeFields(object: any) {
    if (object && typeof object === 'object') {
      fieldsToRemove.forEach(field => delete object[field]);
      Object.values(object).forEach(value => {
        if (value && typeof value === 'object') {
          removeFields(value);
        }
      });
    }
    return object;
  }

  return removeFields(normalized);
}

// Modified findChanges function
function findChanges(oldObj: any, newObj: any, path: string = ''): Record<string, { old: any, new: any }> {
  const normalizedOld = normalizeForComparison(oldObj);
  const normalizedNew = normalizeForComparison(newObj);
  const changes: Record<string, { old: any, new: any }> = {};

  function compareObjects(oldValue: any, newValue: any, currentPath: string = '') {
    if (oldValue === newValue) return;

    if (typeof oldValue !== typeof newValue) {
      changes[currentPath] = { old: oldValue, new: newValue };
      return;
    }

    if (typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)) {
      const keys = new Set([...Object.keys(oldValue || {}), ...Object.keys(newValue)]);

      for (const key of keys) {
        const nextPath = currentPath ? `${currentPath}.${key}` : key;
        const oldVal = oldValue?.[key];
        const newVal = newValue[key];

        if (!areValuesEqual(oldVal, newVal)) {
          if (typeof newVal === 'object' && newVal !== null && !Array.isArray(newVal)) {
            compareObjects(oldVal, newVal, nextPath);
          } else {
            changes[nextPath] = { old: oldVal, new: newVal };
          }
        }
      }
    } else if (!areValuesEqual(oldValue, newValue)) {
      changes[currentPath] = { old: oldValue, new: newValue };
    }
  }

  compareObjects(normalizedOld, normalizedNew);
  return changes;
}

// Helper function to compare values of any type
function areValuesEqual(val1: any, val2: any): boolean {
  // Handle BigInt comparison
  if (typeof val1 === 'bigint' || typeof val2 === 'bigint') {
    return val1 === val2;
  }

  // Handle Date comparison
  if (val1 instanceof Date && val2 instanceof Date) {
    return val1.getTime() === val2.getTime();
  }

  // Handle null/undefined
  if (val1 === null || val1 === undefined || val2 === null || val2 === undefined) {
    return val1 === val2;
  }

  // Handle arrays
  if (Array.isArray(val1) && Array.isArray(val2)) {
    return safeStringify(val1) === safeStringify(val2);
  }

  // Handle objects
  if (typeof val1 === 'object' && typeof val2 === 'object') {
    return safeStringify(val1) === safeStringify(val2);
  }

  // Handle primitive types
  return val1 === val2;
}

// When storing in MongoDB, we need to convert BigInt to string
function prepareFoMongoDB(obj: any): any {
  return JSON.parse(safeStringify(obj));
}

// Helper functions for TelegramDialogId
function createTelegramDialogId(id: string | number | bigint): TelegramDialogId {
  if (typeof id === 'bigint') {
    return id.toString() as TelegramDialogId;
  }
  return String(id) as TelegramDialogId;
}

function isValidTelegramDialogId(id: any): id is TelegramDialogId {
  return typeof id === 'string' && /^-?\d+$/.test(id);
}

// in agent/index.ts

async function saveDialog(dialog: Dialog) {
  if (!dialog.id) {
    console.error("Dialog id is missing");
    return;
  }

  const tgDialogId = createTelegramDialogId(dialog.id);
  if (!isValidTelegramDialogId(tgDialogId)) {
    console.error(`Invalid dialog id: ${tgDialogId}`);
    return;
  }

  // Download and store avatar
  let avatarKey: string | undefined;
  try {
    if (dialog.entity?.photo) {
      const client = await getTelegramClient();
      const buffer = await withTimeout(
        client.downloadProfilePhoto(dialog.entity),
        EFFECTIVE_DIALOG_AVATAR_DOWNLOAD_TIMEOUT_MS,
        `downloading avatar for dialog ${tgDialogId}`,
      );
      if (buffer) {
        const tempPath = join(tmpdir(), `avatar-${Date.now()}.jpg`);
        await writeFile(tempPath, buffer);
        avatarKey = await uploadFile(tempPath);
        await unlink(tempPath);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Skipping avatar for dialog ${tgDialogId}: ${message}`);
  }

  const client = await getMongoDbClient();
  const dialogsCollection = client.collection<DialogDocument>("dialogs");
  const dialogHistoryCollection = client.collection("dialogHistory");

  const fieldsToOmit = [
    "_client",
    "dialog",
    "draft",
    "entity.originalArgs",
    "entity.photo.originalArgs",
    "entity.status.originalArgs",
    "inputEntity",
    "message",
  ];

  // Extract additional information
  const additionalInfo = {
    avatar: avatarKey,
    about: dialog.entity?.about,
    username: dialog.entity?.username,
    phone: dialog.entity?.phone,
    firstName: dialog.entity?.firstName,
    lastName: dialog.entity?.lastName,
    title: dialog.entity?.title,
    participantsCount: dialog.entity?.participantsCount,
    verified: dialog.entity?.verified,
    premium: dialog.entity?.premium,
    scam: dialog.entity?.scam,
    fake: dialog.entity?.fake,
    restricted: dialog.entity?.restricted,
    accessHash: dialog.entity?.accessHash?.toString(),
    bot: dialog.entity?.bot,
    botInfoVersion: dialog.entity?.botInfoVersion,
    botInlinePlaceholder: dialog.entity?.botInlinePlaceholder,
    mutualContact: dialog.entity?.mutualContact,
  };

  const dialogWithoutExtraFields = {
    ...omitPaths(dialog, fieldsToOmit),
    ...additionalInfo
  };

  // Get existing dialog
  const existingDialog = await dialogsCollection.findOne({ tgDialogId });

  if (existingDialog) {
    // Compare changes
    const changes = findChanges(existingDialog, dialogWithoutExtraFields);

    // Only proceed if there are real changes (not just metadata/MongoDB fields)
    if (Object.keys(changes).length > 0) {
      const timestamp = new Date();
      const version = (existingDialog.metadata?.version || 0) + 1;

      // Create historical record only if there are actual changes
      const historyEntry = prepareFoMongoDB({
        tgDialogId,
        version,
        timestamp,
        previousVersion: existingDialog.metadata?.version || 0,
        changes,
        previousState: normalizeForComparison(existingDialog),
        newState: normalizeForComparison(dialogWithoutExtraFields),
      });

      // Save to history collection
      await dialogHistoryCollection.insertOne(historyEntry);

      // Update current dialog
      const updatedDialog: DialogDocument = prepareFoMongoDB({
        ...dialogWithoutExtraFields,
        tgDialogId,
        bootstrap: existingDialog.bootstrap,
        metadata: {
          firstArchived: existingDialog.metadata?.firstArchived || timestamp,
          lastUpdated: timestamp,
          version,
          updateCount: (existingDialog.metadata?.updateCount || 0) + 1,
          changeHistory: [
            ...(existingDialog.metadata?.changeHistory || []),
            {
              version,
              timestamp,
              changes,
            }
          ].slice(-10)
        }
      });

      await dialogsCollection.replaceOne({ tgDialogId }, updatedDialog);
      console.log(`Updated dialog ${tgDialogId} to version ${version} with ${Object.keys(changes).length} real changes`);
    } else {
      console.log(`No real changes detected for dialog ${tgDialogId}`);
    }
  } else {
    // First time seeing this dialog
    const timestamp = new Date();
    const initialDialog: DialogDocument = prepareFoMongoDB({
      ...dialogWithoutExtraFields,
      tgDialogId,
      bootstrap: existingDialog?.bootstrap,
      metadata: {
        firstArchived: timestamp,
        lastUpdated: timestamp,
        version: 1,
        updateCount: 1,
        changeHistory: []
      }
    });

    await dialogsCollection.insertOne(initialDialog);
    console.log(`Created new dialog with id: ${tgDialogId}`);
  }
}

// Helper functions for querying
async function getDialogById(tgDialogId: TelegramDialogId): Promise<DialogDocument | null> {
  const client = await getMongoDbClient();
  return client.collection<DialogDocument>("dialogs").findOne({ tgDialogId });
}

async function getDialogHistory(tgDialogId: TelegramDialogId) {
  const client = await getMongoDbClient();
  return client.collection("dialogHistory")
    .find({ tgDialogId })
    .sort({ version: 1 })
    .toArray();
}

async function getDialogVersion(tgDialogId: TelegramDialogId, version: number) {
  const client = await getMongoDbClient();
  return client.collection("dialogHistory")
    .findOne({ tgDialogId, version });
}

async function getChangesBetweenVersions(
  tgDialogId: TelegramDialogId,
  fromVersion: number,
  toVersion: number
) {
  const client = await getMongoDbClient();
  return client.collection("dialogHistory")
    .find({
      tgDialogId,
      version: {
        $gt: fromVersion,
        $lte: toVersion
      }
    })
    .sort({ version: 1 })
    .toArray();
}

// Collection to track sync status
async function getDialogSyncCollection() {
  const db = await getMongoDbClient();
  return db.collection<DialogSyncStatus>("dialogSync");
}

async function getMessageHistoryCollection() {
  const db = await getMongoDbClient();
  const collection = db.collection<MessageHistoryDocument>('messageHistory');

  if (!messageHistoryIndexesReady) {
    messageHistoryIndexesReady = Promise.all([
      collection.createIndex({ tgChatId: 1, tgMessageId: 1, version: 1 }, { unique: true }),
      collection.createIndex({ tgChatId: 1, observedAt: 1, version: 1 }),
      collection.createIndex({ tgChatId: 1, tgMessageId: 1, observedAt: 1 }),
    ]).then(() => undefined).catch((error) => {
      console.error('Failed to ensure message history indexes:', error);
    });
  }

  await messageHistoryIndexesReady;
  return collection;
}

async function seedMissingMessageHistoryBaselines(batchSize = 250) {
  const db = await getMongoDbClient();
  const messagesCollection = db.collection<MessageDocument>('messages');
  const historyCollection = await getMessageHistoryCollection();
  let seededCount = 0;

  while (true) {
    const missingBaselineDocs = await messagesCollection.find(
      {
        $or: [
          { 'metadata.currentVersion': { $exists: false } },
          { 'metadata.currentVersion': { $lt: 1 } },
        ],
      },
      { limit: batchSize },
    ).toArray();

    if (missingBaselineDocs.length === 0) {
      break;
    }

    const observedAt = new Date();
    await historyCollection.bulkWrite(
      missingBaselineDocs.map((doc: any) => {
        const baselineObservedAt = doc?.metadata?.lastMutationAt
          || doc?.metadata?.firstSeenAt
          || doc?.metadata?.importedAt
          || doc?.metadata?.originalDate
          || observedAt;
        const baselineDoc = {
          ...cloneForMutation(doc),
          metadata: {
            ...(cloneForMutation(doc?.metadata || {})),
            firstSeenAt: doc?.metadata?.firstSeenAt || doc?.metadata?.importedAt || baselineObservedAt,
            lastMutationAt: doc?.metadata?.lastMutationAt || doc?.metadata?.importedAt || baselineObservedAt,
            currentVersion: 1,
          },
        };

        return {
          updateOne: {
            filter: {
              tgChatId: doc.tgChatId,
              tgMessageId: doc.tgMessageId,
              version: 1,
            },
            update: {
              $setOnInsert: prepareFoMongoDB({
                tgChatId: doc.tgChatId,
                tgMessageId: doc.tgMessageId,
                version: 1,
                eventType: 'baseline',
                observedAt: baselineObservedAt,
                source: doc?.metadata?.source === 'backup' ? 'backup' : 'live',
                changedFields: [],
                summary: 'Baseline snapshot seeded from existing archive state',
                changes: {},
                before: null,
                after: normalizeMessageSnapshotForHistory(baselineDoc),
              }),
            },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );

    await messagesCollection.bulkWrite(
      missingBaselineDocs.map((doc: any) => {
        const baselineObservedAt = doc?.metadata?.lastMutationAt
          || doc?.metadata?.firstSeenAt
          || doc?.metadata?.importedAt
          || doc?.metadata?.originalDate
          || observedAt;
        return {
          updateOne: {
            filter: {
              _id: doc._id,
            },
            update: {
              $set: {
                'metadata.firstSeenAt': doc?.metadata?.firstSeenAt || doc?.metadata?.importedAt || baselineObservedAt,
                'metadata.lastMutationAt': doc?.metadata?.lastMutationAt || doc?.metadata?.importedAt || baselineObservedAt,
                'metadata.currentVersion': 1,
              },
            },
          },
        };
      }),
      { ordered: false },
    );

    seededCount += missingBaselineDocs.length;
    console.log(`Seeded message history baselines for ${seededCount} archived messages so far...`);
  }

  if (seededCount > 0) {
    console.log(`Seeded immutable history baselines for ${seededCount} existing archived messages.`);
  }
}

// Get the latest archived message for a dialog
async function getLatestArchivedMessage(tgDialogId: TelegramDialogId): Promise<number | undefined> {
  const db = await getMongoDbClient();
  const result = await db.collection("messages").findOne(
    { tgChatId: BigInt(tgDialogId) },
    { sort: { tgMessageId: -1 }, projection: { tgMessageId: 1 } }
  );
  return result?.tgMessageId;
}

type HistoricalBackfillSummary = {
  scannedMessages: number;
  importedMessages: number;
  skippedExistingMessages: number;
  enrichedExistingMessages: number;
  enrichedSenderMessages: number;
  enrichedChatMessages: number;
  enrichedGeoMessages: number;
  enrichedFormattingMessages: number;
  enrichedReplyMessages: number;
};

type HistoricalBackfillProgress = {
  scannedMessages: number;
  importedMessages: number;
  skippedExistingMessages: number;
  enrichedMessages: number;
};

type HistoricalBackfillOptions = {
  mode?: RequestedBackfillMode;
  afterDate?: Date;
  windowDays?: number;
  onProgress?: (progress: HistoricalBackfillProgress) => Promise<void> | void;
};

function createEmptyBackfillSummary(): HistoricalBackfillSummary {
  return {
    scannedMessages: 0,
    importedMessages: 0,
    skippedExistingMessages: 0,
    enrichedExistingMessages: 0,
    enrichedSenderMessages: 0,
    enrichedChatMessages: 0,
    enrichedGeoMessages: 0,
    enrichedFormattingMessages: 0,
    enrichedReplyMessages: 0,
  };
}

// Function to sync historical messages
async function syncHistoricalMessages(
  tgDialogId: TelegramDialogId,
  options: HistoricalBackfillOptions = {},
): Promise<HistoricalBackfillSummary> {
  if (!isValidTelegramDialogId(tgDialogId)) {
    throw new Error(`Invalid Telegram dialog id for backfill: ${tgDialogId}`);
  }

  const tgChatId = BigInt(tgDialogId);
  const syncCollection = await getDialogSyncCollection();
  const staleSyncLockMs = EFFECTIVE_BACKFILL_STALE_LOCK_MS;

  // Check if already syncing
  const syncStatus = await syncCollection.findOne({ tgDialogId });
  if (syncStatus?.isSyncing) {
    const lastSyncDate = syncStatus.lastSyncDate ? new Date(syncStatus.lastSyncDate).getTime() : 0;
    const lockAgeMs = Date.now() - lastSyncDate;
    if (lastSyncDate > 0 && lockAgeMs < staleSyncLockMs) {
      console.log(`Dialog ${tgDialogId} is already being synced`);
      return createEmptyBackfillSummary();
    }

    console.warn(`Recovering stale sync lock for dialog ${tgDialogId}`);
    await syncCollection.updateOne(
      { tgDialogId },
      {
        $set: {
          isSyncing: false,
          lastSyncDate: new Date(),
        },
      },
    );
  }

  const lastMessageId = await getLatestArchivedMessage(tgDialogId);
  const existingSyncStatus = await syncCollection.findOne({ tgDialogId });
  const backfillMode = normalizeRequestedBackfillMode(options.mode);
  const recentAfterDate = backfillMode === 'recent'
    ? parseDateValue(options.afterDate)
    : undefined;
  const recentAfterDateMs = recentAfterDate?.getTime() ?? 0;
  const hasRecentWindow = backfillMode === 'recent' && recentAfterDateMs > 0;
  const startOffsetId = backfillMode === 'full' && typeof existingSyncStatus?.backfillOffsetId === 'number'
    ? existingSyncStatus.backfillOffsetId
    : 0;
  const backfillWindowLabel = describeBackfillWindow(backfillMode, options.windowDays);

  const initialUpdate: Record<string, unknown> = {
    $set: {
      isSyncing: true,
      lastSyncDate: new Date(),
      lastMessageId,
      backfillScannedMessages: 0,
      backfillImportedMessages: 0,
      backfillSkippedExistingMessages: 0,
      backfillUpdatedAt: new Date(),
    },
  };
  if (backfillMode === 'full') {
    initialUpdate.$unset = {
      backfillCompletedAt: '',
    };
  }

  await syncCollection.updateOne(
    { tgDialogId },
    initialUpdate,
    { upsert: true },
  );

  try {
    const client = await getTelegramClient();
    const db = await getMongoDbClient();
    const messagesCollection = db.collection<MessageDocument>("messages");

    const batchSize = 100;
    let offsetId = startOffsetId;
    let scannedMessages = 0;
    let importedMessages = 0;
    let skippedExistingMessages = 0;
    let enrichedExistingMessages = 0;
    let enrichedSenderMessages = 0;
    let enrichedChatMessages = 0;
    let enrichedGeoMessages = 0;
    let enrichedFormattingMessages = 0;
    let enrichedReplyMessages = 0;

    while (true) {
      console.log(`Backfill fetch for dialog ${tgDialogId}, offset: ${offsetId}, window=${backfillWindowLabel}`);

      const fetchedMessages = await client.getMessages(tgChatId, {
        limit: batchSize,
        offsetId: offsetId,
      });

      if (!fetchedMessages.length) {
        const terminalUpdate: Record<string, unknown> = {
          $set: {
            backfillUpdatedAt: new Date(),
          },
        };
        if (backfillMode === 'full') {
          terminalUpdate.$set = {
            ...(terminalUpdate.$set as Record<string, unknown>),
            backfillOffsetId: null,
            backfillCompletedAt: new Date(),
          };
        }
        await syncCollection.updateOne({ tgDialogId }, terminalUpdate);
        break;
      }

      const messages = hasRecentWindow
        ? fetchedMessages.filter((message) => getTelegramMessageDateMs(message) >= recentAfterDateMs)
        : fetchedMessages;
      const crossedRecentWindow = hasRecentWindow && messages.length < fetchedMessages.length;
      if (messages.length === 0) {
        await syncCollection.updateOne(
          { tgDialogId },
          {
            $set: {
              backfillUpdatedAt: new Date(),
            },
          },
        );
        break;
      }

      scannedMessages += messages.length;
      let batchImportedMessages = 0;
      let batchSkippedExistingMessages = 0;

      const messageIds = messages.map((message) => message.id);
      const existingMessages = await messagesCollection.find(
        {
          tgChatId,
          tgMessageId: { $in: messageIds },
        },
        {
          projection: {
            tgMessageId: 1,
            type: 1,
            chatName: 1,
            chatType: 1,
            sender: 1,
            service: 1,
            reactions: 1,
            'metadata.source': 1,
            'replyTo.messageId': 1,
            'content.type': 1,
            'content.text': 1,
            'content.entities': 1,
            'content.location': 1,
            'content.media': 1,
            'content.service': 1,
          },
        },
      ).toArray();
      const existingMessageMap = new Map(existingMessages.map((doc: any) => [doc.tgMessageId, doc]));

      for (const message of messages) {
        const existingDoc = existingMessageMap.get(message.id);
        if (existingDoc) {
          const changed = await handleMessage(message, { eventType: 'sync_updated', existingDoc });
          if (changed) {
            enrichedExistingMessages += 1;
            enrichedSenderMessages += 1;
            enrichedChatMessages += 1;
            enrichedGeoMessages += 1;
            enrichedFormattingMessages += 1;
            enrichedReplyMessages += 1;
          }

          batchSkippedExistingMessages += 1;
          skippedExistingMessages += 1;
          continue;
        }

        await handleMessage(message);
        batchImportedMessages += 1;
        importedMessages += 1;
      }

      const oldestFetchedMessageId = Math.min(...fetchedMessages.map((message) => message.id));
      if (!crossedRecentWindow) {
        if (oldestFetchedMessageId === offsetId) {
          console.warn(`Backfill offset did not advance for dialog ${tgDialogId}; forcing offset rewind.`);
        }
        offsetId = oldestFetchedMessageId > 1 ? oldestFetchedMessageId - 1 : oldestFetchedMessageId;
      }

      const progressUpdate: Record<string, unknown> = {
        $set: {
          backfillUpdatedAt: new Date(),
        },
        $inc: {
          backfillScannedMessages: messages.length,
          backfillImportedMessages: batchImportedMessages,
          backfillSkippedExistingMessages: batchSkippedExistingMessages,
        },
      };
      if (backfillMode === 'full' && !crossedRecentWindow) {
        progressUpdate.$set = {
          ...(progressUpdate.$set as Record<string, unknown>),
          backfillOffsetId: offsetId,
        };
      }

      await syncCollection.updateOne({ tgDialogId }, progressUpdate);

      await options.onProgress?.({
        scannedMessages,
        importedMessages,
        skippedExistingMessages,
        enrichedMessages: enrichedExistingMessages,
      });

      if (crossedRecentWindow) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(
      `Finished ${backfillWindowLabel} backfill for dialog ${tgDialogId}: scanned=${scannedMessages}, imported=${importedMessages}, enriched existing=${enrichedExistingMessages} (sender=${enrichedSenderMessages}, chat=${enrichedChatMessages}, geo=${enrichedGeoMessages}, formatting=${enrichedFormattingMessages}, reply=${enrichedReplyMessages}), skipped existing=${skippedExistingMessages}, previous latest=${lastMessageId ?? 'none'}`,
    );

    return {
      scannedMessages,
      importedMessages,
      skippedExistingMessages,
      enrichedExistingMessages,
      enrichedSenderMessages,
      enrichedChatMessages,
      enrichedGeoMessages,
      enrichedFormattingMessages,
      enrichedReplyMessages,
    };

  } catch (error) {
    console.error(`Error backfilling messages for dialog ${tgDialogId}:`, error);
    throw error;
  } finally {
    await syncCollection.updateOne(
      { tgDialogId },
      {
        $set: {
          isSyncing: false,
          lastSyncDate: new Date(),
          backfillUpdatedAt: new Date(),
        },
      },
    );
  }
}

async function handleNewMessageEvent(incomingMessageEvent: NewMessageEvent) {
  const { message } = incomingMessageEvent;
  await ensureDialogExistsForLiveMessage(message);
  const chatId = message.chatId?.toString() || extractPeerIdentifier((message as any).peerId);
  
  if (!chatId || !(await isLiveSyncEnabled(chatId))) {
      return; // Skip messages from chats not selected for live sync
  }

  await handleMessage(message);
}

type LiveDialogSeed = {
  tgDialogId: TelegramDialogId;
  title?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  chatType?: string;
  isUser: boolean;
  isGroup: boolean;
  isChannel: boolean;
  entity: {
    className?: string;
    bot?: boolean;
    deleted?: boolean;
    username?: string;
    firstName?: string;
    lastName?: string;
    title?: string;
    megagroup?: boolean;
    broadcast?: boolean;
  };
};

function parseLiveDialogSeed(message: Api.Message): LiveDialogSeed | undefined {
  const peerId = (message as any).peerId;
  const chatId = message.chatId?.toString() || extractPeerIdentifier(peerId);
  if (!chatId || !isValidTelegramDialogId(chatId)) {
    return undefined;
  }

  const chatEntity = (message as any).chat;
  const peerClassName = typeof peerId?.className === 'string' ? peerId.className : '';
  const entityClassName = typeof chatEntity?.className === 'string' ? chatEntity.className : '';
  const isMegagroup = Boolean(chatEntity?.megagroup);

  const inferredIsUser = peerClassName === 'PeerUser' || entityClassName.includes('User');
  const inferredIsGroup = peerClassName === 'PeerChat'
    || (peerClassName === 'PeerChannel' && isMegagroup)
    || (entityClassName.includes('Chat') && !entityClassName.includes('Channel'));
  const inferredIsChannel = peerClassName === 'PeerChannel'
    ? !isMegagroup
    : (entityClassName.includes('Channel') && !isMegagroup);

  const title = typeof chatEntity?.title === 'string' ? chatEntity.title.trim() : '';
  const firstName = typeof chatEntity?.firstName === 'string' ? chatEntity.firstName.trim() : '';
  const lastName = typeof chatEntity?.lastName === 'string' ? chatEntity.lastName.trim() : '';
  const username = typeof chatEntity?.username === 'string' ? chatEntity.username.trim() : '';
  const fallbackName = resolveDisplayName(chatEntity) || '';
  const normalizedTitle = title || (!firstName && !lastName ? fallbackName : '');
  const chatType = inferredIsUser
    ? (chatEntity?.bot ? 'bot' : 'user')
    : inferredIsGroup
      ? 'group'
      : inferredIsChannel
        ? 'channel'
        : undefined;

  return {
    tgDialogId: createTelegramDialogId(chatId),
    title: normalizedTitle || undefined,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    username: username || undefined,
    chatType,
    isUser: inferredIsUser,
    isGroup: inferredIsGroup,
    isChannel: inferredIsChannel,
    entity: {
      className: entityClassName || undefined,
      bot: Boolean(chatEntity?.bot) || undefined,
      deleted: Boolean(chatEntity?.deleted) || undefined,
      username: username || undefined,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      title: title || undefined,
      megagroup: isMegagroup || undefined,
      broadcast: Boolean(chatEntity?.broadcast) || undefined,
    },
  };
}

async function ensureDialogExistsForLiveMessage(message: Api.Message) {
  const seed = parseLiveDialogSeed(message);
  if (!seed) {
    return;
  }

  if (liveDiscoveredDialogIds.has(seed.tgDialogId)) {
    return;
  }

  const db = await getMongoDbClient();
  const dialogsCollection = db.collection<DialogDocument>('dialogs');
  const now = new Date();
  const upsertResult = await dialogsCollection.updateOne(
    { tgDialogId: seed.tgDialogId },
    {
      $setOnInsert: prepareFoMongoDB({
        tgDialogId: seed.tgDialogId,
        title: seed.title,
        firstName: seed.firstName,
        lastName: seed.lastName,
        username: seed.username,
        chatType: seed.chatType,
        isUser: seed.isUser,
        isGroup: seed.isGroup,
        isChannel: seed.isChannel,
        archived: false,
        pinned: false,
        entity: seed.entity,
        metadata: {
          firstArchived: now,
          lastUpdated: now,
          version: 1,
          updateCount: 1,
          changeHistory: [],
        },
      }),
    },
    { upsert: true },
  );

  if ((upsertResult.upsertedCount || 0) > 0) {
    console.log(`Discovered new dialog from live message: ${seed.tgDialogId}`);
  }

  if ((upsertResult.matchedCount || 0) > 0 || (upsertResult.upsertedCount || 0) > 0) {
    liveDiscoveredDialogIds.add(seed.tgDialogId);
  }
}

async function handleReactionUpdateEvent(update: Api.UpdateMessageReactions) {
  const chatId = extractPeerIdentifier(update.peer);
  if (!chatId || !(await isLiveSyncEnabled(chatId))) {
    return;
  }

  const reactions = normalizeTelegramReactions(update.reactions, { includeEmpty: true });
  if (reactions === undefined) {
    await refetchAndHandleLiveMessage(chatId, update.msgId);
    return;
  }

  await updateStoredMessageReactions(chatId, update.msgId, reactions);
}

async function handleEditedMessageEvent(update: Api.UpdateEditMessage | Api.UpdateEditChannelMessage) {
  const message = update.message as Api.Message | undefined;
  const chatId = message?.chatId?.toString() || extractPeerIdentifier((message as any)?.peerId);
  if (!chatId || !(await isLiveSyncEnabled(chatId))) {
    return;
  }

  if (!message || typeof message.id !== 'number') {
    console.warn(`Received edit update without message payload for chat ${chatId}.`);
    return;
  }

  await handleMessage(message, { eventType: 'edited' });
}

async function handleDeletedMessageEvent(update: Api.UpdateDeleteMessages | Api.UpdateDeleteChannelMessages) {
  if (update instanceof Api.UpdateDeleteChannelMessages) {
    const chatId = update.channelId?.toString?.() || String(update.channelId || '');
    if (!chatId || !(await isLiveSyncEnabled(chatId))) {
      return;
    }

    await markMessagesDeleted(update.messages, { chatId });
    return;
  }

  await markMessagesDeleted(update.messages);
}

function normalizeLiveEntityType(className: string): string {
  const entityType = className.replace(/^MessageEntity/, '');
  const lower = entityType.toLowerCase();

  if (lower === 'texturl') return 'text_link';
  if (lower === 'mentionname') return 'text_mention';
  if (lower === 'strike') return 'strikethrough';

  return lower;
}

type ParsedLiveEntity = {
  start: number;
  end: number;
  text: string;
  type: string;
  href?: string;
  url?: string;
  language?: string;
};

function parseLiveTextEntities(message: Api.Message): { textParts?: TextPart[]; entities?: TextEntity[] } {
  const text = message.message || '';
  const rawEntities = Array.isArray((message as any).entities) ? (message as any).entities : [];

  if (!text || rawEntities.length === 0) {
    return {};
  }

  const parsed: ParsedLiveEntity[] = [];
  for (const entity of rawEntities) {
    if (!entity || typeof entity.offset !== 'number' || typeof entity.length !== 'number') {
      continue;
    }

    const start = entity.offset;
    const end = entity.offset + entity.length;
    if (start < 0 || end <= start || start >= text.length) {
      continue;
    }

    const clampedEnd = Math.min(end, text.length);
    const segmentText = text.slice(start, clampedEnd);
    if (!segmentText) {
      continue;
    }

    const className = typeof entity.className === 'string' ? entity.className : 'MessageEntityUnknown';
    const type = normalizeLiveEntityType(className);

    const parsedEntity: ParsedLiveEntity = {
      start,
      end: clampedEnd,
      text: segmentText,
      type,
    };

    if (type === 'text_link' && entity.url) {
      parsedEntity.href = entity.url;
    } else if (type === 'link') {
      parsedEntity.href = segmentText;
      parsedEntity.url = segmentText;
    } else if (type === 'text_mention' && entity.userId) {
      parsedEntity.href = `https://t.me/${entity.userId.toString()}`;
    }

    if (type === 'pre' && typeof entity.language === 'string' && entity.language.length > 0) {
      parsedEntity.language = entity.language;
    }

    parsed.push(parsedEntity);
  }

  if (!parsed.length) {
    return {};
  }

  parsed.sort((a, b) => {
    if (a.start === b.start) {
      return (b.end - b.start) - (a.end - a.start);
    }
    return a.start - b.start;
  });

  const selected: ParsedLiveEntity[] = [];
  let lastEnd = -1;
  for (const entity of parsed) {
    if (entity.start < lastEnd) {
      continue;
    }
    selected.push(entity);
    lastEnd = entity.end;
  }

  const textParts: TextPart[] = [];
  let cursor = 0;
  for (const entity of selected) {
    if (entity.start > cursor) {
      textParts.push({
        type: 'plain',
        text: text.slice(cursor, entity.start),
      });
    }

    textParts.push({
      type: entity.type,
      text: entity.text,
      href: entity.href,
      url: entity.url,
      language: entity.language,
    });

    cursor = entity.end;
  }

  if (cursor < text.length) {
    textParts.push({
      type: 'plain',
      text: text.slice(cursor),
    });
  }

  return {
    textParts,
    entities: selected.map((entity) => ({
      type: entity.type,
      text: entity.text,
      href: entity.href,
      url: entity.url,
      language: entity.language,
    })),
  };
}

function extractLiveReplyToMessageId(message: Api.Message): number | undefined {
  const direct = (message as any).replyToMsgId;
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return direct;
  }

  const replyTo = (message as any).replyTo;
  const nested = replyTo?.replyToMsgId;
  if (typeof nested === 'number' && Number.isFinite(nested)) {
    return nested;
  }

  return undefined;
}

function extractLiveForwardedFrom(message: Api.Message): string | undefined {
  const fwdFrom = (message as any).fwdFrom;
  if (!fwdFrom) {
    return undefined;
  }

  if (typeof fwdFrom.fromName === 'string' && fwdFrom.fromName.trim().length > 0) {
    return fwdFrom.fromName.trim();
  }

  const fromId = extractPeerIdentifier(fwdFrom.fromId);
  if (fromId) {
    return fromId;
  }

  return undefined;
}

function extractLiveEditedInfo(message: Api.Message): { date: Date; unixtime: number } | undefined {
  const editDate = (message as any).editDate;
  if (typeof editDate === 'number' && Number.isFinite(editDate) && editDate > 0) {
    return {
      date: new Date(editDate * 1000),
      unixtime: editDate,
    };
  }

  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function mapServiceTypeFromAction(actionClassName: string): string {
  const normalized = actionClassName.replace(/^MessageAction/, '');

  switch (normalized) {
    case 'PhoneCall':
      return 'phone_call';
    case 'PinMessage':
      return 'pin_message';
    case 'ChatCreate':
      return 'chat_created';
    case 'ChatAddUser':
    case 'ChatJoinedByLink':
    case 'ChatJoinedByRequest':
      return 'member_joined';
    case 'ChatDeleteUser':
      return 'member_left';
    default:
      return normalized ? toSnakeCase(normalized) : 'service';
  }
}

function extractCallDiscardReason(action: any): string | undefined {
  const reasonClass = typeof action?.reason?.className === 'string'
    ? action.reason.className
    : undefined;

  if (!reasonClass) {
    return undefined;
  }

  const normalized = reasonClass.replace(/^PhoneCallDiscardReason/, '');
  return normalized ? toSnakeCase(normalized) : undefined;
}

function extractLiveServiceInfo(
  message: Api.Message,
  context: LiveMessageContext,
  replyToMessageId?: number,
): ServiceInfo | undefined {
  const action = (message as any).action;
  if (!action || typeof action !== 'object') {
    return undefined;
  }

  const actionClassName = typeof action.className === 'string' ? action.className : '';
  const type = mapServiceTypeFromAction(actionClassName);

  const details: ServiceInfo['details'] = {};

  if (type === 'phone_call') {
    const duration = toFiniteNumber(action.duration);
    if (typeof duration === 'number' && duration > 0) {
      details.duration = duration;
    }

    const discardReason = extractCallDiscardReason(action);
    if (discardReason) {
      details.discardReason = discardReason;
    }
  }

  if (type === 'pin_message') {
    const pinnedMessageId = typeof replyToMessageId === 'number' && Number.isFinite(replyToMessageId)
      ? replyToMessageId
      : toFiniteNumber((message as any).replyToMsgId);

    if (typeof pinnedMessageId === 'number' && pinnedMessageId > 0) {
      details.pinnedMessageId = pinnedMessageId;
    }
  }

  const actorName = typeof context.senderName === 'string' && context.senderName.trim().length > 0
    ? context.senderName
    : 'Unknown';
  const actorId = typeof context.senderId === 'string' && context.senderId.trim().length > 0
    ? context.senderId
    : 'unknown';

  const hasDetails = Object.values(details).some((value) => value !== undefined);

  return {
    type,
    actor: {
      name: actorName,
      id: actorId,
    },
    ...(hasDetails ? { details } : {}),
  };
}

function buildFallbackLiveText(message: Api.Message, includeMedia: boolean): string | undefined {
  const mediaClassName = typeof (message as any)?.media?.className === 'string'
    ? (message as any).media.className
    : undefined;

  if (mediaClassName && mediaClassName !== 'MessageMediaEmpty') {
    if (!includeMedia) {
      return undefined;
    }
    return `[Unsupported Telegram media: ${mediaClassName}]`;
  }

  return '[Empty Telegram message]';
}

function normalizeTelegramReactions(
  reactions: { results?: any[] } | undefined,
  options: { includeEmpty?: boolean } = {},
): MessageReaction[] | undefined {
  const results = Array.isArray(reactions?.results) ? reactions.results : undefined;
  if (!results) {
    return undefined;
  }

  const normalized: MessageReaction[] = [];
  for (const result of results) {
    const count = toFiniteNumber(result?.count);
    if (!count || count <= 0) {
      continue;
    }

    const chosenOrder = toFiniteNumber(result?.chosenOrder);
    const reaction = result?.reaction;
    const className = typeof reaction?.className === 'string' ? reaction.className : '';

    if (className === 'ReactionEmoji' || typeof reaction?.emoticon === 'string') {
      const emoji = typeof reaction?.emoticon === 'string' ? reaction.emoticon : undefined;
      normalized.push({
        type: 'emoji',
        emoji,
        count,
        ...(typeof chosenOrder === 'number' ? { chosenOrder } : {}),
      });
      continue;
    }

    if (className === 'ReactionCustomEmoji' || reaction?.documentId !== undefined) {
      const customEmojiId = reaction?.documentId?.toString?.();
      normalized.push({
        type: 'custom_emoji',
        customEmojiId: typeof customEmojiId === 'string' ? customEmojiId : undefined,
        count,
        ...(typeof chosenOrder === 'number' ? { chosenOrder } : {}),
      });
      continue;
    }

    normalized.push({
      type: 'unknown',
      count,
      rawType: className || 'unknown',
      ...(typeof chosenOrder === 'number' ? { chosenOrder } : {}),
    });
  }

  if (normalized.length === 0) {
    if (options.includeEmpty) {
      return [];
    }
    return undefined;
  }

  normalized.sort((left, right) => {
    const leftOrder = typeof left.chosenOrder === 'number' ? left.chosenOrder : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.chosenOrder === 'number' ? right.chosenOrder : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return right.count - left.count;
  });

  return normalized;
}

function extractLiveReactions(message: Api.Message): MessageReaction[] | undefined {
  return normalizeTelegramReactions((message as any).reactions);
}

function cloneForMutation<T>(value: T): T {
  return JSON.parse(safeStringify(value));
}

function normalizeStoredReactionState(reactions: MessageReaction[] | undefined): string {
  const normalized = (Array.isArray(reactions) ? reactions : [])
    .map((reaction) => ({
      type: reaction.type,
      emoji: reaction.emoji || '',
      customEmojiId: reaction.customEmojiId || '',
      count: reaction.count,
      chosenOrder: typeof reaction.chosenOrder === 'number' ? reaction.chosenOrder : -1,
      rawType: reaction.rawType || '',
    }))
    .sort((left, right) => {
      const leftKey = `${left.type}|${left.emoji}|${left.customEmojiId}|${left.rawType}|${left.chosenOrder}`;
      const rightKey = `${right.type}|${right.emoji}|${right.customEmojiId}|${right.rawType}|${right.chosenOrder}`;
      return leftKey.localeCompare(rightKey);
    });

  return JSON.stringify(normalized);
}

function summarizeChangedMessageFields(changes: Record<string, { old: unknown; new: unknown }>): string[] {
  const labels = new Set<string>();

  for (const path of Object.keys(changes)) {
    if (path === 'deleted' || path.startsWith('deleted.')) {
      labels.add('deletion');
      continue;
    }
    if (path === 'reactions' || path.startsWith('reactions.')) {
      labels.add('reactions');
      continue;
    }
    if (path === 'edited' || path.startsWith('edited.')) {
      labels.add('edit marker');
      continue;
    }
    if (path === 'forwarded' || path.startsWith('forwarded.')) {
      labels.add('forwarded info');
      continue;
    }
    if (path === 'replyTo' || path.startsWith('replyTo.')) {
      labels.add('reply');
      continue;
    }
    if (path === 'sender' || path.startsWith('sender.')) {
      labels.add('sender');
      continue;
    }
    if (path === 'chatName' || path === 'chatType') {
      labels.add('chat context');
      continue;
    }
    if (path === 'type' || path === 'service' || path.startsWith('service.') || path.startsWith('content.service')) {
      labels.add('service');
      continue;
    }
    if (path === 'content.text' || path.startsWith('content.text.') || path === 'content.entities' || path.startsWith('content.entities.')) {
      labels.add('text');
      continue;
    }
    if (path === 'content.media' || path.startsWith('content.media.')) {
      labels.add('media');
      continue;
    }
    if (path === 'content.location' || path.startsWith('content.location.')) {
      labels.add('location');
      continue;
    }
    if (path === 'content.type') {
      labels.add('content type');
      continue;
    }

    labels.add(path.split('.')[0] || 'message');
  }

  return Array.from(labels);
}

function describeMessageMutation(eventType: MessageMutationEventType, changedFields: string[]): string {
  switch (eventType) {
    case 'created':
      return 'Message archived';
    case 'baseline':
      return 'Baseline snapshot seeded';
    case 'edited':
      return changedFields.length > 0 ? `Message edited: ${changedFields.join(', ')}` : 'Message edited';
    case 'reactions_updated':
      return 'Reactions updated';
    case 'deleted':
      return 'Message deleted';
    case 'sync_updated':
    default:
      return changedFields.length > 0 ? `Snapshot updated: ${changedFields.join(', ')}` : 'Snapshot updated';
  }
}

function normalizeMessageSnapshotForHistory(snapshot: any): Record<string, unknown> | null {
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }

  const cloned = prepareFoMongoDB(snapshot);
  delete cloned._id;
  return cloned;
}

function buildMessageHistoryChanges(existingDoc: any, nextDoc: any, eventType: MessageMutationEventType) {
  if (!existingDoc && nextDoc) {
    return {
      created: {
        old: null,
        new: true,
      },
    };
  }

  if (existingDoc && !nextDoc) {
    return {
      deleted: {
        old: false,
        new: true,
      },
    };
  }

  const changes = findChanges(existingDoc || {}, nextDoc || {});
  if (eventType === 'deleted' && Object.keys(changes).length === 0) {
    return {
      deleted: {
        old: false,
        new: true,
      },
    };
  }

  return changes;
}

async function appendMessageHistoryEntry({
  existingDoc,
  nextDoc,
  eventType,
  observedAt,
  source,
  version,
}: {
  existingDoc?: any;
  nextDoc?: any;
  eventType: MessageMutationEventType;
  observedAt: Date;
  source: 'backup' | 'live';
  version: number;
}) {
  const historyCollection = await getMessageHistoryCollection();
  const changes = buildMessageHistoryChanges(existingDoc, nextDoc, eventType);
  const changedFields = summarizeChangedMessageFields(changes);
  const referenceDoc = nextDoc || existingDoc;

  if (!referenceDoc?.tgChatId || typeof referenceDoc?.tgMessageId !== 'number') {
    console.warn('Skipping message history append because message identifiers are missing.');
    return;
  }

  await historyCollection.insertOne(prepareFoMongoDB({
    tgChatId: referenceDoc.tgChatId,
    tgMessageId: referenceDoc.tgMessageId,
    version,
    eventType,
    observedAt,
    source,
    changedFields,
    summary: describeMessageMutation(eventType, changedFields),
    changes,
    before: normalizeMessageSnapshotForHistory(existingDoc),
    after: normalizeMessageSnapshotForHistory(nextDoc),
  }));
}

function getCurrentMessageVersion(message: any): number {
  const version = message?.metadata?.currentVersion;
  return typeof version === 'number' && Number.isFinite(version) && version > 0 ? version : 0;
}

function applyMessageVersionMetadata(nextDoc: MessageDocument, existingDoc: any, version: number, observedAt: Date): MessageDocument {
  return {
    ...nextDoc,
    metadata: {
      ...nextDoc.metadata,
      importedAt: existingDoc?.metadata?.importedAt || nextDoc.metadata.importedAt || observedAt,
      firstSeenAt: existingDoc?.metadata?.firstSeenAt || existingDoc?.metadata?.importedAt || nextDoc.metadata.firstSeenAt || nextDoc.metadata.importedAt || observedAt,
      lastMutationAt: observedAt,
      currentVersion: version,
    },
  };
}

async function seedMessageHistoryBaseline(existingDoc: any, observedAt: Date) {
  if (!existingDoc || getCurrentMessageVersion(existingDoc) > 0) {
    return existingDoc;
  }

  const baselineVersion = 1;
  const baselineDoc = {
    ...cloneForMutation(existingDoc),
    metadata: {
      ...(cloneForMutation(existingDoc.metadata || {})),
      firstSeenAt: existingDoc?.metadata?.firstSeenAt || existingDoc?.metadata?.importedAt || existingDoc?.metadata?.originalDate || observedAt,
      lastMutationAt: existingDoc?.metadata?.lastMutationAt || existingDoc?.metadata?.importedAt || observedAt,
      currentVersion: baselineVersion,
    },
  };

  await appendMessageHistoryEntry({
    existingDoc: undefined,
    nextDoc: baselineDoc,
    eventType: 'baseline',
    observedAt: baselineDoc.metadata.lastMutationAt || observedAt,
    source: baselineDoc?.metadata?.source === 'backup' ? 'backup' : 'live',
    version: baselineVersion,
  });

  const db = await getMongoDbClient();
  const messagesCollection = db.collection<MessageDocument>('messages');
  await messagesCollection.updateOne(
    {
      tgChatId: existingDoc.tgChatId,
      tgMessageId: existingDoc.tgMessageId,
    },
    {
      $set: {
        'metadata.firstSeenAt': baselineDoc.metadata.firstSeenAt,
        'metadata.lastMutationAt': baselineDoc.metadata.lastMutationAt,
        'metadata.currentVersion': baselineVersion,
      },
    },
  );

  return baselineDoc;
}

async function refetchAndHandleLiveMessage(chatId: string, messageId: number) {
  const client = await getTelegramClient();
  const fetchedMessages = await client.getMessages(BigInt(chatId), { ids: messageId });
  const fetchedMessage = fetchedMessages[0] as Api.Message | undefined;

  if (!fetchedMessage || typeof fetchedMessage.id !== 'number') {
    console.warn(`Unable to refetch message ${messageId} from chat ${chatId} after reaction update.`);
    return;
  }

  await handleMessage(fetchedMessage, { eventType: 'sync_updated' });
}

async function updateStoredMessageReactions(chatId: string, messageId: number, reactions: MessageReaction[]) {
  const db = await getMongoDbClient();
  const messagesCollection = db.collection<MessageDocument>('messages');
  const filter = {
    tgChatId: BigInt(chatId),
    tgMessageId: messageId,
  };

  const existingDoc = await messagesCollection.findOne(filter);

  if (!existingDoc) {
    await refetchAndHandleLiveMessage(chatId, messageId);
    return;
  }

  const baselineDoc = await seedMessageHistoryBaseline(existingDoc, new Date());

  const nextReactions = reactions.length > 0 ? reactions : undefined;
  if (normalizeStoredReactionState(baselineDoc.reactions) === normalizeStoredReactionState(nextReactions)) {
    return;
  }

  const observedAt = new Date();
  const nextDoc = cloneForMutation(baselineDoc);
  if (nextReactions) {
    nextDoc.reactions = nextReactions;
  } else {
    delete nextDoc.reactions;
  }

  const version = getCurrentMessageVersion(baselineDoc) + 1;
  await appendMessageHistoryEntry({
    existingDoc: baselineDoc,
    nextDoc: {
      ...nextDoc,
      metadata: {
        ...(nextDoc.metadata || {}),
        currentVersion: version,
        lastMutationAt: observedAt,
      },
    },
    eventType: 'reactions_updated',
    observedAt,
    source: 'live',
    version,
  });

  const set: Record<string, unknown> = {
    'metadata.currentVersion': version,
    'metadata.lastMutationAt': observedAt,
  };
  const unset: Record<string, ''> = {};
  if (nextReactions) {
    set.reactions = nextReactions;
  } else {
    unset.reactions = '';
  }

  await messagesCollection.updateOne(
    filter,
    {
      ...(Object.keys(set).length > 0 ? { $set: set } : {}),
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    },
  );

  console.log(`Updated reactions for message ${messageId} from chat ${chatId}`);
}

function buildDeletedMessagePlaceholder(chatId: string, messageId: number, observedAt: Date, note: string): MessageDocument {
  return {
    tgMessageId: messageId,
    tgChatId: BigInt(chatId),
    chatName: 'Unknown',
    chatType: 'unknown',
    sender: {
      name: 'Unknown',
      id: 'unknown',
    },
    type: 'message',
    content: {
      type: 'text',
      text: note,
    },
    deleted: {
      at: observedAt,
      source: 'live',
      note,
    },
    metadata: {
      importedAt: observedAt,
      originalDate: observedAt,
      originalUnixtime: Math.floor(observedAt.getTime() / 1000),
      source: 'live',
      firstSeenAt: observedAt,
      lastMutationAt: observedAt,
      currentVersion: 1,
    },
  };
}

async function markMessagesDeleted(messageIds: number[], options: { chatId?: string } = {}) {
  const normalizedMessageIds = Array.isArray(messageIds)
    ? messageIds.filter((messageId): messageId is number => typeof messageId === 'number' && Number.isFinite(messageId))
    : [];
  if (normalizedMessageIds.length === 0) {
    return;
  }

  const db = await getMongoDbClient();
  const messagesCollection = db.collection<MessageDocument>('messages');
  const observedAt = new Date();
  const filter = options.chatId
    ? { tgChatId: BigInt(options.chatId), tgMessageId: { $in: normalizedMessageIds } }
    : { tgMessageId: { $in: normalizedMessageIds }, 'metadata.source': 'live' };
  const existingDocs = await messagesCollection.find(filter).toArray();
  const existingMap = new Map(existingDocs.map((doc: any) => [`${String(doc.tgChatId)}:${doc.tgMessageId}`, doc]));

  for (const messageId of normalizedMessageIds) {
    const matchingDocs = options.chatId
      ? [existingMap.get(`${options.chatId}:${messageId}`)].filter(Boolean)
      : existingDocs.filter((doc: any) => doc.tgMessageId === messageId);

    if (matchingDocs.length === 0) {
      if (!options.chatId) {
        console.warn(`Delete update for message ${messageId} could not be matched to an archived chat.`);
        continue;
      }

      const placeholder = buildDeletedMessagePlaceholder(
        options.chatId,
        messageId,
        observedAt,
        'Message deleted before it could be archived.',
      );
      await appendMessageHistoryEntry({
        existingDoc: undefined,
        nextDoc: placeholder,
        eventType: 'deleted',
        observedAt,
        source: 'live',
        version: 1,
      });
      await messagesCollection.replaceOne(
        {
          tgChatId: placeholder.tgChatId,
          tgMessageId: placeholder.tgMessageId,
        },
        placeholder,
        { upsert: true },
      );
      continue;
    }

    for (const existingDoc of matchingDocs) {
      const baselineDoc = await seedMessageHistoryBaseline(existingDoc, observedAt);
      const alreadyDeleted = Boolean(baselineDoc?.deleted?.at);
      const nextDoc = {
        ...cloneForMutation(baselineDoc),
        deleted: {
          at: observedAt,
          source: 'live' as const,
        },
        metadata: {
          ...(cloneForMutation(baselineDoc?.metadata || {})),
          lastMutationAt: observedAt,
          currentVersion: getCurrentMessageVersion(baselineDoc) + 1,
        },
      };

      if (alreadyDeleted) {
        continue;
      }

      const version = nextDoc.metadata.currentVersion || 1;
      await appendMessageHistoryEntry({
        existingDoc: baselineDoc,
        nextDoc,
        eventType: 'deleted',
        observedAt,
        source: 'live',
        version,
      });

      await messagesCollection.updateOne(
        {
          tgChatId: existingDoc.tgChatId,
          tgMessageId: existingDoc.tgMessageId,
        },
        {
          $set: {
            deleted: {
              at: observedAt,
              source: 'live',
            },
            'metadata.currentVersion': version,
            'metadata.lastMutationAt': observedAt,
          },
        },
      );
    }
  }
}

type LiveMessageContext = {
  tgChatId: string;
  chatName?: string;
  chatType?: string;
  senderName?: string;
  senderId?: string;
};

async function resolveLiveMessageContext(message: Api.Message): Promise<LiveMessageContext> {
  const peerId = extractPeerIdentifier((message as any).peerId);
  const fromId = extractPeerIdentifier((message as any).fromId);
  const tgChatId = message.chatId?.toString() || peerId || '0';

  let chatEntity = (message as any).chat;
  if (!chatEntity && typeof (message as any).getChat === 'function') {
    try {
      chatEntity = await (message as any).getChat();
    } catch {
      // no-op
    }
  }

  let senderEntity = (message as any).sender;
  if (!senderEntity && typeof (message as any).getSender === 'function') {
    try {
      senderEntity = await (message as any).getSender();
    } catch {
      // no-op
    }
  }

  const dialogContext = tgChatId !== '0' ? await getDialogContextSnapshot(tgChatId) : undefined;

  let chatName = resolveDisplayName(chatEntity) || dialogContext?.chatName;
  let chatType = typeof chatEntity?.className === 'string' ? chatEntity.className : dialogContext?.chatType;
  let senderName = resolveDisplayName(senderEntity);
  let senderId = senderEntity?.id?.toString?.() || fromId;

  if (!senderId && !message.out) {
    senderId = peerId;
  }
  if (!senderId && message.out) {
    senderId = 'self';
  }

  if (!senderName && !message.out && peerId && senderId === peerId) {
    senderName = chatName || dialogContext?.defaultSenderName;
  }
  if (!senderName && message.out) {
    senderName = 'You';
  }
  if (!senderName) {
    senderName = dialogContext?.defaultSenderName;
  }

  if (!chatName && !message.out && senderName && senderName !== 'You') {
    chatName = senderName;
  }
  if (!chatType) {
    chatType = dialogContext?.chatType;
  }

  return {
    tgChatId,
    chatName,
    chatType,
    senderName,
    senderId,
  };
}

type TransformTelegramMessageOptions = {
  includeMedia?: boolean;
};

async function transformTelegramMessage(
  message: Api.Message,
  options: TransformTelegramMessageOptions = {},
): Promise<MessageDocument> {
  const includeMedia = options.includeMedia !== false;
  const context = await resolveLiveMessageContext(message);
  const media = includeMedia && message.media ? await processMessageMedia(message.media) : undefined;
  const location = message.media ? extractLiveLocation(message.media) : undefined;
  const parsedEntities = parseLiveTextEntities(message);
  const replyToMessageId = extractLiveReplyToMessageId(message);
  const forwardedFrom = extractLiveForwardedFrom(message);
  const edited = extractLiveEditedInfo(message);
  const reactions = extractLiveReactions(message);
  const service = extractLiveServiceInfo(message, context, replyToMessageId);
  const type: MessageDocument['type'] = service ? 'service' : 'message';
  let liveText = parsedEntities.textParts && parsedEntities.textParts.length > 0
    ? parsedEntities.textParts
    : message.message;

  if (
    type === 'message'
    && !hasMeaningfulText(liveText)
    && !media
    && !location
  ) {
    liveText = buildFallbackLiveText(message, includeMedia);
  }

  return createMessageDocument({
    type,
    tgMessageId: message.id,
    tgChatId: context.tgChatId,
    chatName: context.chatName,
    chatType: context.chatType,
    senderName: context.senderName,
    senderId: context.senderId,
    text: liveText,
    entities: parsedEntities.entities,
    reactions,
    media,
    location,
    service,
    replyToMessageId,
    forwardedFrom,
    edited,
    originalDate: new Date(message.date * 1000),
    originalUnixtime: message.date,
    source: 'live',
  });
}

function extractLiveLocation(media: Api.TypeMessageMedia): LocationInfo | undefined {
  if (media.className === 'MessageMediaGeo' || media.className === 'MessageMediaGeoLive' || media.className === 'MessageMediaVenue') {
    const geo = (media as any).geo;
    if (geo && typeof geo.lat === 'number' && typeof geo.long === 'number') {
      return {
        latitude: geo.lat,
        longitude: geo.long,
      };
    }
  }

  return undefined;
}

async function processMessageMedia(media: Api.TypeMessageMedia): Promise<MediaInfo | undefined> {
  if (!media) return undefined;
  
  async function downloadAndUpload(mediaItem: any, fileNameHint?: string): Promise<string | undefined> {
      try {
          const client = await getTelegramClient();
          const buffer = await client.downloadMedia(mediaItem);
          if (!buffer) return undefined;

          const extensionMatch = fileNameHint?.match(/\.([a-zA-Z0-9]{1,10})$/);
          const extensionSuffix = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : '';
          const tempFilePath = join(tmpdir(), `${Date.now()}-${Math.random().toString(36).substring(7)}${extensionSuffix}`);
          await writeFile(tempFilePath, buffer);
          const s3Key = await uploadFile(tempFilePath);
          await unlink(tempFilePath);
          
          return s3Key || undefined;
      } catch (error) {
          console.error('Error downloading/uploading media:', error);
          return undefined;
      }
  }

  try {
      switch (media.className) {
          case 'MessageMediaEmpty':
              return undefined;

          case 'MessageMediaPhoto': {
              if (!media.photo) return undefined;
              const s3Key = await downloadAndUpload(media, 'photo.jpg');
              if (!s3Key) return undefined;

              return {
                  type: 'photo',
                  file: s3Key,
                  width: media.photo.sizes?.[0]?.w,
                  height: media.photo.sizes?.[0]?.h,
              };
          }

          case 'MessageMediaDocument': {
              if (!media.document) return undefined;
              const doc = media.document;
              const fileName = doc.attributes?.find((attr: any) => attr.className === 'DocumentAttributeFilename')?.fileName;
              const s3Key = await downloadAndUpload(media, fileName);
              if (!s3Key) return undefined;
              const mimeType = doc.mimeType;
              const extension = fileName?.split('.').pop()?.toLowerCase();

              // Determine type based on media flags and attributes
              let type: MediaInfo['type'] = 'document';
              if (media.voice) {
                  type = 'voice';
              } else if (media.video) {
                  type = 'video';
              } else if (media.round) {
                  type = 'video_file';
              } else if (doc.attributes?.some((attr: any) => attr.className === 'DocumentAttributeAnimated')) {
                  type = 'animation';
              } else if (doc.attributes?.some((attr: any) => attr.className === 'DocumentAttributeSticker')) {
                  type = 'sticker';
              } else if (mimeType === 'application/x-tgsticker') {
                  type = 'sticker';
              }

              const baseInfo: MediaInfo = {
                  type,
                  file: s3Key,
                  mimeType,
                  fileName,
                  extension,
                  fileSize: Number(doc.size),
              };

              // Add type-specific attributes
              const videoAttr = doc.attributes?.find((attr: any) => attr.className === 'DocumentAttributeVideo');
              const audioAttr = doc.attributes?.find((attr: any) => attr.className === 'DocumentAttributeAudio');
              const stickerAttr = doc.attributes?.find((attr: any) => attr.className === 'DocumentAttributeSticker');

              if (videoAttr) {
                  baseInfo.width = videoAttr.w;
                  baseInfo.height = videoAttr.h;
                  baseInfo.duration = videoAttr.duration;
              }

              if (audioAttr) {
                  baseInfo.duration = audioAttr.duration;
              }

              if (stickerAttr) {
                  baseInfo.emoji = stickerAttr.alt;
              }

              // Handle thumbnail
              if (doc.thumbs?.length) {
                  const client = await getTelegramClient();
                  const thumbBuffer = await client.downloadMedia(doc.thumbs[0]);
                  if (thumbBuffer && thumbBuffer.length > 0) {
                      const tempThumbPath = join(tmpdir(), `thumb-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`);
                      await writeFile(tempThumbPath, thumbBuffer);
                      baseInfo.thumbnail = await uploadFile(tempThumbPath);
                      await unlink(tempThumbPath);
                  }
              }

              return baseInfo;
          }

          case 'MessageMediaWebPage': {
              const webpage = media.webpage;
              if (!webpage) return undefined;

              // Handle webpage with photo
              if (webpage.photo) {
                  const s3Key = await downloadAndUpload(webpage.photo, 'webpage-photo.jpg');
                  return s3Key ? {
                      type: 'photo',
                      file: s3Key,
                      width: webpage.photo.sizes?.[0]?.w,
                      height: webpage.photo.sizes?.[0]?.h,
                      url: webpage.url,
                  } : undefined;
              }

              // Handle webpage with document
              if (webpage.document) {
                  const webpageFileName = webpage.document.attributes?.find(
                      (attr: any) => attr.className === 'DocumentAttributeFilename'
                  )?.fileName;
                  const s3Key = await downloadAndUpload(webpage.document, webpageFileName);
                  return s3Key ? {
                      type: 'document',
                      file: s3Key,
                      mimeType: webpage.document.mimeType,
                      fileName: webpageFileName || 'webpage',
                      url: webpage.url,
                  } : undefined;
              }

              return undefined;
          }

          case 'MessageMediaGeo':
          case 'MessageMediaGeoLive': {
              return undefined;
          }

          case 'MessageMediaVenue': {
              return undefined;
          }

          case 'MessageMediaContact': {
              return {
                  type: 'document',
                  mimeType: 'application/vcard',
                  fileName: `${media.firstName}_${media.lastName}.vcf`,
                  fileSize: 0,
                  extension: 'vcf',
              };
          }

          case 'MessageMediaPoll': {
              return {
                  type: 'document',
                  mimeType: 'application/json',
                  fileName: 'poll.json',
                  fileSize: 0,
                  extension: 'json',
              };
          }

          case 'MessageMediaDice': {
              return {
                  type: 'document',
                  mimeType: 'application/json',
                  fileName: 'dice.json',
                  fileSize: 0,
                  extension: 'json',
              };
          }

          default:
              console.log(`Unhandled media type: ${media.className}`);
              return undefined;
      }
  } catch (error) {
      console.error('Error processing media:', error);
      return undefined;
  }
}

type HandleMessageOptions = {
  eventType?: MessageMutationEventType;
  existingDoc?: any;
};

async function persistMessageSnapshot(
  messagesCollection: any,
  messageDoc: MessageDocument,
  existingDoc: any,
  requestedEventType?: MessageMutationEventType,
): Promise<boolean> {
  const observedAt = new Date();
  const baselineDoc = await seedMessageHistoryBaseline(existingDoc, observedAt);
  const eventType: MessageMutationEventType = !baselineDoc
    ? 'created'
    : (requestedEventType || (messageDoc.edited ? 'edited' : 'sync_updated'));
  const version = baselineDoc ? getCurrentMessageVersion(baselineDoc) + 1 : 1;
  const nextDoc = applyMessageVersionMetadata(messageDoc, baselineDoc, version, observedAt);
  const changes = buildMessageHistoryChanges(baselineDoc, nextDoc, eventType);

  if (baselineDoc && Object.keys(changes).length === 0) {
    return false;
  }

  await appendMessageHistoryEntry({
    existingDoc: baselineDoc,
    nextDoc,
    eventType,
    observedAt,
    source: nextDoc.metadata.source,
    version,
  });

  await messagesCollection.replaceOne(
    {
      tgMessageId: nextDoc.tgMessageId,
      tgChatId: nextDoc.tgChatId,
    },
    existingDoc?._id ? { ...nextDoc, _id: existingDoc._id } : nextDoc,
    { upsert: true },
  );

  return true;
}

async function handleMessage(message: Api.Message, options: HandleMessageOptions = {}) {
  try {
    const db = await getMongoDbClient();
    const messagesCollection = db.collection("messages");

    const messageDoc = await transformTelegramMessage(message);
    const filter = {
      tgMessageId: messageDoc.tgMessageId,
      tgChatId: messageDoc.tgChatId,
    };

    const existingDoc = options.existingDoc || await messagesCollection.findOne(filter);

    if (!existingDoc) {
      await persistMessageSnapshot(messagesCollection, messageDoc, undefined, options.eventType || 'created');
      console.log(`Saved message ${messageDoc.tgMessageId} from chat ${messageDoc.tgChatId}`);
      return true;
    }

    const changed = await persistMessageSnapshot(messagesCollection, messageDoc, existingDoc, options.eventType);
    if (!changed) {
      return false;
    }

    console.log(`Enriched message ${messageDoc.tgMessageId} from chat ${messageDoc.tgChatId}`);
    return true;

  } catch (error) {
    console.error('Error handling message:', error);
    throw error;
  }
}

// Modified main execution
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error in main:', error);
    process.exit(1);
  });
}
