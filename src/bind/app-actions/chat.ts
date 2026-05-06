import { state, getRenderApp } from '../../state';
import { recordHistory } from '../../history';
import { serializeDocument } from '../../serialization';
import { clearChatConversation } from '../../chat/chat';
import { advanceDocumentEditCliSimStep, copyChatMessageToHvySection, runDocumentEditCliSimStep, type DocumentEditCliSimRequest } from '../../chat/chat-session';
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

const toggleChatCliSim: AppActionHandler = () => {
  state.chat.cliSimEnabled = !state.chat.cliSimEnabled;
  state.chat.error = null;
  if (!state.chat.cliSimEnabled) {
    state.chat.cliSim = null;
  }
  getRenderApp()();
};

const runChatCliSimStep: AppActionHandler = () => {
  const sim = state.chat.cliSim;
  if (!sim?.requestPayload && !sim?.responseOutput) {
    state.chat.error = 'Prepare CLI sim before requesting a response.';
    getRenderApp()();
    return;
  }
  if (sim.responseOutput) {
    if (!sim.turnState) {
      state.chat.error = 'CLI sim is missing its turn state. Prepare the sim again.';
      getRenderApp()();
      return;
    }
    state.chat.cliSim = {
      ...sim,
      isPreparing: true,
      error: null,
    };
    getRenderApp()();
    void advanceDocumentEditCliSimStep({
      settings: state.chat.settings,
      document: state.document,
      turnState: sim.turnState as DocumentEditCliSimRequest['turnState'],
      assistantOutput: sim.responseOutput,
    })
      .then((result) => {
        if (!state.chat.cliSim) {
          return;
        }
        if (result.mutated) {
          state.rawEditorText = serializeDocument(state.document);
          state.rawEditorError = null;
          state.rawEditorDiagnostics = [];
        }
        state.chat.cliSim = {
          ...state.chat.cliSim,
          requestPayload: result.requestPayload,
          requestJson: result.requestJson || '(terminal response; no next request)',
          responseJson: '',
          responseOutput: '',
          commandResultMessage: result.commandResultMessage,
          turnState: result.turnState,
          isPreparing: false,
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
          isPreparing: false,
          error: error instanceof Error ? error.message : 'CLI sim next step failed.',
        };
        getRenderApp()();
      });
    return;
  }
  const requestPayload = sim.requestPayload;
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
        responseOutput: result.output,
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
  'toggle-chat-cli-sim': toggleChatCliSim,
  'run-chat-cli-sim-step': runChatCliSimStep,
};
