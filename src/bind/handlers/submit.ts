import { state, getRenderApp, recordHistory, serializeDocument, appendUserChatMessage, requestChatTurn, requestDocumentEditChatTurn, submitAiEditRequest } from './_imports';

export function bindSubmit(app: HTMLElement): void {
  app.addEventListener('submit', async (event) => {
    const form = event.target as HTMLElement | null;
    if (form?.id === 'chatComposer') {
      event.preventDefault();
      if (state.chat.isSending) {
        return;
      }

      const question = state.chat.draft.trim();
      if (question.length === 0) {
        return;
      }

      if (state.chat.settings.model.trim().length === 0) {
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
      getRenderApp()();

      try {
        const isDocumentEditChat = state.currentView !== 'viewer';
        const result =
          isDocumentEditChat
            ? await requestDocumentEditChatTurn({
                settings: state.chat.settings,
                document: state.document,
                messages: previousMessages,
                request: question,
                onMutation: (group) => recordHistory(group),
                onProgress: (message) => {
                  if (requestNonce !== state.chat.requestNonce || abortController.signal.aborted) {
                    return;
                  }
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
        if (requestNonce !== state.chat.requestNonce || abortController.signal.aborted) {
          return;
        }
        state.chat.messages = result.messages;
        state.chat.error = result.error;
        if (isDocumentEditChat && !result.error) {
          state.rawEditorText = serializeDocument(state.document);
          state.rawEditorError = null;
          state.rawEditorDiagnostics = [];
        }
      } finally {
        if (requestNonce !== state.chat.requestNonce) {
          return;
        }
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
  });
}
