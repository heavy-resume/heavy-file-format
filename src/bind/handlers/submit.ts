import { state, getRenderApp, getRefreshReaderPanels, recordHistory, serializeDocument, appendUserChatMessage, requestChatTurn, requestDocumentEditChatTurn, submitAiEditRequest, submitCliCommand, restoreCliViewAfterRender } from './_imports';

export function bindSubmit(app: HTMLElement): void {
  app.addEventListener('submit', async (event) => {
    const form = event.target as HTMLElement | null;
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

      const previousMessages = state.chat.messages;
      const nextMessages = appendUserChatMessage(previousMessages, question);

      state.chat.messages = nextMessages;
      state.chat.draft = '';
      state.chat.error = null;
      state.chat.isSending = true;
      state.chat.requestNonce += 1;
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
                  state.chat.messages = [...state.chat.messages, message];
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
