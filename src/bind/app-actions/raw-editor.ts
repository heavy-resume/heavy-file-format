import { state, getRenderApp } from '../../state';
import { recordHistory } from '../../history';
import { closeModal, resetTransientUiState } from '../../navigation';
import { deserializeDocument, serializeDocument } from '../../serialization';
import { detectExtension } from '../../utils';
import { clearChatConversation } from '../../chat/chat';
import { getRawEditorDiagnostics } from '../../raw-editor-diagnostics';
import type { AppActionHandler } from './types';

const resetRawEditor: AppActionHandler = () => {
  state.rawEditorText = serializeDocument(state.document);
  state.rawEditorError = null;
  state.rawEditorDiagnostics = [];
  getRenderApp()();
};

const applyRawEditor: AppActionHandler = () => {
  const diagnostics = getRawEditorDiagnostics(state.rawEditorText, state.filename);
  state.rawEditorDiagnostics = diagnostics;
  if (diagnostics.length > 0) {
    state.rawEditorError = 'Resolve the raw HVY issues before applying.';
    getRenderApp()();
    return;
  }
  try {
    recordHistory('raw-editor:apply');
    const previousAttachments = state.document.attachments;
    state.document = deserializeDocument(
      state.rawEditorText,
      detectExtension(state.filename, state.rawEditorText)
    );
    for (const next of state.document.attachments) {
      if (next.bytes.length === 0) {
        const previous = previousAttachments.find((entry) => entry.id === next.id);
        if (previous) {
          next.bytes = previous.bytes;
        }
      }
    }
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    clearChatConversation(state.chat);
    closeModal();
    resetTransientUiState();
  } catch (error) {
    state.rawEditorError = error instanceof Error ? error.message : 'Failed to parse raw document.';
  }
  getRenderApp()();
};

export const rawEditorActions: Record<string, AppActionHandler> = {
  'reset-raw-editor': resetRawEditor,
  'apply-raw-editor': applyRawEditor,
};
