import { state, getRenderApp } from '../../state';
import { recordHistory } from '../../history';
import { serializeDocument } from '../../serialization';
import { clearChatConversation } from '../../chat/chat';
import { copyChatMessageToHvySection } from '../../chat/chat-session';
import type { AppActionHandler } from './types';

const clearChatHistory: AppActionHandler = () => {
  clearChatConversation(state.chat);
  getRenderApp()();
};

const copyChatResponseToHvy: AppActionHandler = ({ actionButton }) => {
  const messageId = actionButton?.dataset.messageId ?? '';
  const result = copyChatMessageToHvySection({
    messages: state.chat.messages,
    messageId,
  });
  if (result.ok === false) {
    state.chat.error = result.error;
    getRenderApp()();
    return;
  }
  recordHistory('chat:copy-to-hvy');
  state.document.sections.push(result.section);
  state.rawEditorText = serializeDocument(state.document);
  state.rawEditorError = null;
  state.rawEditorDiagnostics = [];
  state.chat.error = null;
  getRenderApp()();
};

const cancelChatRequest: AppActionHandler = () => {
  if (!state.chat.isSending) {
    return;
  }
  state.chat.abortController?.abort();
  state.chat.abortController = null;
  state.chat.isSending = false;
  state.chat.requestNonce += 1;
  state.chat.error = null;
  state.chat.messages = [
    ...state.chat.messages,
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Stopped.',
      progress: true,
    },
  ];
  getRenderApp()();
};

export const chatActions: Record<string, AppActionHandler> = {
  'clear-chat-history': clearChatHistory,
  'copy-chat-response-to-hvy': copyChatResponseToHvy,
  'cancel-chat-request': cancelChatRequest,
};
