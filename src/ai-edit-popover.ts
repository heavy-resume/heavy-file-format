import { state, getRefreshReaderPanels, getRenderApp } from './state';
import { findBlockByIds } from './block-ops';
import { findSectionByKey } from './section-ops';
import { recordHistory } from './history';
import { serializeDocument } from './serialization';
import { appendUserChatMessage, buildDocumentEditCliSimRequest, requestDocumentEditChatTurn } from './chat/chat-session';
import { resolveBaseComponent } from './component-defs';
import { findVirtualDirectoryForBlock } from './cli-core/virtual-file-system';
import { getAiEditComponentGuidance } from './ai-edit-guidance';
import type { ChatMessage } from './types';

export function openAiEditPopover(sectionKey: string, blockId: string, frameX: number, frameY: number): void {
  const { x, y } = clampAiEditPopoverPosition(frameX, frameY);
  state.aiEdit = {
    sectionKey,
    blockId,
    draft: '',
    isSending: false,
    error: null,
    popupX: x,
    popupY: y,
    requestNonce: state.aiEdit.requestNonce + 1,
  };
  state.chat.panelOpen = false;
}

export function closeAiEditPopover(): void {
  state.aiEdit = {
    sectionKey: null,
    blockId: null,
    draft: '',
    isSending: false,
    error: null,
    popupX: 0,
    popupY: 0,
    requestNonce: state.aiEdit.requestNonce + 1,
  };
}

function clampAiEditPopoverPosition(frameX: number, frameY: number): { x: number; y: number } {
  const shell = document.querySelector<HTMLElement>('.viewer-shell');
  const shellRect = shell?.getBoundingClientRect();
  const frameWidth = shell?.clientWidth || shellRect?.width || window.innerWidth;
  const frameHeight = shell?.clientHeight || shellRect?.height || window.innerHeight;
  const margin = 16;
  const width = Math.min(420, Math.max(0, frameWidth - margin * 2));
  const height = 420;
  const maxX = Math.max(margin, frameWidth - width - margin);
  const maxY = Math.max(margin, frameHeight - height - margin);
  const centeredX = Math.max(margin, (frameWidth - width) / 2);
  return {
    x: frameWidth <= 520 ? Math.round(centeredX) : Math.min(Math.max(frameX, margin), maxX),
    y: Math.min(Math.max(frameY, margin), maxY),
  };
}

export async function submitAiEditRequest(): Promise<void> {
  if (state.aiEdit.isSending) {
    return;
  }

  const sectionKey = state.aiEdit.sectionKey;
  const blockId = state.aiEdit.blockId;
  if (!sectionKey || !blockId) {
    return;
  }

  const request = state.aiEdit.draft.trim();
  if (request.length === 0) {
    return;
  }

  if (state.chat.settings.model.trim().length === 0) {
    state.aiEdit.error = 'Choose a model before sending.';
    getRenderApp()();
    return;
  }
  if (state.chat.isSending) {
    state.aiEdit.error = 'Wait for the current chat request to finish.';
    getRenderApp()();
    return;
  }

  const block = findBlockByIds(sectionKey, blockId);
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!block || !section) {
    state.aiEdit.error = 'The selected component could not be found.';
    getRenderApp()();
    return;
  }
  const componentPath = findVirtualDirectoryForBlock(state.document, block);
  if (!componentPath) {
    state.aiEdit.error = 'The selected component could not be located in the CLI filesystem.';
    getRenderApp()();
    return;
  }
  const selectedComponent = {
    path: componentPath,
    sectionTitle: section.title,
    component: block.schema.component,
    baseComponent: resolveBaseComponent(block.schema.component),
    schemaId: block.schema.id,
    guidance: getAiEditComponentGuidance(block),
  };

  if (state.chat.cliSimEnabled) {
    state.aiEdit.isSending = true;
    state.aiEdit.error = null;
    state.aiEdit.requestNonce += 1;
    const requestNonce = state.aiEdit.requestNonce;
    state.aiEdit.sectionKey = null;
    state.aiEdit.blockId = null;
    state.aiEdit.draft = '';
    state.chat.panelOpen = true;
    state.chat.error = null;
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
    getRenderApp()();
    try {
      const result = await buildDocumentEditCliSimRequest({
        settings: state.chat.settings,
        document: state.document,
        messages: state.chat.messages,
        request,
        selectedComponent,
      });
      if (requestNonce !== state.aiEdit.requestNonce) {
        return;
      }
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
      if (requestNonce !== state.aiEdit.requestNonce) {
        return;
      }
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
    } finally {
      if (requestNonce === state.aiEdit.requestNonce) {
        state.aiEdit.isSending = false;
      }
      getRenderApp()();
    }
    return;
  }

  state.aiEdit.isSending = true;
  state.aiEdit.error = null;
  state.aiEdit.requestNonce += 1;
  const requestNonce = state.aiEdit.requestNonce;
  state.aiEdit.sectionKey = null;
  state.aiEdit.blockId = null;
  state.aiEdit.draft = '';
  const previousMessages = state.chat.messages;
  state.chat.messages = appendUserChatMessage(previousMessages, request);
  state.chat.panelOpen = true;
  state.chat.error = null;
  state.chat.isSending = true;
  state.chat.requestNonce += 1;
  const chatRequestNonce = state.chat.requestNonce;
  const abortController = new AbortController();
  state.chat.abortController = abortController;
  getRenderApp()();

  try {
    let recordedMutation = false;
    const recordCliMutation = (): void => {
      if (recordedMutation) {
        return;
      }
      recordedMutation = true;
      recordHistory(`ai-edit-cli:${requestNonce}`);
    };
    const result = await requestDocumentEditChatTurn({
      settings: state.chat.settings,
      document: state.document,
      request,
      messages: previousMessages,
      selectedComponent,
      onMutation: recordCliMutation,
      onProgress: (message) => {
        if (
          requestNonce !== state.aiEdit.requestNonce
          || chatRequestNonce !== state.chat.requestNonce
          || abortController.signal.aborted
        ) {
          return;
        }
        state.chat.messages = upsertAiEditChatProgressMessage(state.chat.messages, message);
        getRenderApp()();
      },
      signal: abortController.signal,
    });
    if (
      requestNonce !== state.aiEdit.requestNonce
      || chatRequestNonce !== state.chat.requestNonce
      || abortController.signal.aborted
    ) {
      return;
    }

    state.chat.messages = result.messages;
    state.chat.error = result.error;
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    if (result.error) {
      state.chat.error = result.error;
    } else {
      closeAiEditPopover();
      if (!result.awaitingUser) {
        state.chat.panelOpen = false;
      }
      getRefreshReaderPanels()();
    }
    getRenderApp()();
  } catch (error) {
    if (requestNonce !== state.aiEdit.requestNonce) {
      return;
    }
    state.chat.error = error instanceof Error ? error.message : 'AI component update failed.';
    getRenderApp()();
  } finally {
    if (chatRequestNonce === state.chat.requestNonce) {
      state.chat.abortController = null;
      state.chat.isSending = false;
    }
    if (requestNonce !== state.aiEdit.requestNonce) {
      getRenderApp()();
      return;
    }
    state.aiEdit.isSending = false;
    getRenderApp()();
  }
}

function upsertAiEditChatProgressMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const existingIndex = messages.findIndex((candidate) => candidate.id === message.id);
  if (existingIndex < 0) {
    return [...messages, message];
  }
  return messages.map((candidate, index) => (index === existingIndex ? message : candidate));
}
