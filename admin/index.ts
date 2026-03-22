import * as Minio from 'minio';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import express from 'express';
import { Db, MongoClient } from 'mongodb';
import { existsSync } from 'fs';
import { join } from 'path';
import { ROUTES } from './shared/api';
import 'dotenv/config';

const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000'),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || '',
    secretKey: process.env.MINIO_SECRET_KEY || ''
});

const app = express();
const port = process.env.PORT || 3000;
const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();
const adminCookieSecret = String(process.env.ADMIN_COOKIE_SECRET || '').trim();
const adminSessionTtlMs = Math.max(60_000, parseInt(process.env.ADMIN_SESSION_TTL_MS || '1209600000', 10) || 1209600000);
const adminCookieName = 'tg_archive_admin_session';
const adminCookieSecure = process.env.ADMIN_COOKIE_SECURE === 'true';
const loginRoute = '/login';
const logoutRoute = '/logout';

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const webDistPath = join(import.meta.dir, 'web', 'dist');
const spaIndexPath = join(webDistPath, 'index.html');

function hasSpaBuild() {
    return existsSync(spaIndexPath);
}

function sendSpa(res: express.Response) {
    return res.sendFile(spaIndexPath);
}

function ensureSpaOr503(res: express.Response) {
    if (!hasSpaBuild()) {
        res.status(503).send('Admin web build not found. Build frontend assets first.');
        return false;
    }
    return true;
}

function isAdminAuthConfigured() {
    return adminPassword.length > 0 && adminCookieSecret.length > 0;
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeNextPath(value: unknown) {
    const nextPath = typeof value === 'string' ? value.trim() : '';
    if (!nextPath.startsWith('/') || nextPath.startsWith('//') || nextPath.startsWith(loginRoute)) {
        return '/';
    }
    return nextPath;
}

function parseCookies(cookieHeader?: string) {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) {
        return cookies;
    }

    for (const cookie of cookieHeader.split(';')) {
        const trimmed = cookie.trim();
        if (!trimmed) {
            continue;
        }
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex <= 0) {
            continue;
        }
        const name = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim();
        try {
            cookies[name] = decodeURIComponent(value);
        } catch {
            cookies[name] = value;
        }
    }

    return cookies;
}

function createSessionSignature(payload: string) {
    return createHmac('sha256', adminCookieSecret).update(payload).digest('base64url');
}

function createSessionToken() {
    const expiresAt = Date.now() + adminSessionTtlMs;
    const nonce = randomBytes(16).toString('base64url');
    const payload = `${expiresAt}.${nonce}`;
    const signature = createSessionSignature(payload);
    return `${payload}.${signature}`;
}

function safeEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
}

function hasValidSession(req: express.Request) {
    if (!isAdminAuthConfigured()) {
        return false;
    }

    const token = parseCookies(req.headers.cookie)[adminCookieName];
    if (!token) {
        return false;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
        return false;
    }

    const [expiresAtRaw, nonce, signature] = parts;
    const expiresAt = parseInt(expiresAtRaw, 10);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !nonce || !signature) {
        return false;
    }

    const expectedSignature = createSessionSignature(`${expiresAtRaw}.${nonce}`);
    return safeEqual(signature, expectedSignature);
}

function setSessionCookie(res: express.Response) {
    const maxAge = adminSessionTtlMs;
    res.cookie(adminCookieName, createSessionToken(), {
        httpOnly: true,
        sameSite: 'lax',
        secure: adminCookieSecure,
        path: '/',
        maxAge,
    });
}

function clearSessionCookie(res: express.Response) {
    res.clearCookie(adminCookieName, {
        httpOnly: true,
        sameSite: 'lax',
        secure: adminCookieSecure,
        path: '/',
    });
}

function renderLoginPage(message?: string, nextPath: string = '/') {
    const escapedMessage = message ? `<p class="message">${escapeHtml(message)}</p>` : '';
    const escapedNextPath = escapeHtml(nextPath);
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TG Archive Login</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3efe6;
        --panel: rgba(255, 251, 245, 0.95);
        --text: #1f2937;
        --muted: #6b7280;
        --accent: #0f766e;
        --accent-dark: #115e59;
        --border: rgba(15, 23, 42, 0.12);
        --shadow: 0 24px 60px rgba(15, 23, 42, 0.14);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.16), transparent 28%),
          radial-gradient(circle at bottom right, rgba(180, 83, 9, 0.14), transparent 22%),
          linear-gradient(135deg, #efe7da 0%, var(--bg) 45%, #e8edf1 100%);
        padding: 24px;
      }
      .card {
        width: min(100%, 420px);
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 24px;
        box-shadow: var(--shadow);
        padding: 32px;
        backdrop-filter: blur(10px);
      }
      .eyebrow {
        display: inline-block;
        font-size: 12px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--accent);
        margin-bottom: 14px;
      }
      h1 {
        margin: 0 0 10px;
        font-size: clamp(30px, 6vw, 38px);
        line-height: 1.05;
      }
      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }
      form {
        margin-top: 28px;
        display: grid;
        gap: 14px;
      }
      label {
        font-size: 14px;
        font-weight: 600;
        color: var(--text);
      }
      input {
        width: 100%;
        border: 1px solid rgba(15, 23, 42, 0.14);
        border-radius: 14px;
        padding: 14px 16px;
        font: inherit;
        background: rgba(255, 255, 255, 0.92);
      }
      input:focus {
        outline: 2px solid rgba(15, 118, 110, 0.25);
        border-color: rgba(15, 118, 110, 0.5);
      }
      button {
        border: 0;
        border-radius: 14px;
        padding: 14px 16px;
        font: inherit;
        font-weight: 700;
        color: white;
        background: linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%);
        cursor: pointer;
      }
      button:hover { filter: brightness(1.03); }
      .message {
        margin-top: 18px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(180, 83, 9, 0.1);
        color: #9a3412;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="eyebrow">Protected Archive</div>
      <h1>TG Archive</h1>
      <p>Enter the admin password to unlock the archive interface and API.</p>
      ${escapedMessage}
      <form method="post" action="${loginRoute}">
        <input type="hidden" name="next" value="${escapedNextPath}" />
        <div>
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required autofocus />
        </div>
        <button type="submit">Unlock archive</button>
      </form>
    </main>
  </body>
</html>`;
}

function sendUnauthorized(req: express.Request, res: express.Response) {
    clearSessionCookie(res);
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ message: 'Authentication required' });
    }
    if (req.path.startsWith('/media/')) {
        return res.status(401).send('Authentication required');
    }
    const nextPath = normalizeNextPath(req.originalUrl || req.url || '/');
    return res.redirect(`${loginRoute}?next=${encodeURIComponent(nextPath)}`);
}

if (!isAdminAuthConfigured()) {
    console.warn('ADMIN_PASSWORD is not configured; admin routes stay unavailable until it is set.');
}

app.get(loginRoute, (req, res) => {
    if (!isAdminAuthConfigured()) {
        return res.status(503).send('Admin authentication is not configured. Set ADMIN_PASSWORD first.');
    }
    if (hasValidSession(req)) {
        return res.redirect(normalizeNextPath(req.query.next));
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(renderLoginPage(undefined, normalizeNextPath(req.query.next)));
});

app.post(loginRoute, (req, res) => {
    if (!isAdminAuthConfigured()) {
        return res.status(503).send('Admin authentication is not configured. Set ADMIN_PASSWORD first.');
    }

    const password = String(req.body?.password || '');
    const nextPath = normalizeNextPath(req.body?.next);
    if (!safeEqual(password, adminPassword)) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(401).send(renderLoginPage('Incorrect password. Try again.', nextPath));
    }

    setSessionCookie(res);
    return res.redirect(nextPath);
});

app.post(logoutRoute, (_req, res) => {
    clearSessionCookie(res);
    return res.redirect(loginRoute);
});

app.use((req, res, next) => {
    if (!isAdminAuthConfigured()) {
        if (req.path === loginRoute || req.path === logoutRoute) {
            return next();
        }
        return res.status(503).send('Admin authentication is not configured. Set ADMIN_PASSWORD first.');
    }
    if (req.path === loginRoute || req.path === logoutRoute) {
        return next();
    }
    if (hasValidSession(req)) {
        return next();
    }
    return sendUnauthorized(req, res);
});

app.use(express.static('public'));
if (existsSync(webDistPath)) {
    app.use('/assets', express.static(join(webDistPath, 'assets')));
}

let mongoClient: MongoClient | undefined;
let mongoDb: Db | undefined;

async function getMongoDbClient() {
    if (mongoDb) {
        return mongoDb;
    }

    mongoClient = new MongoClient(process.env.MONGO_URI || "");
    await mongoClient.connect();
    mongoDb = mongoClient.db("tgArchive");
    return mongoDb;
}

async function closeMongoDbClient() {
    if (!mongoClient) {
        return;
    }

    await mongoClient.close();
    mongoClient = undefined;
    mongoDb = undefined;
}

async function loadDialogs(db: any) {
    return db.collection('dialogs')
        .find({})
        .sort({
            pinned: -1,
            'metadata.lastUpdated': 1,
        })
        .toArray();
}

async function loadDialogSyncSummary(db: any, dialogIds: string[]) {
    const normalizedDialogIds = normalizeChatIds(dialogIds);
    if (normalizedDialogIds.length === 0) {
        return new Map<string, { backfillCompletedAt?: Date }>();
    }

    const syncRows = await db.collection('dialogSync').find(
        { tgDialogId: { $in: normalizedDialogIds } },
        {
            projection: {
                _id: 0,
                tgDialogId: 1,
                backfillCompletedAt: 1,
            },
        },
    ).toArray();

    return new Map<string, { backfillCompletedAt?: Date }>(
        syncRows.map((row: any) => [
            String(row.tgDialogId),
            { backfillCompletedAt: row?.backfillCompletedAt },
        ]),
    );
}

async function loadAgentStatus(db: any) {
    return db.collection('agentStatus').findOne(
        { _id: 'primary' },
        { projection: { authPassword: 0 } },
    );
}

function normalizeChatIds(input: unknown): string[] {
    if (!Array.isArray(input)) {
        return [];
    }

    const ids = new Set<string>();
    for (const value of input) {
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
            continue;
        }
        const chatId = String(value).trim();
        if (!/^-?\d+$/.test(chatId)) {
            continue;
        }
        ids.add(chatId);
    }

    return Array.from(ids);
}

async function loadSyncConfig(db: any) {
    const config = await db.collection('syncConfig').findOne({ _id: 'primary' });
    return {
        liveSyncChatIds: normalizeChatIds(config?.liveSyncChatIds),
        updatedAt: config?.updatedAt,
    };
}

async function saveSyncConfig(db: any, liveSyncChatIds: string[]) {
    const normalized = normalizeChatIds(liveSyncChatIds);
    const updatedAt = new Date();
    await db.collection('syncConfig').updateOne(
        { _id: 'primary' },
        {
            $set: {
                liveSyncChatIds: normalized,
                updatedAt,
            },
        },
        { upsert: true },
    );

    return { liveSyncChatIds: normalized, updatedAt };
}

function parseTimestamp(value: unknown): number {
    if (!value) {
        return 0;
    }

    const timestamp = new Date(value as any).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

type BackfillRequestMode = 'full' | 'recent';

function hasPendingBackfillRequest(syncRow: any): boolean {
    const requestedAtMs = parseTimestamp(syncRow?.forceBackfillRequestedAt);
    const handledAtMs = parseTimestamp(syncRow?.forceBackfillHandledAt);
    return requestedAtMs > 0 && (!handledAtMs || handledAtMs < requestedAtMs);
}

async function queueDialogBackfillRequests(
    db: any,
    requestedChatIds: string[],
    options: {
        mode?: BackfillRequestMode;
        skipAlreadyBackfilled?: boolean;
        afterDate?: Date;
        windowDays?: number;
    } = {},
) {
    const normalizedChatIds = normalizeChatIds(requestedChatIds);
    if (normalizedChatIds.length === 0) {
        return {
            queuedCount: 0,
            skippedAlreadyBackfilledCount: 0,
            skippedAlreadyQueuedCount: 0,
            skippedUnknownDialogCount: 0,
            requestedAt: undefined as Date | undefined,
        };
    }

    const knownDialogs = await db.collection('dialogs').find(
        { tgDialogId: { $in: normalizedChatIds } },
        { projection: { _id: 0, tgDialogId: 1 } },
    ).toArray();
    const knownDialogIdSet = new Set(
        knownDialogs
            .map((row: any) => (typeof row?.tgDialogId === 'string' ? row.tgDialogId : String(row?.tgDialogId || '')))
            .filter(Boolean),
    );

    const eligibleChatIds = normalizedChatIds.filter((chatId) => knownDialogIdSet.has(chatId));
    const skippedUnknownDialogCount = normalizedChatIds.length - eligibleChatIds.length;
    if (eligibleChatIds.length === 0) {
        return {
            queuedCount: 0,
            skippedAlreadyBackfilledCount: 0,
            skippedAlreadyQueuedCount: 0,
            skippedUnknownDialogCount,
            requestedAt: undefined as Date | undefined,
        };
    }

    const syncRows = await db.collection('dialogSync').find(
        { tgDialogId: { $in: eligibleChatIds } },
        {
            projection: {
                _id: 0,
                tgDialogId: 1,
                backfillCompletedAt: 1,
                forceBackfillRequestedAt: 1,
                forceBackfillHandledAt: 1,
            },
        },
    ).toArray();

    const syncRowByChatId = new Map<string, any>(syncRows.map((row: any) => [String(row.tgDialogId), row]));
    let skippedAlreadyBackfilledCount = 0;
    let skippedAlreadyQueuedCount = 0;
    const queuedChatIds: string[] = [];

    for (const chatId of eligibleChatIds) {
        const syncRow = syncRowByChatId.get(chatId);
        if (options.skipAlreadyBackfilled && parseTimestamp(syncRow?.backfillCompletedAt) > 0) {
            skippedAlreadyBackfilledCount += 1;
            continue;
        }
        if (hasPendingBackfillRequest(syncRow)) {
            skippedAlreadyQueuedCount += 1;
            continue;
        }
        queuedChatIds.push(chatId);
    }

    let requestedAt: Date | undefined;
    if (queuedChatIds.length > 0) {
        requestedAt = new Date();
        await db.collection('dialogSync').bulkWrite(
            queuedChatIds.map((chatId) => {
                const setFields: Record<string, unknown> = {
                    forceBackfillRequestedAt: requestedAt,
                    forceBackfillMode: options.mode || 'full',
                    backfillUpdatedAt: requestedAt,
                    lastSyncDate: requestedAt,
                };
                if (options.afterDate) {
                    setFields.forceBackfillAfterDate = options.afterDate;
                }
                if (typeof options.windowDays === 'number' && Number.isFinite(options.windowDays) && options.windowDays > 0) {
                    setFields.forceBackfillWindowDays = options.windowDays;
                }

                const update: Record<string, unknown> = { $set: setFields };
                if (!options.afterDate) {
                    update.$unset = {
                        forceBackfillAfterDate: '',
                        forceBackfillWindowDays: '',
                    };
                }

                return {
                    updateOne: {
                        filter: { tgDialogId: chatId },
                        update,
                        upsert: true,
                    },
                };
            }),
        );
    }

    return {
        queuedCount: queuedChatIds.length,
        skippedAlreadyBackfilledCount,
        skippedAlreadyQueuedCount,
        skippedUnknownDialogCount,
        requestedAt,
    };
}

async function queueBackfillForNewlySelectedUnbackfilledChats(
    db: any,
    previousLiveSyncChatIds: string[],
    nextLiveSyncChatIds: string[],
) {
    const previousSet = new Set(normalizeChatIds(previousLiveSyncChatIds));
    const newlySelectedChatIds = normalizeChatIds(nextLiveSyncChatIds).filter((chatId) => !previousSet.has(chatId));

    if (newlySelectedChatIds.length === 0) {
        return {
            queuedCount: 0,
            skippedAlreadyBackfilledCount: 0,
            skippedAlreadyQueuedCount: 0,
            skippedUnknownDialogCount: 0,
        };
    }

    const queued = await queueDialogBackfillRequests(db, newlySelectedChatIds, {
        mode: 'full',
        skipAlreadyBackfilled: true,
    });

    return {
        queuedCount: queued.queuedCount,
        skippedAlreadyBackfilledCount: queued.skippedAlreadyBackfilledCount,
        skippedAlreadyQueuedCount: queued.skippedAlreadyQueuedCount,
        skippedUnknownDialogCount: queued.skippedUnknownDialogCount,
    };
}

async function queueRecentBackfillForLiveSyncChats(db: any, windowDays = 7) {
    const syncConfig = await loadSyncConfig(db);
    const liveSyncChatIds = normalizeChatIds(syncConfig?.liveSyncChatIds);
    if (liveSyncChatIds.length === 0) {
        return {
            liveSyncSelectedCount: 0,
            windowDays,
            afterDate: undefined as Date | undefined,
            queuedCount: 0,
            skippedAlreadyQueuedCount: 0,
            skippedUnknownDialogCount: 0,
            requestedAt: undefined as Date | undefined,
        };
    }

    const afterDate = new Date(Date.now() - (windowDays * 24 * 60 * 60 * 1000));
    const queued = await queueDialogBackfillRequests(db, liveSyncChatIds, {
        mode: 'recent',
        afterDate,
        windowDays,
    });

    return {
        liveSyncSelectedCount: liveSyncChatIds.length,
        windowDays,
        afterDate,
        queuedCount: queued.queuedCount,
        skippedAlreadyQueuedCount: queued.skippedAlreadyQueuedCount,
        skippedUnknownDialogCount: queued.skippedUnknownDialogCount,
        requestedAt: queued.requestedAt,
    };
}

async function requestDialogBackfill(db: any, chatId: string) {
    const normalized = normalizeChatIds([chatId])[0];
    if (!normalized) {
        return null;
    }

    const dialog = await db.collection('dialogs').findOne(
        { tgDialogId: normalized },
        { projection: { _id: 1 } },
    );

    if (!dialog) {
        return null;
    }

    const requestedAt = new Date();
    await db.collection('dialogSync').updateOne(
        { tgDialogId: normalized },
        {
            $set: {
                forceBackfillRequestedAt: requestedAt,
                backfillUpdatedAt: requestedAt,
                lastSyncDate: requestedAt,
            },
        },
        { upsert: true },
    );

    return {
        ok: true,
        chatId: normalized,
        requestedAt,
    };
}

async function loadDialogActivity(db: any) {
    const [syncConfig, agentStatus] = await Promise.all([
        loadSyncConfig(db),
        loadAgentStatus(db),
    ]);

    const selectedIds = normalizeChatIds(syncConfig?.liveSyncChatIds);
    const trackedIds = new Set<string>(selectedIds);

    const reconcileCurrentChatId = typeof agentStatus?.reconcile?.currentChatId === 'string'
        ? agentStatus.reconcile.currentChatId
        : undefined;
    const backfillCurrentChatId = typeof agentStatus?.backfill?.currentChatId === 'string'
        ? agentStatus.backfill.currentChatId
        : undefined;

    if (reconcileCurrentChatId) {
        trackedIds.add(reconcileCurrentChatId);
    }
    if (backfillCurrentChatId) {
        trackedIds.add(backfillCurrentChatId);
    }

    const requestedRows = await db.collection('dialogSync').find(
        { forceBackfillRequestedAt: { $exists: true } },
        {
            projection: {
                _id: 0,
                tgDialogId: 1,
                forceBackfillRequestedAt: 1,
                forceBackfillHandledAt: 1,
            },
        },
    ).toArray();

    for (const row of requestedRows) {
        const requestedAt = row?.forceBackfillRequestedAt ? new Date(row.forceBackfillRequestedAt).getTime() : 0;
        const handledAt = row?.forceBackfillHandledAt ? new Date(row.forceBackfillHandledAt).getTime() : 0;
        if (requestedAt > 0 && (!handledAt || handledAt < requestedAt)) {
            trackedIds.add(String(row.tgDialogId));
        }
    }

    if (trackedIds.size === 0) {
        return { activities: {} };
    }

    const syncRows = await db.collection('dialogSync').find(
        { tgDialogId: { $in: Array.from(trackedIds) } },
        {
            projection: {
                _id: 0,
                tgDialogId: 1,
                isSyncing: 1,
                backfillScannedMessages: 1,
                backfillImportedMessages: 1,
                backfillSkippedExistingMessages: 1,
                backfillCompletedAt: 1,
                backfillUpdatedAt: 1,
                forceBackfillRequestedAt: 1,
                forceBackfillHandledAt: 1,
                forceBackfillLastCompletedAt: 1,
                lastSyncDate: 1,
            },
        },
    ).toArray();

    const syncById = new Map<string, any>(syncRows.map((row: any) => [String(row.tgDialogId), row]));
    const selectedSet = new Set(selectedIds);
    const activities: Record<string, any> = {};
    const parsedStaleBackfillMs = Number(process.env.DIALOG_ACTIVITY_STALE_MS || 90_000);
    const staleBackfillMs = Number.isFinite(parsedStaleBackfillMs) && parsedStaleBackfillMs > 0
        ? parsedStaleBackfillMs
        : 90_000;
    const nowMs = Date.now();

    for (const chatId of trackedIds) {
        const syncRow = syncById.get(chatId);
        const activity = {
            chatId,
            liveSyncSelected: selectedSet.has(chatId),
            phase: 'idle' as 'importing_backup' | 'backfilling' | 'stale' | 'queued' | 'complete' | 'idle',
            updatedAt: syncRow?.backfillUpdatedAt || agentStatus?.updatedAt,
            chatProgress: undefined as undefined | {
                scannedMessages?: number;
                importedMessages?: number;
                skippedExistingMessages?: number;
                enrichedMessages?: number;
            },
        };

        if (
            reconcileCurrentChatId === chatId
            && agentStatus?.reconcile?.phase === 'importing'
        ) {
            activity.phase = 'importing_backup';
            if (agentStatus?.reconcile?.chatProgress) {
                activity.chatProgress = {
                    scannedMessages: agentStatus.reconcile.chatProgress.processedMessages,
                    importedMessages: agentStatus.reconcile.chatProgress.importedMessages,
                    skippedExistingMessages: agentStatus.reconcile.chatProgress.skippedExistingMessages,
                };
            }
            activity.updatedAt = agentStatus?.updatedAt;
        } else {
            const isBackfillFromAgent = (
                backfillCurrentChatId === chatId
                && agentStatus?.state === 'syncing_messages'
            );
            const backfillProgressFromAgent = isBackfillFromAgent
                ? agentStatus?.backfill?.chatProgress
                : undefined;
            const syncUpdatedAtMs = syncRow?.backfillUpdatedAt
                ? new Date(syncRow.backfillUpdatedAt).getTime()
                : syncRow?.lastSyncDate
                    ? new Date(syncRow.lastSyncDate).getTime()
                    : 0;
            const forceRequestedAtMs = syncRow?.forceBackfillRequestedAt
                ? new Date(syncRow.forceBackfillRequestedAt).getTime()
                : undefined;
            const forceHandledAtMs = syncRow?.forceBackfillHandledAt
                ? new Date(syncRow.forceBackfillHandledAt).getTime()
                : undefined;
            const forceCompletedAtMs = syncRow?.forceBackfillLastCompletedAt
                ? new Date(syncRow.forceBackfillLastCompletedAt).getTime()
                : undefined;
            const forcePending = !!forceRequestedAtMs
                && (!forceHandledAtMs || forceHandledAtMs < forceRequestedAtMs);
            const forceCompleted = !!forceCompletedAtMs
                && (!forceRequestedAtMs || forceCompletedAtMs >= forceRequestedAtMs);
            const isFreshSyncRow = Boolean(
                syncRow?.isSyncing
                && syncUpdatedAtMs > 0
                && (nowMs - syncUpdatedAtMs) <= staleBackfillMs,
            );

            if (isBackfillFromAgent || isFreshSyncRow) {
            activity.phase = 'backfilling';
            activity.chatProgress = {
                scannedMessages: backfillProgressFromAgent?.scannedMessages ?? syncRow?.backfillScannedMessages,
                importedMessages: backfillProgressFromAgent?.importedMessages ?? syncRow?.backfillImportedMessages,
                skippedExistingMessages: backfillProgressFromAgent?.skippedExistingMessages ?? syncRow?.backfillSkippedExistingMessages,
                enrichedMessages: backfillProgressFromAgent?.enrichedMessages,
            };
            activity.updatedAt = syncRow?.backfillUpdatedAt || agentStatus?.updatedAt || syncRow?.lastSyncDate;
            } else if (syncRow?.isSyncing) {
                activity.phase = 'stale';
                activity.chatProgress = {
                    scannedMessages: syncRow?.backfillScannedMessages,
                    importedMessages: syncRow?.backfillImportedMessages,
                    skippedExistingMessages: syncRow?.backfillSkippedExistingMessages,
                };
                activity.updatedAt = syncRow?.backfillUpdatedAt || syncRow?.lastSyncDate || agentStatus?.updatedAt;
            } else if (selectedSet.has(chatId) || forcePending) {
                activity.phase = forcePending
                    ? 'queued'
                    : (syncRow?.backfillCompletedAt || forceCompleted)
                        ? 'complete'
                        : 'queued';
                activity.chatProgress = {
                    scannedMessages: syncRow?.backfillScannedMessages,
                    importedMessages: syncRow?.backfillImportedMessages,
                    skippedExistingMessages: syncRow?.backfillSkippedExistingMessages,
                };
                if (forcePending) {
                    activity.updatedAt = syncRow?.forceBackfillRequestedAt || activity.updatedAt;
                } else if (forceCompleted) {
                    activity.updatedAt = syncRow?.forceBackfillLastCompletedAt || activity.updatedAt;
                }
            }
        }

        activities[chatId] = activity;
    }

    return { activities };
}

async function loadDialogDetails(db: any, id: string) {
    const dialog = await db.collection('dialogs').findOne({ tgDialogId: id });
    if (!dialog) {
        return null;
    }

    const tgChatIdFilter = buildTgChatIdFilter(id);
    const messages = await db.collection('messages')
        .find(tgChatIdFilter)
        .sort({ 'metadata.originalDate': -1, tgMessageId: -1 })
        .limit(5)
        .toArray();

    return { dialog, messages: messages.map(normalizeMessageForResponse) };
}

async function loadDialogMessagesPage(db: any, chatId: number, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const tgChatIdFilter = buildTgChatIdFilter(chatId);
    const [messages, totalCount] = await Promise.all([
        db.collection('messages')
            .find(tgChatIdFilter)
            .sort({ 'metadata.originalDate': -1, tgMessageId: -1 })
            .skip(skip)
            .limit(limit)
            .toArray(),
        db.collection('messages').countDocuments(tgChatIdFilter),
    ]);

    return {
        messages: messages.map(normalizeMessageForResponse),
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    };
}

async function loadDialogTimelinePage(db: any, chatId: number, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const tgChatIdFilter = buildTgChatIdFilter(chatId);
    const historyCollection = db.collection('messageHistory');
    const historyCount = await historyCollection.countDocuments(tgChatIdFilter);

    if (historyCount === 0) {
        const [messages, totalCount] = await Promise.all([
            db.collection('messages')
                .find(tgChatIdFilter)
                .sort({ 'metadata.originalDate': 1, tgMessageId: 1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('messages').countDocuments(tgChatIdFilter),
        ]);

        return {
            timeline: messages.map(createSyntheticMessageHistoryEntry),
            totalCount,
            totalPages: Math.max(1, Math.ceil(totalCount / limit)),
        };
    }

    const [timeline, totalCount] = await Promise.all([
        historyCollection
            .find(tgChatIdFilter)
            .sort({ observedAt: 1, version: 1, tgMessageId: 1 })
            .skip(skip)
            .limit(limit)
            .toArray(),
        historyCollection.countDocuments(tgChatIdFilter),
    ]);

    return {
        timeline: timeline.map(normalizeMessageHistoryEntryForResponse),
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    };
}

function buildTgChatIdFilter(chatId: string | number) {
    const stringId = String(chatId);
    const numericId = Number.parseInt(stringId, 10);
    const variants: Array<string | number | bigint> = [stringId];

    if (!Number.isNaN(numericId)) {
        variants.push(numericId);
        try {
            variants.push(BigInt(stringId));
        } catch {
            // keep number/string variants only
        }
    }

    return { tgChatId: { $in: variants } };
}

function toChatIdString(value: unknown) {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
    }
    if (value && typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
        return value.toString();
    }
    return '';
}

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePositiveInt(value: unknown, fallback: number, max?: number) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    if (typeof max === 'number') {
        return Math.min(parsed, max);
    }
    return parsed;
}

function normalizeMessageForResponse(message: any) {
    if (!message) {
        return null;
    }

    return {
        ...message,
        chatId: toChatIdString(message?.tgChatId),
    };
}

function normalizeMessageHistoryEntryForResponse(entry: any) {
    if (!entry) {
        return null;
    }

    return {
        ...entry,
        chatId: toChatIdString(entry?.tgChatId),
        before: normalizeMessageForResponse(entry?.before),
        after: normalizeMessageForResponse(entry?.after),
    };
}

function createSyntheticMessageHistoryEntry(message: any) {
    const observedAt = message?.metadata?.lastMutationAt
        || message?.metadata?.firstSeenAt
        || message?.metadata?.importedAt
        || message?.metadata?.originalDate;

    return normalizeMessageHistoryEntryForResponse({
        tgChatId: message?.tgChatId,
        tgMessageId: message?.tgMessageId,
        version: typeof message?.metadata?.currentVersion === 'number' && message.metadata.currentVersion > 0
            ? message.metadata.currentVersion
            : 1,
        eventType: 'baseline',
        observedAt,
        source: message?.metadata?.source,
        changedFields: [],
        summary: 'Current snapshot only (no immutable history was captured yet)',
        changes: {},
        before: null,
        after: message,
    });
}

async function loadArchivedMessageSearchPage(db: any, query: string, page: number, limit: number, chatId?: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
        return {
            messages: [],
            totalCount: 0,
            totalPages: 1,
        };
    }

    const skip = (page - 1) * limit;
    const searchRegex = new RegExp(escapeRegex(normalizedQuery), 'i');
    const filters: Record<string, unknown>[] = [
        { 'content.text': searchRegex },
        { 'content.text.text': searchRegex },
    ];

    const filter = chatId?.trim()
        ? {
            $and: [
                buildTgChatIdFilter(chatId),
                { $or: filters },
            ],
        }
        : { $or: filters };

    const [messages, totalCount] = await Promise.all([
        db.collection('messages')
            .find(filter)
            .sort({ 'metadata.originalDate': -1, tgMessageId: -1 })
            .skip(skip)
            .limit(limit)
            .toArray(),
        db.collection('messages').countDocuments(filter),
    ]);

    return {
        messages: messages.map(normalizeMessageForResponse),
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    };
}

async function loadMessageContext(db: any, messageId: number, messagesPerPage = 50, chatId?: string) {
    const findFilter = chatId?.trim()
        ? { tgMessageId: messageId, ...buildTgChatIdFilter(chatId) }
        : { tgMessageId: messageId };
    const message = await db.collection('messages').findOne(findFilter);
    if (!message) {
        return null;
    }

    const resolvedChatId = toChatIdString(message.tgChatId);

    const messagePosition = await db.collection('messages').countDocuments({
        ...buildTgChatIdFilter(resolvedChatId),
        $or: [
            { 'metadata.originalDate': { $gt: message.metadata.originalDate } },
            {
                'metadata.originalDate': message.metadata.originalDate,
                tgMessageId: { $gt: message.tgMessageId },
            },
        ],
    });

    const page = Math.ceil((messagePosition + 1) / messagesPerPage);
    return {
        chatId: resolvedChatId,
        page,
        messageId,
    };
}

async function loadMessageHistory(db: any, messageId: number, chatId?: string) {
    const currentMessage = await db.collection('messages').findOne(
        chatId?.trim()
            ? { tgMessageId: messageId, ...buildTgChatIdFilter(chatId) }
            : { tgMessageId: messageId },
    );

    if (!currentMessage) {
        return null;
    }

    const resolvedChatId = toChatIdString(currentMessage.tgChatId);
    const history = await db.collection('messageHistory')
        .find({ ...buildTgChatIdFilter(resolvedChatId), tgMessageId: messageId })
        .sort({ version: 1 })
        .toArray();

    return {
        messageId,
        chatId: resolvedChatId,
        current: normalizeMessageForResponse(currentMessage),
        history: history.length > 0
            ? history.map(normalizeMessageHistoryEntryForResponse)
            : [createSyntheticMessageHistoryEntry(currentMessage)],
    };
}

async function handleGetAgentStatus(_req: express.Request, res: express.Response) {
    try {
        const db = await getMongoDbClient();
        const status = await loadAgentStatus(db);
        if (!status) {
            return res.status(200).json({ state: 'unknown', message: 'No status yet' });
        }
        res.status(200).json(status);
    } catch (error) {
        console.error('Error loading agent status:', error);
        res.status(500).json({ state: 'error', message: 'Failed to load agent status' });
    }
}

async function handleSubmitAgentPassword(req: express.Request, res: express.Response) {
    const password = String(req.body?.password || '').trim();
    if (!password) {
        return res.status(400).json({ ok: false, message: 'Password is required' });
    }

    try {
        const db = await getMongoDbClient();
        await db.collection('agentStatus').updateOne(
            { _id: 'primary' },
            {
                $set: {
                    authPassword: password,
                    authPasswordUpdatedAt: new Date(),
                    updatedAt: new Date(),
                    message: '2FA password submitted from Admin UI',
                },
            },
            { upsert: true },
        );

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Error submitting 2FA password:', error);
        res.status(500).json({ ok: false, message: 'Failed to submit password' });
    }
}

app.get(ROUTES.web.home, (_req, res) => {
    if (!ensureSpaOr503(res)) return;
    return sendSpa(res);
});

app.get(ROUTES.api.dialogs, async (_req, res) => {
    try {
        const db = await getMongoDbClient();
        const dialogs = await loadDialogs(db);
        const dialogIds = dialogs.map((dialog: any) => String(dialog.tgDialogId));
        const [messageCounts, syncSummaryById] = await Promise.all([
            db.collection('messages').aggregate([
                { $group: { _id: { $toString: '$tgChatId' }, count: { $sum: 1 } } },
            ]).toArray(),
            loadDialogSyncSummary(db, dialogIds),
        ]);

        const countMap = new Map(messageCounts.map((r: any) => [r._id, r.count]));
        for (const dialog of dialogs) {
            (dialog as any).messageCount = countMap.get(dialog.tgDialogId) || 0;
            const syncSummary = syncSummaryById.get(String(dialog.tgDialogId));
            if (syncSummary?.backfillCompletedAt) {
                (dialog as any).sync = {
                    ...(dialog as any).sync,
                    backfillCompletedAt: syncSummary.backfillCompletedAt,
                };
            }
        }

        res.status(200).json(dialogs);
    } catch (error) {
        console.error('Error loading dialogs:', error);
        res.status(500).json({ message: 'Failed to load dialogs' });
    }
});

app.get(ROUTES.api.agentStatus, handleGetAgentStatus);

app.post(ROUTES.api.agentPassword, handleSubmitAgentPassword);

app.get(ROUTES.api.dialogActivity, async (_req, res) => {
    try {
        const db = await getMongoDbClient();
        const activity = await loadDialogActivity(db);
        res.status(200).json(activity);
    } catch (error) {
        console.error('Error loading dialog activity:', error);
        res.status(500).json({ message: 'Failed to load dialog activity' });
    }
});

app.get(ROUTES.api.syncConfig, async (_req, res) => {
    try {
        const db = await getMongoDbClient();
        const config = await loadSyncConfig(db);
        res.status(200).json(config);
    } catch (error) {
        console.error('Error loading sync config:', error);
        res.status(500).json({ message: 'Failed to load sync config' });
    }
});

app.put(ROUTES.api.syncConfig, async (req, res) => {
    try {
        const db = await getMongoDbClient();
        const previousConfig = await loadSyncConfig(db);
        const liveSyncChatIds = normalizeChatIds(req.body?.liveSyncChatIds);
        const config = await saveSyncConfig(db, liveSyncChatIds);
        const autoBackfill = await queueBackfillForNewlySelectedUnbackfilledChats(
            db,
            previousConfig.liveSyncChatIds,
            config.liveSyncChatIds,
        );
        res.status(200).json({
            ...config,
            autoBackfill,
        });
    } catch (error) {
        console.error('Error updating sync config:', error);
        res.status(500).json({ message: 'Failed to update sync config' });
    }
});

app.post(ROUTES.api.dialogBackfill, async (req, res) => {
    try {
        const db = await getMongoDbClient();
        const payload = await requestDialogBackfill(db, req.params.id);
        if (!payload) {
            return res.status(404).json({ ok: false, message: 'Dialog not found' });
        }
        res.status(200).json(payload);
    } catch (error) {
        console.error('Error requesting dialog backfill:', error);
        res.status(500).json({ ok: false, message: 'Failed to request dialog backfill' });
    }
});

app.post(ROUTES.api.recentDialogsBackfill, async (_req, res) => {
    try {
        const db = await getMongoDbClient();
        const payload = await queueRecentBackfillForLiveSyncChats(db, 7);
        if (payload.liveSyncSelectedCount === 0) {
            return res.status(400).json({ ok: false, message: 'Select at least one live-sync chat first' });
        }
        res.status(200).json({ ok: true, ...payload });
    } catch (error) {
        console.error('Error requesting recent backfill for live-sync chats:', error);
        res.status(500).json({ ok: false, message: 'Failed to request recent backfill' });
    }
});

app.get(ROUTES.api.dialog, async (req, res) => {
    try {
        const db = await getMongoDbClient();
        const details = await loadDialogDetails(db, req.params.id);
        if (!details) {
            return res.status(404).json({ message: 'Dialog not found' });
        }
        res.status(200).json(details);
    } catch (error) {
        console.error('Error loading dialog details:', error);
        res.status(500).json({ message: 'Failed to load dialog details' });
    }
});

app.get(ROUTES.api.dialogMessages, async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 50, 100);
    const tgChatId = parseInt(req.params.id);

    try {
        const db = await getMongoDbClient();
        const [{ messages, totalPages, totalCount }, dialog] = await Promise.all([
            loadDialogMessagesPage(db, tgChatId, page, limit),
            db.collection('dialogs').findOne({ tgDialogId: String(tgChatId) }),
        ]);

        res.status(200).json({
            messages,
            pagination: {
                current: page,
                total: totalPages,
                totalCount,
                limit,
            },
            chatId: tgChatId,
            dialogType: {
                isUser: dialog?.isUser ?? false,
                isGroup: dialog?.isGroup ?? false,
                isChannel: dialog?.isChannel ?? false,
            },
        });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Failed to fetch messages' });
    }
});

app.get(ROUTES.api.dialogTimeline, async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 50, 100);
    const tgChatId = parseInt(req.params.id);

    try {
        const db = await getMongoDbClient();
        const [{ timeline, totalPages, totalCount }, dialog] = await Promise.all([
            loadDialogTimelinePage(db, tgChatId, page, limit),
            db.collection('dialogs').findOne({ tgDialogId: String(tgChatId) }),
        ]);

        res.status(200).json({
            chatId: String(tgChatId),
            timeline,
            pagination: {
                current: page,
                total: totalPages,
                totalCount,
                limit,
            },
            dialogType: {
                isUser: dialog?.isUser ?? false,
                isGroup: dialog?.isGroup ?? false,
                isChannel: dialog?.isChannel ?? false,
            },
        });
    } catch (error) {
        console.error('Error fetching dialog timeline:', error);
        res.status(500).json({ message: 'Failed to fetch dialog timeline' });
    }
});

app.get(ROUTES.api.messageSearch, async (req, res) => {
    const query = String(req.query.q || '').trim();
    const chatId = typeof req.query.chatId === 'string' ? req.query.chatId.trim() : undefined;
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 20, 100);

    try {
        const db = await getMongoDbClient();
        const { messages, totalPages, totalCount } = await loadArchivedMessageSearchPage(db, query, page, limit, chatId);
        res.status(200).json({
            query,
            messages,
            pagination: {
                current: page,
                total: totalPages,
                totalCount,
                limit,
            },
            ...(chatId ? { chatId } : {}),
        });
    } catch (error) {
        console.error('Error searching archived messages:', error);
        res.status(500).json({ message: 'Failed to search messages' });
    }
});

app.get(ROUTES.api.messageContext, async (req, res) => {
    const messageId = parseInt(req.params.id);
    const chatId = typeof req.query.chatId === 'string' ? req.query.chatId.trim() : undefined;

    try {
        const db = await getMongoDbClient();
        const context = await loadMessageContext(db, messageId, 50, chatId);
        if (!context) {
            return res.status(404).json({ message: 'Message not found' });
        }
        res.status(200).json(context);
    } catch (error) {
        console.error('Error loading message context:', error);
        res.status(500).json({ message: 'Failed to load message context' });
    }
});

app.get(ROUTES.api.messageHistory, async (req, res) => {
    const messageId = parseInt(req.params.id);
    const chatId = typeof req.query.chatId === 'string' ? req.query.chatId.trim() : undefined;

    try {
        const db = await getMongoDbClient();
        const payload = await loadMessageHistory(db, messageId, chatId);
        if (!payload) {
            return res.status(404).json({ message: 'Message history not found' });
        }

        res.status(200).json(payload);
    } catch (error) {
        console.error('Error loading message history:', error);
        res.status(500).json({ message: 'Failed to load message history' });
    }
});

app.get(ROUTES.web.dialog, async (req, res) => {
    if (!ensureSpaOr503(res)) return;
    return sendSpa(res);
});

app.get(ROUTES.web.dialogMessages, async (req, res) => {
    if (!ensureSpaOr503(res)) return;
    return sendSpa(res);
});

app.get(ROUTES.web.dialogTimeline, async (req, res) => {
    if (!ensureSpaOr503(res)) return;
    return sendSpa(res);
});

app.get(ROUTES.web.messageSearch, async (req, res) => {
    if (!ensureSpaOr503(res)) return;
    return sendSpa(res);
});

app.get(ROUTES.web.message, async (req, res) => {
    if (!ensureSpaOr503(res)) return;
    return sendSpa(res);
});

app.get(ROUTES.web.messageHistory, async (req, res) => {
    if (!ensureSpaOr503(res)) return;
    return sendSpa(res);
});

app.get('/media/:key', async (req, res) => {
    try {
        const stream = await minioClient.getObject(
            process.env.MINIO_BUCKET_NAME || 'tg-archive',
            req.params.key
        );

        // Get object info to set correct content type
        const stat = await minioClient.statObject(
            process.env.MINIO_BUCKET_NAME || 'tg-archive',
            req.params.key
        );

        const requestedFileName = typeof req.query.filename === 'string' ? req.query.filename.trim() : undefined;
        const encodedFileName = stat.metaData['original-filename'];
        let originalFileName: string | undefined;
        if (encodedFileName) {
            try {
                originalFileName = Buffer.from(encodedFileName, 'base64').toString('utf-8');
            } catch {
                originalFileName = undefined;
            }
        }

        let contentType = stat.metaData['content-type'] || 'application/octet-stream';
        const typeHint = requestedFileName || originalFileName;
        if (contentType === 'application/octet-stream' && typeHint?.toLowerCase().endsWith('.pdf')) {
            contentType = 'application/pdf';
        }

        const downloadName = requestedFileName || originalFileName || req.params.key;
        const encodedDownloadName = encodeURIComponent(downloadName);

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedDownloadName}`);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        stream.pipe(res);
    } catch (error) {
        console.error('Error serving media:', error);
        res.status(404).send('Media not found');
    }
});

app.listen(port, () => {
    console.log(`Admin interface running at http://localhost:${port}`);
});

process.on('SIGINT', async () => {
    await closeMongoDbClient();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await closeMongoDbClient();
    process.exit(0);
});
