import { state, getRenderApp } from '../../state';
import { recordHistory } from '../../history';
import { serializeDocument } from '../../serialization';
import { clearChatConversation } from '../../chat/chat';
import { buildDocumentEditCliSimRequest, copyChatMessageToHvySection, runDocumentEditCliSimStep } from '../../chat/chat-session';
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

const prepareChatCliSim: AppActionHandler = () => {
  const request = state.chat.draft.trim();
  if (!request) {
    state.chat.error = 'Type a change request before preparing CLI sim.';
    getRenderApp()();
    return;
  }
  state.chat.cliSim = {
    requestPayload: null,
    requestJson: 'Preparing...',
    responseJson: '',
    reasoningSummary: '',
    isPreparing: true,
    isSending: false,
    error: null,
  };
  state.chat.error = null;
  getRenderApp()();
  void buildDocumentEditCliSimRequest({
    settings: state.chat.settings,
    document: state.document,
    messages: state.chat.messages,
    request,
  })
    .then((result) => {
      state.chat.cliSim = {
        requestPayload: result.requestPayload,
        requestJson: result.requestJson,
        responseJson: '',
        reasoningSummary: '',
        isPreparing: false,
        isSending: false,
        error: null,
      };
      getRenderApp()();
    })
    .catch((error: unknown) => {
      state.chat.cliSim = {
        requestPayload: null,
        requestJson: '',
        responseJson: '',
        reasoningSummary: '',
        isPreparing: false,
        isSending: false,
        error: error instanceof Error ? error.message : 'Failed to prepare CLI sim.',
      };
      getRenderApp()();
    });
};

const runChatCliSimStep: AppActionHandler = () => {
  const sim = state.chat.cliSim;
  const requestPayload = sim?.requestPayload;
  if (!requestPayload) {
    state.chat.error = 'Prepare CLI sim before requesting a response.';
    getRenderApp()();
    return;
  }
  state.chat.cliSim = {
    ...sim,
    isSending: true,
    error: null,
  };
  getRenderApp()();
  void runDocumentEditCliSimStep({ requestPayload })
    .then((result) => {
      if (!state.chat.cliSim) {
        return;
      }
      state.chat.cliSim = {
        ...state.chat.cliSim,
        responseJson: result.responseJson,
        reasoningSummary: result.reasoningSummary,
        isSending: false,
        error: null,
      };
      getRenderApp()();
    })
    .catch((error: unknown) => {
      if (!state.chat.cliSim) {
        return;
      }
      state.chat.cliSim = {
        ...state.chat.cliSim,
        isSending: false,
        error: error instanceof Error ? error.message : 'CLI sim request failed.',
      };
      getRenderApp()();
    });
};

export const chatActions: Record<string, AppActionHandler> = {
  'clear-chat-history': clearChatHistory,
  'copy-chat-response-to-hvy': copyChatResponseToHvy,
  'cancel-chat-request': cancelChatRequest,
  'prepare-chat-cli-sim': prepareChatCliSim,
  'run-chat-cli-sim-step': runChatCliSimStep,
};
