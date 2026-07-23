import { state, getRenderApp } from '../../state';
import { recordHistory } from '../../history';
import { serializeDocument } from '../../serialization';
import { copyTextToClipboard } from '../../clipboard';
import { clearChatConversation, ENABLE_CHAT_CLI_SIM, stopChatRequest } from '../../chat/chat';
import { buildChatResponseRichTextCopyPayload } from '../../chat/chat-response-document';
import { prepareEmbeddingChatContext } from '../../chat/embedding-context';
import { advanceDocumentEditCliSimStep, copyChatMessageToHvySection, runDocumentEditCliSimStep, type DocumentEditCliSimRequest } from '../../chat/chat-session';
import type { AppActionHandler } from './types';

const clearChatHistory: AppActionHandler = () => {
  clearChatConversation(state.chat);
  getRenderApp()();
};

const copyChatResponseToHvy: AppActionHandler = ({ actionButton }) => {
  closeChatCopyMenu(actionButton);
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

const copyChatResponseText: AppActionHandler = ({ actionButton }) => {
  closeChatCopyMenu(actionButton);
  const messageId = actionButton?.dataset.messageId ?? '';
  const message = state.chat.messages.find((candidate) => candidate.id === messageId);
  if (!message || message.role !== 'assistant' || message.error) {
    state.chat.error = 'Only successful assistant messages can be copied.';
    getRenderApp()();
    return;
  }
  const content = message.content.trim();
  if (!content) {
    state.chat.error = 'Message has no content to copy.';
    getRenderApp()();
    return;
  }
  const payload = buildChatResponseRichTextCopyPayload(content);
  if (!payload) {
    state.chat.error = 'Could not copy response as text.';
    getRenderApp()();
    return;
  }
  void copyTextToClipboard(payload).then((ok) => {
    if (!ok) {
      state.chat.error = 'Copy failed.';
      getRenderApp()();
      return;
    }
    state.chat.error = null;
    markChatCopyMenuCopied(actionButton);
  });
};

function closeChatCopyMenu(actionButton: HTMLElement): void {
  const menu = actionButton.closest<HTMLDetailsElement>('.chat-copy-menu');
  if (menu) {
    menu.open = false;
  }
}

function markChatCopyMenuCopied(actionButton: HTMLElement): void {
  const bubble = actionButton.closest<HTMLElement>('.chat-bubble');
  const toggle = bubble?.querySelector<HTMLElement>('.chat-copy-menu-toggle');
  if (!toggle) {
    return;
  }
  toggle.classList.add('is-copied');
  toggle.setAttribute('aria-label', 'Copied response');
  toggle.setAttribute('title', 'Copied response');
  window.setTimeout(() => {
    toggle.classList.remove('is-copied');
    toggle.setAttribute('aria-label', 'Copy options');
    toggle.setAttribute('title', 'Copy options');
  }, 1200);
}

const cancelChatRequest: AppActionHandler = () => {
  if (stopChatRequest(state.chat)) {
    getRenderApp()();
  }
};

const toggleChatCliSim: AppActionHandler = () => {
  if (!ENABLE_CHAT_CLI_SIM) {
    state.chat.cliSimEnabled = false;
    state.chat.cliSim = null;
    state.chat.error = null;
    getRenderApp()();
    return;
  }
  state.chat.cliSimEnabled = !state.chat.cliSimEnabled;
  state.chat.error = null;
  if (!state.chat.cliSimEnabled) {
    state.chat.cliSim = null;
  }
  getRenderApp()();
};

const runChatCliSimStep: AppActionHandler = () => {
  if (!ENABLE_CHAT_CLI_SIM) {
    state.chat.cliSimEnabled = false;
    state.chat.cliSim = null;
    state.chat.error = null;
    getRenderApp()();
    return;
  }
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
      ...(sim.toolTurn ? { toolTurn: sim.toolTurn as Parameters<typeof advanceDocumentEditCliSimStep>[0]['toolTurn'] } : {}),
    })
      .then((result) => {
        if (!state.chat.cliSim) {
          return;
        }
        if (result.mutated) {
          recordHistory('chat-cli-sim');
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
          toolTurn: undefined,
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
        responseOutput: result.toolTurn?.toolCalls.length ? '(native tool calls ready)' : result.output,
        toolTurn: result.toolTurn,
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

const buildChatEmbeddings: AppActionHandler = () => {
  if (state.chat.isSending) {
    return;
  }
  if (state.chatContext?.mode !== 'embedding-retrieval') {
    state.chat.error = 'Select embedding retrieval before building embeddings.';
    getRenderApp()();
    return;
  }
  if (!state.embeddingProvider) {
    state.chat.error = 'Embedding provider is not configured.';
    getRenderApp()();
    return;
  }
  if (state.document.extension !== '.hvy') {
    state.chat.error = 'Embedding caches can only be attached to .hvy documents.';
    getRenderApp()();
    return;
  }
  const abortController = new AbortController();
  state.chat.isSending = true;
  state.chat.abortController = abortController;
  state.chat.status = 'Building embedding cache...';
  state.chat.error = null;
  getRenderApp()();
  const startedAt = Date.now();
  void prepareEmbeddingChatContext(state.document, {
    ...state.chatContext,
    mode: 'embedding-retrieval',
    embeddingModel: state.chatContext.embeddingModel?.trim() || 'text-embedding-ada-002',
    persistEmbeddingsToAttachments: true,
  }, state.embeddingProvider, abortController.signal)
    .then((stats) => {
      state.chat.status = formatEmbeddingBuildStatus(stats, Date.now() - startedAt);
      state.chat.error = null;
    })
    .catch((error: unknown) => {
      state.chat.status = null;
      state.chat.error = error instanceof Error ? error.message : 'Embedding cache build failed.';
    })
    .finally(() => {
      if (state.chat.abortController === abortController) {
        state.chat.abortController = null;
      }
      state.chat.isSending = false;
      getRenderApp()();
    });
};

function formatEmbeddingBuildStatus(
  stats: { totalChunks: number; reusedChunks: number; rebuiltChunks: number; missingVectors: number; alreadyPrepared: boolean },
  elapsedMs: number
): string {
  const elapsed = elapsedMs >= 1_000 ? `${(elapsedMs / 1_000).toFixed(1)}s` : `${Math.max(0, elapsedMs)}ms`;
  const suffix = stats.missingVectors > 0 ? `, ${stats.missingVectors} missing` : '';
  if (stats.alreadyPrepared) {
    return `Embedding cache unchanged: rebuilt 0, reused ${stats.reusedChunks}/${stats.totalChunks} chunks (${elapsed}).`;
  }
  return `Embedding cache ready for next save: rebuilt ${stats.rebuiltChunks}, reused ${stats.reusedChunks}/${stats.totalChunks} chunks${suffix} (${elapsed}).`;
}

export const chatActions: Record<string, AppActionHandler> = {
  'clear-chat-history': clearChatHistory,
  'copy-chat-response-to-hvy': copyChatResponseToHvy,
  'copy-chat-response-text': copyChatResponseText,
  'cancel-chat-request': cancelChatRequest,
  'toggle-chat-cli-sim': toggleChatCliSim,
  'run-chat-cli-sim-step': runChatCliSimStep,
  'build-chat-embeddings': buildChatEmbeddings,
};
