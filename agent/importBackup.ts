import 'dotenv/config';

import { readFile, readdir, access } from 'fs/promises';
import { join, dirname } from 'path';
import { MongoClient, Db } from 'mongodb';
import { uploadFile } from './s3';
import { BackupMessage, BackupReaction, MessageDocument, MessageReaction, MediaInfo, DialogDocument, TelegramDialogId, MessageHistoryDocument } from './types';
import { createMessageDocument } from './messagePipeline';

interface BackupChat {
  name: string;
  type: string;
  id: number;
  messages: BackupMessage[];
}

interface ImportBackupOptions {
  dropMessagesCollectionBeforeImport?: boolean;
  onProgress?: (progress: ImportChatProgress) => void | Promise<void>;
}

interface ImportBackupsFromRootOptions {
  whitelistedChatIds?: Set<string>;
  onChatStart?: (payload: ImportChatLifecyclePayload) => void | Promise<void>;
  onChatProgress?: (payload: ImportChatProgressPayload) => void | Promise<void>;
  onChatDone?: (payload: ImportChatDonePayload) => void | Promise<void>;
  onSummary?: (summary: ImportBackupsSummary) => void | Promise<void>;
}

interface ImportChatLifecyclePayload {
  chatId: number;
  chatName: string;
  chatIndex: number;
  totalChats: number;
  sourcePath: string;
}

interface ImportChatProgress {
  processedMessages: number;
  totalMessages: number;
  importedMessages: number;
  skippedExistingMessages: number;
}

interface ImportChatProgressPayload extends ImportChatLifecyclePayload {
  progress: ImportChatProgress;
}

interface ImportChatDonePayload extends ImportChatLifecyclePayload {
  result: ImportBackupResult;
}

export interface ImportBackupResult {
  chatName: string;
  chatId: number;
  sourceDir: string;
  scannedMessages: number;
  importedMessages: number;
  skippedExistingMessages: number;
}

export interface ImportBackupsSummary {
  scannedChats: number;
  importedChats: number;
  skippedNonWhitelistedChats: number;
  scannedMessages: number;
  importedMessages: number;
  skippedExistingMessages: number;
  results: ImportBackupResult[];
}

let mongoClient: MongoClient | undefined;
let mongoDb: Db | undefined;

async function getMongoDbClient(): Promise<Db> {
  if (mongoDb) {
    return mongoDb;
  }

  mongoClient = new MongoClient(process.env.MONGO_URI || '');
  await mongoClient.connect();
  mongoDb = mongoClient.db('tgArchive');
  return mongoDb;
}

export async function closeMongoDbClient(): Promise<void> {
  if (!mongoClient) {
    return;
  }

  await mongoClient.close();
  mongoClient = undefined;
  mongoDb = undefined;
}

function toTelegramDialogId(id: string | number): TelegramDialogId {
  return String(id) as TelegramDialogId;
}

function getSourceFromPath(path: string): string {
  const match = path.match(/([^/]+)$/);
  return match ? match[1] : 'unknown';
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, current) =>
    typeof current === 'bigint' ? current.toString() : current,
  );
}

function prepareForMongoDb<T>(value: T): T {
  return JSON.parse(safeStringify(value));
}

function createImportedMessageBaseline(message: MessageDocument): MessageDocument {
  const importedAt = message.metadata.importedAt || new Date();
  return {
    ...message,
    metadata: {
      ...message.metadata,
      importedAt,
      firstSeenAt: importedAt,
      lastMutationAt: importedAt,
      currentVersion: 1,
    },
  };
}

function createBaselineHistoryEntry(message: MessageDocument): MessageHistoryDocument {
  const observedAt = message.metadata.lastMutationAt || message.metadata.importedAt || message.metadata.originalDate || new Date();
  return {
    tgMessageId: message.tgMessageId,
    tgChatId: message.tgChatId,
    version: 1,
    eventType: 'baseline',
    observedAt,
    source: message.metadata.source,
    changedFields: [],
    summary: 'Baseline snapshot seeded from Telegram export',
    changes: {},
    before: null,
    after: prepareForMongoDb(message),
  };
}

function parseReactionCount(value: unknown): number | undefined {
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

function parseBackupReactions(input: BackupReaction[] | undefined): MessageReaction[] | undefined {
  if (!Array.isArray(input) || input.length === 0) {
    return undefined;
  }

  const normalized: MessageReaction[] = [];

  for (const reactionEntry of input) {
    const nestedReaction = (reactionEntry as any)?.reaction;
    const count = parseReactionCount(
      reactionEntry?.count
      ?? (reactionEntry as any)?.total
      ?? (nestedReaction as any)?.count,
    );

    if (!count || count <= 0) {
      continue;
    }

    const rawType = (
      reactionEntry?.type
      ?? (nestedReaction && typeof nestedReaction === 'object' ? (nestedReaction as any).type : undefined)
    );

    const emoji = (
      reactionEntry?.emoji
      ?? reactionEntry?.emoticon
      ?? (typeof nestedReaction === 'string' ? nestedReaction : undefined)
      ?? (nestedReaction && typeof nestedReaction === 'object' ? (nestedReaction as any).emoji : undefined)
      ?? (nestedReaction && typeof nestedReaction === 'object' ? (nestedReaction as any).emoticon : undefined)
    );

    const customEmojiId = (
      reactionEntry?.custom_emoji_id
      ?? reactionEntry?.document_id
      ?? reactionEntry?.documentId
      ?? (nestedReaction && typeof nestedReaction === 'object' ? (nestedReaction as any).custom_emoji_id : undefined)
      ?? (nestedReaction && typeof nestedReaction === 'object' ? (nestedReaction as any).document_id : undefined)
      ?? (nestedReaction && typeof nestedReaction === 'object' ? (nestedReaction as any).documentId : undefined)
    );

    const chosenOrder = parseReactionCount(reactionEntry?.chosen_order ?? reactionEntry?.chosenOrder);

    if (typeof emoji === 'string' && emoji.trim().length > 0) {
      normalized.push({
        type: 'emoji',
        emoji,
        count,
        ...(typeof chosenOrder === 'number' ? { chosenOrder } : {}),
      });
      continue;
    }

    if (customEmojiId !== undefined && customEmojiId !== null && String(customEmojiId).trim().length > 0) {
      normalized.push({
        type: 'custom_emoji',
        customEmojiId: String(customEmojiId),
        count,
        ...(typeof chosenOrder === 'number' ? { chosenOrder } : {}),
      });
      continue;
    }

    normalized.push({
      type: 'unknown',
      count,
      rawType: typeof rawType === 'string' && rawType.trim().length > 0 ? rawType : 'unknown',
      ...(typeof chosenOrder === 'number' ? { chosenOrder } : {}),
    });
  }

  if (normalized.length === 0) {
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

async function processMessageMedia(msg: BackupMessage, backupDir: string): Promise<MediaInfo | undefined> {
  if (!msg.file && !msg.photo) return undefined;

  async function uploadAndGetKey(filePath: string): Promise<string | null> {
    const fullPath = join(backupDir, filePath);
    return await uploadFile(fullPath);
  }

  if (msg.photo) {
    const s3Key = await uploadAndGetKey(msg.photo);
    if (!s3Key) return undefined;

    return {
      type: 'photo',
      file: s3Key,
      width: msg.width,
      height: msg.height,
    };
  }

  if (msg.file) {
    const s3Key = await uploadAndGetKey(msg.file);
    if (!s3Key) return undefined;

    const fileName = msg.file.split('/').pop() || '';
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const thumbnailKey = msg.thumbnail ? await uploadAndGetKey(msg.thumbnail) : undefined;

    const baseMedia: MediaInfo = {
      type: (msg.media_type as MediaInfo['type']) || 'document',
      file: s3Key,
      thumbnail: thumbnailKey || undefined,
      width: msg.width,
      height: msg.height,
      mimeType: msg.mime_type,
      fileName,
      extension,
    };

    switch (baseMedia.type) {
      case 'sticker':
        return {
          ...baseMedia,
          emoji: msg.sticker_emoji,
        };
      case 'animation':
      case 'video':
      case 'video_file':
      case 'voice':
      case 'audio':
        return {
          ...baseMedia,
          duration: msg.duration_seconds,
        };
      case 'document':
      default:
        return baseMedia;
    }
  }

  return undefined;
}

async function transformBackupMessage(
  msg: BackupMessage,
  chatInfo: BackupChat,
  sourceDir: string,
  backupDir: string,
): Promise<MessageDocument> {
  const media = await processMessageMedia(msg, backupDir);
  const reactions = parseBackupReactions(msg.reactions);
  const service = msg.type === 'service'
    ? {
        type: msg.action || 'service',
        actor: {
          name: msg.actor || 'Unknown',
          id: msg.actor_id || 'unknown',
        },
        details: {
          discardReason: msg.discard_reason,
          duration: msg.duration_seconds,
          pinnedMessageId: msg.message_id,
        },
      }
    : undefined;

  return createMessageDocument({
    type: msg.type,
    tgMessageId: msg.id,
    tgChatId: chatInfo.id,
    chatName: chatInfo.name,
    chatType: chatInfo.type,
    senderName: msg.from || msg.actor || 'Unknown',
    senderId: msg.from_id || msg.actor_id || 'unknown',
    text: msg.text,
    entities: msg.text_entities,
    reactions,
    media,
    location: msg.location_information
      ? {
          latitude: msg.location_information.latitude,
          longitude: msg.location_information.longitude,
        }
      : undefined,
    service,
    replyToMessageId: msg.reply_to_message_id,
    forwardedFrom: msg.forwarded_from,
    edited: msg.edited
      ? {
          date: new Date(msg.edited),
          unixtime: parseInt(msg.edited_unixtime || '0', 10),
        }
      : undefined,
    originalDate: new Date(msg.date),
    originalUnixtime: parseInt(msg.date_unixtime, 10),
    source: 'backup',
    sourceDir,
  });
}

async function upsertDialogBootstrap(
  db: Db,
  backupData: BackupChat,
  sourceDir: string,
  stats: { scannedMessages: number; importedMessages: number; skippedExistingMessages: number },
) {
  const dialogsCollection = db.collection<DialogDocument>('dialogs');
  const now = new Date();
  const tgDialogId = toTelegramDialogId(backupData.id);

  await dialogsCollection.updateOne(
    { tgDialogId },
    {
      $setOnInsert: {
        tgDialogId,
        title: backupData.name,
        firstName: backupData.type === 'personal_chat' ? backupData.name : undefined,
        isUser: backupData.type === 'personal_chat',
        isGroup: backupData.type === 'group',
        isChannel: backupData.type === 'channel',
      } as any,
      $set: {
        chatType: backupData.type,
        bootstrap: {
          completedAt: now,
          lastScannedAt: now,
          sourcePath: sourceDir,
          scannedMessageCount: stats.scannedMessages,
          importedMessageCount: stats.importedMessages,
          skippedExistingMessageCount: stats.skippedExistingMessages,
          importedFrom: 'telegram-export',
        },
      } as any,
    },
    { upsert: true },
  );
}

export async function importBackupFile(filePath: string, options: ImportBackupOptions = {}): Promise<ImportBackupResult> {
  const db = await getMongoDbClient();
  const sourceDir = getSourceFromPath(dirname(filePath));
  const fileContent = await readFile(filePath, 'utf-8');
  const backupData: BackupChat = JSON.parse(fileContent);
  const messagesCollection = db.collection<MessageDocument>('messages');
  const messageHistoryCollection = db.collection<MessageHistoryDocument>('messageHistory');
  const tgChatId = BigInt(backupData.id);

  if (options.dropMessagesCollectionBeforeImport) {
    console.log('Dropping messages collection before import...');
    try {
      await messagesCollection.drop();
      console.log('Messages collection dropped successfully.');
    } catch (error: any) {
      if (error.code !== 26) {
        throw error;
      }
      console.log('Messages collection did not exist, proceeding with import.');
    }

    try {
      await messageHistoryCollection.drop();
      console.log('Message history collection dropped successfully.');
    } catch (error: any) {
      if (error.code !== 26) {
        throw error;
      }
      console.log('Message history collection did not exist, proceeding with import.');
    }
  }

  await messagesCollection.createIndex({ tgMessageId: 1, tgChatId: 1 }, { unique: true });
  await messagesCollection.createIndex({ 'metadata.originalDate': 1 });
  await messagesCollection.createIndex({ tgChatId: 1 });
  await messageHistoryCollection.createIndex({ tgChatId: 1, tgMessageId: 1, version: 1 }, { unique: true });
  await messageHistoryCollection.createIndex({ tgChatId: 1, observedAt: 1, version: 1 });

  const existingMessages = await messagesCollection.find(
    { tgChatId },
    { projection: { tgMessageId: 1 } },
  ).toArray();
  const existingMessageIds = new Set(existingMessages.map((doc: any) => doc.tgMessageId));

  const messages: MessageDocument[] = [];
  const historyEntries: MessageHistoryDocument[] = [];
  let importedMessages = 0;
  let skippedExistingMessages = 0;
  for (let i = 0; i < backupData.messages.length; i++) {
    const msg = backupData.messages[i];
    const processedMessages = i + 1;

    if (existingMessageIds.has(msg.id)) {
      skippedExistingMessages += 1;
      if (processedMessages % 200 === 0 || processedMessages === backupData.messages.length) {
        await options.onProgress?.({
          processedMessages,
          totalMessages: backupData.messages.length,
          importedMessages,
          skippedExistingMessages,
        });
      }
      continue;
    }

    console.log(`Processing message ${i + 1}/${backupData.messages.length} from chat ${backupData.name}`);

    const transformedMessage = createImportedMessageBaseline(
      await transformBackupMessage(msg, backupData, sourceDir, dirname(filePath)),
    );
    messages.push(transformedMessage);
    historyEntries.push(createBaselineHistoryEntry(transformedMessage));
    importedMessages += 1;
    existingMessageIds.add(msg.id);

    if (messages.length >= 100) {
      await messagesCollection.bulkWrite(
        messages.map((doc) => ({
          updateOne: {
            filter: {
              tgMessageId: doc.tgMessageId,
              tgChatId: doc.tgChatId,
            },
            update: { $set: doc },
            upsert: true,
          },
        })),
      );
      await messageHistoryCollection.bulkWrite(
        historyEntries.map((entry) => ({
          updateOne: {
            filter: {
              tgMessageId: entry.tgMessageId,
              tgChatId: entry.tgChatId,
              version: entry.version,
            },
            update: { $setOnInsert: prepareForMongoDb(entry) },
            upsert: true,
          },
        })),
      );
      console.log(`Imported ${i + 1} messages out of ${backupData.messages.length} for ${backupData.name}`);
      messages.length = 0;
      historyEntries.length = 0;
    }

    if (processedMessages % 200 === 0 || processedMessages === backupData.messages.length) {
      await options.onProgress?.({
        processedMessages,
        totalMessages: backupData.messages.length,
        importedMessages,
        skippedExistingMessages,
      });
    }
  }

  if (messages.length > 0) {
    await messagesCollection.bulkWrite(
      messages.map((doc) => ({
        updateOne: {
          filter: {
            tgMessageId: doc.tgMessageId,
            tgChatId: doc.tgChatId,
          },
          update: { $set: doc },
          upsert: true,
        },
      })),
    );
    await messageHistoryCollection.bulkWrite(
      historyEntries.map((entry) => ({
        updateOne: {
          filter: {
            tgMessageId: entry.tgMessageId,
            tgChatId: entry.tgChatId,
            version: entry.version,
          },
          update: { $setOnInsert: prepareForMongoDb(entry) },
          upsert: true,
        },
      })),
    );
  }

  await upsertDialogBootstrap(db, backupData, sourceDir, {
    scannedMessages: backupData.messages.length,
    importedMessages,
    skippedExistingMessages,
  });

  console.log(
    `Reconciled chat "${backupData.name}": imported ${importedMessages}, skipped existing ${skippedExistingMessages}, scanned ${backupData.messages.length}`,
  );

  return {
    chatName: backupData.name,
    chatId: backupData.id,
    sourceDir,
    scannedMessages: backupData.messages.length,
    importedMessages,
    skippedExistingMessages,
  };
}

async function readBackupChatMetadata(filePath: string): Promise<{ id: number; name: string }> {
  const fileContent = await readFile(filePath, 'utf-8');
  const backupData: BackupChat = JSON.parse(fileContent);
  return { id: backupData.id, name: backupData.name };
}

export async function findBackupResultFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const resultFiles: string[] = [];

  const rootResult = join(rootDir, 'result.json');
  try {
    await access(rootResult);
    resultFiles.push(rootResult);
  } catch {
    // no-op
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const resultPath = join(rootDir, entry.name, 'result.json');
    try {
      await access(resultPath);
      resultFiles.push(resultPath);
    } catch {
      // not a Telegram export dir
    }
  }

  return resultFiles;
}

export async function importBackupsFromRoot(
  rootDir: string,
  options: ImportBackupsFromRootOptions = {},
): Promise<ImportBackupsSummary> {
  const resultFiles = await findBackupResultFiles(rootDir);
  if (resultFiles.length === 0) {
    throw new Error(`No result.json files found under ${rootDir}`);
  }

  const shouldDrop = process.env.DROP_MONGO_COLLECTION_BEFORE_IMPORT?.toLowerCase() === 'true';
  const results: ImportBackupResult[] = [];
  let dropApplied = false;
  let scannedChats = 0;
  let skippedNonWhitelistedChats = 0;
  let scannedMessages = 0;
  let importedMessages = 0;
  let skippedExistingMessages = 0;

  for (let i = 0; i < resultFiles.length; i++) {
    const resultPath = resultFiles[i];
    const chatIndex = i + 1;
    scannedChats += 1;

    const { id, name } = await readBackupChatMetadata(resultPath);

    if (options.whitelistedChatIds) {
      if (!options.whitelistedChatIds.has(String(id))) {
        skippedNonWhitelistedChats += 1;
        console.log(`Skipping non-whitelisted backup chat ${name} (${id}) from ${resultPath}`);
        continue;
      }
    }

    await options.onChatStart?.({
      chatId: id,
      chatName: name,
      chatIndex,
      totalChats: resultFiles.length,
      sourcePath: resultPath,
    });

    console.log(`Importing backup ${chatIndex}/${resultFiles.length}: ${resultPath}`);
    const result = await importBackupFile(resultPath, {
      dropMessagesCollectionBeforeImport: shouldDrop && !dropApplied,
      onProgress: async (progress) => {
        await options.onChatProgress?.({
          chatId: id,
          chatName: name,
          chatIndex,
          totalChats: resultFiles.length,
          sourcePath: resultPath,
          progress,
        });
      },
    });
    dropApplied = dropApplied || shouldDrop;
    results.push(result);
    scannedMessages += result.scannedMessages;
    importedMessages += result.importedMessages;
    skippedExistingMessages += result.skippedExistingMessages;

    await options.onChatDone?.({
      chatId: id,
      chatName: name,
      chatIndex,
      totalChats: resultFiles.length,
      sourcePath: resultPath,
      result,
    });
  }

  const summary: ImportBackupsSummary = {
    scannedChats,
    importedChats: results.length,
    skippedNonWhitelistedChats,
    scannedMessages,
    importedMessages,
    skippedExistingMessages,
    results,
  };

  await options.onSummary?.(summary);
  return summary;
}

async function main() {
  const backupDir = process.argv[2];
  if (!backupDir) {
    console.error('Please provide backup root directory path, e.g. /exports');
    process.exit(1);
  }

  try {
    const summary = await importBackupsFromRoot(backupDir);
    console.log(
      `Reconcile complete: scanned chats=${summary.scannedChats}, imported chats=${summary.importedChats}, imported messages=${summary.importedMessages}, skipped existing messages=${summary.skippedExistingMessages}`,
    );
  } catch (error) {
    console.error('Failed to import backup:', error);
    process.exit(1);
  } finally {
    await closeMongoDbClient();
  }
}

if (require.main === module) {
  main();
}
