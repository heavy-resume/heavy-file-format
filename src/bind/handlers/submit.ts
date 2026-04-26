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
      getRenderApp()();

      try {
        const result =
          state.currentView === 'ai'
            ? await requestDocumentEditChatTurn({
                settings: state.chat.settings,
                document: state.document,
                messages: previousMessages,
                request: question,
                onMutation: (group) => recordHistory(group),
              })
            : await requestChatTurn({
                settings: state.chat.settings,
                document: state.document,
                messages: previousMessages,
                question,
              });
        if (requestNonce !== state.chat.requestNonce) {
          return;
        }
        state.chat.messages = result.messages;
        state.chat.error = result.error;
        if (state.currentView === 'ai' && !result.error) {
          state.rawEditorText = serializeDocument(state.document);
          state.rawEditorError = null;
          state.rawEditorDiagnostics = [];
        }
      } finally {
        if (requestNonce !== state.chat.requestNonce) {
          return;
        }
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
