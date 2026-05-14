import { state, getRenderApp, getRefreshReaderPanels, recordHistory, serializeDocument, appendUserChatMessage, buildDocumentEditCliSimRequest, requestChatTurn, requestDocumentEditChatTurn, saveResumeState, submitAiEditRequest, submitCliCommand, restoreCliViewAfterRender, ENABLE_CHAT_CLI_SIM } from './_imports';
import { applySearchFilter, submitSearch } from '../../search/actions';

export function bindSubmit(app: HTMLElement): void {
  app.addEventListener('submit', async (event) => {
    const form = event.target as HTMLElement | null;
    if (form?.id === 'searchComposer') {
      event.preventDefault();
      if (state.search.activeTab === 'filter') {
        await applySearchFilter({ enabled: true });
        return;
      }
      await submitSearch();
      return;
    }

    if (form?.id === 'chatComposer') {
      event.preventDefault();
      console.debug('[hvy:chat-submit] submit event', {
        isSending: state.chat.isSending,
        currentView: state.currentView,
        draftLength: state.chat.draft.length,
        trimmedDraftLength: state.chat.draft.trim().length,
        provider: state.chat.settings.provider,
        model: state.chat.settings.model,
        requestNonce: state.chat.requestNonce,
      });
      if (state.chat.isSending) {
        console.debug('[hvy:chat-submit] ignored because request is already sending');
        return;
      }

      const question = state.chat.draft.trim();
      if (question.length === 0) {
        console.debug('[hvy:chat-submit] ignored because prompt is empty');
        return;
      }

      if (state.chat.settings.model.trim().length === 0) {
        console.debug('[hvy:chat-submit] blocked because model is empty');
        state.chat.error = 'Choose a model before sending.';
        getRenderApp()();
        return;
      }

      if (state.currentView !== 'viewer' && state.chat.cliSimEnabled && ENABLE_CHAT_CLI_SIM) {
        state.chat.cliSim = {
          requestPayload: null,
          requestJson: 'Preparing...',
          responseJson: '',
          responseOutput: '',
          reasoningSummary: '',
          commandResultMessage: '',
          turnState: null,
          isPreparing: true,
          isSending: false,
          error: null,
        };
        state.chat.error = null;
        getRenderApp()();
        try {
          const result = await buildDocumentEditCliSimRequest({
            settings: state.chat.settings,
            document: state.document,
            messages: state.chat.messages,
            request: question,
          });
          state.chat.cliSim = {
            requestPayload: result.requestPayload,
            requestJson: result.requestJson,
            responseJson: '',
            responseOutput: '',
            reasoningSummary: '',
            commandResultMessage: '',
            turnState: result.turnState,
            isPreparing: false,
            isSending: false,
            error: null,
          };
        } catch (error) {
          state.chat.cliSim = {
            requestPayload: null,
            requestJson: '',
            responseJson: '',
            responseOutput: '',
            reasoningSummary: '',
            commandResultMessage: '',
            turnState: null,
            isPreparing: false,
            isSending: false,
            error: error instanceof Error ? error.message : 'Failed to prepare CLI sim.',
          };
        }
        getRenderApp()();
        return;
      }

      const previousMessages = state.chat.messages;
      const nextMessages = appendUserChatMessage(previousMessages, question);

      state.chat.messages = nextMessages;
      state.chat.draft = '';
      state.chat.error = null;
      state.chat.isSending = true;
      state.chat.requestNonce += 1;
      saveResumeState(state);
      const requestNonce = state.chat.requestNonce;
      const abortController = new AbortController();
      state.chat.abortController = abortController;
      console.debug('[hvy:chat-submit] started request', {
        requestNonce,
        currentView: state.currentView,
        isDocumentEditChat: state.currentView !== 'viewer',
        sections: state.document.sections.length,
      });
      getRenderApp()();

      try {
        const isDocumentEditChat = state.currentView !== 'viewer';
        console.debug('[hvy:chat-submit] dispatching chat turn', {
          requestNonce,
          mode: isDocumentEditChat ? 'document-edit' : 'qa',
        });
        let recordedDocumentEditMutation = false;
        const recordDocumentEditMutation = (): void => {
          if (recordedDocumentEditMutation) {
            return;
          }
          recordedDocumentEditMutation = true;
          recordHistory(`ai-document-edit:${requestNonce}`);
        };
        const result =
          isDocumentEditChat
            ? await requestDocumentEditChatTurn({
                settings: state.chat.settings,
                document: state.document,
                messages: previousMessages,
                request: question,
                onMutation: recordDocumentEditMutation,
                onProgress: (message) => {
                  if (requestNonce !== state.chat.requestNonce || abortController.signal.aborted) {
                    console.debug('[hvy:chat-submit] ignored stale progress', {
                      requestNonce,
                      currentNonce: state.chat.requestNonce,
                      aborted: abortController.signal.aborted,
                      content: message.content,
                    });
                    return;
                  }
                  console.debug('[hvy:chat-submit] progress', {
                    requestNonce,
                    content: message.content,
                  });
                  state.chat.messages = upsertChatProgressMessage(state.chat.messages, message);
                  saveResumeState(state);
                  getRenderApp()();
                },
                signal: abortController.signal,
              })
            : await requestChatTurn({
                settings: state.chat.settings,
                document: state.document,
                messages: previousMessages,
                question,
                signal: abortController.signal,
              });
        console.debug('[hvy:chat-submit] chat turn resolved', {
          requestNonce,
          currentNonce: state.chat.requestNonce,
          aborted: abortController.signal.aborted,
          error: result.error,
          messageCount: result.messages.length,
        });
        if (requestNonce !== state.chat.requestNonce || abortController.signal.aborted) {
          console.debug('[hvy:chat-submit] dropping result because request is stale or aborted', {
            requestNonce,
            currentNonce: state.chat.requestNonce,
            aborted: abortController.signal.aborted,
          });
          return;
        }
        state.chat.messages = result.messages;
        state.chat.error = result.error;
        saveResumeState(state);
        if (isDocumentEditChat && !result.error) {
          state.rawEditorText = serializeDocument(state.document);
          state.rawEditorError = null;
          state.rawEditorDiagnostics = [];
          if (recordedDocumentEditMutation && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }
      } finally {
        if (requestNonce !== state.chat.requestNonce) {
          console.debug('[hvy:chat-submit] leaving newer request state untouched', {
            requestNonce,
            currentNonce: state.chat.requestNonce,
          });
          return;
        }
        console.debug('[hvy:chat-submit] finished request', {
          requestNonce,
          aborted: abortController.signal.aborted,
        });
        state.chat.abortController = null;
        state.chat.isSending = false;
        saveResumeState(state);
        getRenderApp()();
      }
      return;
    }

    if (form?.id === 'aiEditComposer') {
      event.preventDefault();
      await submitAiEditRequest();
    }

    if (form?.id === 'cliComposer') {
      event.preventDefault();
      await submitCliCommand({
        state,
        command: state.cliDraft,
        recordHistory,
        refreshReaderPanels: getRefreshReaderPanels(),
      });
      state.rawEditorText = serializeDocument(state.document);
      state.rawEditorError = null;
      state.rawEditorDiagnostics = [];
      getRenderApp()();
      restoreCliViewAfterRender();
    }
  });
}

function upsertChatProgressMessage(messages: typeof state.chat.messages, message: typeof state.chat.messages[number]): typeof state.chat.messages {
  const existingIndex = messages.findIndex((candidate) => candidate.id === message.id);
  if (existingIndex < 0) {
    return [...messages, message];
  }
  return messages.map((candidate, index) => (index === existingIndex ? message : candidate));
}
