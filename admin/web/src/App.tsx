import { useRouter } from './hooks/useRouter';
import { useAgentStatus } from './hooks/useAgentStatus';
import { useDialogs } from './hooks/useDialogs';
import { useDialogDetail } from './hooks/useDialogDetail';
import { useMessages, useMessageContext, useArchivedMessageSearch, useDialogTimeline, useMessageHistory } from './hooks/useMessages';
import { dialogDisplayTitle } from './lib/format';
import { NavBar } from './components/layout/NavBar';
import { AgentDrawer } from './components/layout/AgentDrawer';
import { HomePage } from './components/home/HomePage';
import { DialogDetailPage } from './components/dialog/DialogDetailPage';
import { MessagesPage } from './components/messages/MessagesPage';
import { TimelinePage } from './components/messages/TimelinePage';
import { MessageHistoryPage } from './components/messages/MessageHistoryPage';
import { SearchPage } from './components/messages/SearchPage';
import { NotFoundPage } from './components/NotFoundPage';

export function App() {
  const route = useRouter();
  const agent = useAgentStatus();
  const dialogsStore = useDialogs();
  const routeChatId = route.name === 'dialog' || route.name === 'messages' || route.name === 'timeline'
    ? route.chatId
    : route.name === 'messageHistory'
      ? route.chatId || null
    : route.name === 'search'
      ? route.chatId || null
      : null;

  const dialogChatId = route.name === 'dialog' ? route.chatId : null;
  const detail = useDialogDetail(dialogChatId);

  const messagesChatId = route.name === 'messages' ? route.chatId : null;
  const messagesPage = route.name === 'messages' ? route.page : null;
  const msgs = useMessages(messagesChatId, messagesPage);

  const timelineChatId = route.name === 'timeline' ? route.chatId : null;
  const timelinePage = route.name === 'timeline' ? route.page : null;
  const timeline = useDialogTimeline(timelineChatId, timelinePage);

  const searchQuery = route.name === 'search' ? route.query : null;
  const searchPage = route.name === 'search' ? route.page : null;
  const searchChatId = route.name === 'search' ? route.chatId || null : null;
  const search = useArchivedMessageSearch(searchQuery, searchPage, searchChatId);

  const messageContextId = route.name === 'message' ? route.messageId : null;
  const messageContextChatId = route.name === 'message' ? route.chatId || null : null;
  const msgContext = useMessageContext(messageContextId, messageContextChatId);

  const messageHistoryId = route.name === 'messageHistory' ? route.messageId : null;
  const messageHistoryChatId = route.name === 'messageHistory' ? route.chatId || null : null;
  const msgHistory = useMessageHistory(messageHistoryId, messageHistoryChatId);

  // For dialog detail view: compute message side based on dialog data
  const detailGetSide = detail.dialog
    ? (() => {
        const isUserChat = detail.dialog.isUser;
        const isGroupOrChannel = detail.dialog.isGroup || detail.dialog.isChannel;
        const peerId = detail.dialog.tgDialogId;
        const isOneToOne = !!(isUserChat && !isGroupOrChannel && peerId);
        return (msg: any) => {
          if (!isOneToOne || !msg.sender?.id) return 'left' as const;
          const numericSenderId = msg.sender.id.replace(/^user/, '');
          return numericSenderId === peerId ? 'left' as const : 'right' as const;
        };
      })()
    : () => 'left' as const;

  function isSameSenderAsPrev(messages: any[], idx: number): boolean {
    if (idx === 0) return false;
    const prev = messages[idx - 1];
    const curr = messages[idx];
    if (prev.type === 'service' || curr.type === 'service') return false;
    return prev.sender?.name === curr.sender?.name;
  }

  const routeDialog = routeChatId ? dialogsStore.dialogs.find((dialog) => dialog.tgDialogId === routeChatId) || null : null;
  const dialogTitle = route.name === 'dialog'
    ? (detail.dialog ? dialogDisplayTitle(detail.dialog) : '')
    : routeDialog
      ? dialogDisplayTitle(routeDialog)
      : '';
  const dialogMessageCount = route.name === 'dialog'
    ? routeDialog?.messageCount ?? detail.dialog?.messageCount
    : routeDialog?.messageCount;
  const viewError = detail.error || msgs.error || timeline.error || msgContext.error || msgHistory.error;

  return (
    <div className="min-h-screen">
      <NavBar
        route={route}
        agentState={agent.agentStatus.state}
        dialogTitle={dialogTitle}
        searchScopeChatId={routeChatId}
        searchScopeTitle={dialogTitle}
        onAgentClick={() => agent.setDrawerOpen(!agent.drawerOpen)}
        agentDrawerOpen={agent.drawerOpen}
      />

      <AgentDrawer
        open={agent.drawerOpen}
        onClose={() => agent.setDrawerOpen(false)}
        agentStatus={agent.agentStatus}
        progressLine={agent.progressLine}
        activeChatName={agent.activeChatName}
        activeChatId={agent.activeChatId}
        chatProgressLine={agent.chatProgressLine}
        backfillChatStatsLine={agent.backfillChatStatsLine}
        reconcile={agent.agentStatus.reconcile}
        password={agent.password}
        setPassword={agent.setPassword}
        feedback={agent.feedback}
        isSending={agent.isSending}
        submitTwoFactorPassword={agent.submitTwoFactorPassword}
      />

      {viewError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <p className="text-sm text-red-700">{viewError}</p>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {route.name === 'home' && (
          <HomePage
            dialogs={dialogsStore.dialogs}
            filteredDialogs={dialogsStore.filteredDialogs}
            loading={dialogsStore.loading}
            query={dialogsStore.query}
            onQueryChange={dialogsStore.setQuery}
            statusFilter={dialogsStore.statusFilter}
            onStatusChange={dialogsStore.setStatusFilter}
            typeFilter={dialogsStore.typeFilter}
            onTypeChange={dialogsStore.setTypeFilter}
            liveSyncChatIds={dialogsStore.liveSyncChatIds}
            isLiveSyncSelected={dialogsStore.isLiveSyncSelected}
            dialogActivity={dialogsStore.dialogActivity}
            backfillingCount={dialogsStore.backfillingCount}
            agentState={agent.agentStatus.state}
            recentBackfillRequesting={dialogsStore.recentBackfillRequesting}
            globalBackfillFeedback={dialogsStore.globalBackfillFeedback}
            liveSyncFeedback={dialogsStore.liveSyncFeedback}
            syncConfigSaving={dialogsStore.syncConfigSaving}
            onRequestRecentBackfill={dialogsStore.requestRecentBackfillForLiveSyncChats}
            onBulkLiveSyncChange={dialogsStore.bulkUpdateLiveSync}
          />
        )}

        {route.name === 'dialog' && (
          <DialogDetailPage
            dialog={detail.dialog}
            messages={detail.messages}
            loading={detail.loading}
            refreshing={detail.refreshing}
            onRefresh={detail.reload}
            messageCount={dialogMessageCount}
            liveSyncSelected={dialogsStore.isLiveSyncSelected(route.chatId)}
            syncSaving={dialogsStore.syncConfigSaving || dialogsStore.syncSavingChatIds.includes(route.chatId)}
            onToggleSync={async () => {
              await dialogsStore.toggleLiveSync(route.chatId);
              await Promise.allSettled([detail.reload(), dialogsStore.loadDialogs()]);
            }}
            activity={dialogsStore.dialogActivity(route.chatId)}
            reconcile={agent.agentStatus.reconcile}
            getMessageSide={detailGetSide}
            isSameSenderAsPrev={isSameSenderAsPrev}
          />
        )}

        {route.name === 'messages' && (
          <MessagesPage
            chatId={route.chatId}
            messages={msgs.messages}
            pagination={msgs.pagination}
            loading={msgs.loading}
            activity={dialogsStore.dialogActivity(route.chatId)}
            getMessageSide={msgs.getMessageSide}
            isSameSenderAsPrev={isSameSenderAsPrev}
          />
        )}

        {route.name === 'timeline' && (
          <TimelinePage
            chatId={route.chatId}
            timeline={timeline.timeline}
            pagination={timeline.pagination}
            loading={timeline.loading}
          />
        )}

        {route.name === 'search' && (
          <SearchPage
            query={route.query}
            chatId={route.chatId}
            scopeTitle={dialogTitle}
            messages={search.messages}
            pagination={search.pagination}
            loading={search.loading}
            error={search.error}
          />
        )}

        {route.name === 'messageHistory' && (
          <MessageHistoryPage
            messageId={route.messageId}
            chatId={msgHistory.chatId || route.chatId}
            current={msgHistory.current}
            history={msgHistory.history}
            loading={msgHistory.loading}
          />
        )}

        {route.name === 'notFound' && <NotFoundPage />}
      </main>
    </div>
  );
}
