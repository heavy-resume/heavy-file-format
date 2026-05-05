import { state, getRefreshReaderPanels, getRenderApp } from './state';
import { findBlockByIds } from './block-ops';
import { findSectionByKey } from './section-ops';
import { recordHistory } from './history';
import { serializeDocument } from './serialization';
import { appendUserChatMessage, requestDocumentEditChatTurn } from './chat/chat-session';
import { resolveBaseComponent } from './component-defs';
import { findVirtualDirectoryForBlock } from './cli-core/virtual-file-system';
import { getAiEditComponentGuidance } from './ai-edit-guidance';
import type { ChatMessage } from './types';

export function openAiEditPopover(sectionKey: string, blockId: string, clientX: number, clientY: number): void {
  const { x, y } = clampAiEditPopoverPosition(clientX, clientY);
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

function clampAiEditPopoverPosition(clientX: number, clientY: number): { x: number; y: number } {
  const width = 420;
  const height = 420;
  const margin = 16;
  const maxX = Math.max(margin, window.innerWidth - width - margin);
  const maxY = Math.max(margin, window.innerHeight - height - margin);
  return {
    x: Math.min(Math.max(clientX, margin), maxX),
    y: Math.min(Math.max(clientY, margin), maxY),
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

  state.aiEdit.isSending = true;
  state.aiEdit.error = null;
  state.aiEdit.requestNonce += 1;
  const requestNonce = state.aiEdit.requestNonce;
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
      selectedComponent: {
        path: componentPath,
        sectionTitle: section.title,
        component: block.schema.component,
        baseComponent: resolveBaseComponent(block.schema.component),
        schemaId: block.schema.id,
        guidance: getAiEditComponentGuidance(block),
      },
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
      state.aiEdit.error = result.error;
    } else {
      closeAiEditPopover();
      getRefreshReaderPanels()();
    }
    getRenderApp()();
  } catch (error) {
    if (requestNonce !== state.aiEdit.requestNonce) {
      return;
    }
    state.aiEdit.error = error instanceof Error ? error.message : 'AI component update failed.';
    state.chat.error = state.aiEdit.error;
    getRenderApp()();
  } finally {
    if (requestNonce !== state.aiEdit.requestNonce) {
      return;
    }
    if (chatRequestNonce === state.chat.requestNonce) {
      state.chat.abortController = null;
      state.chat.isSending = false;
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
