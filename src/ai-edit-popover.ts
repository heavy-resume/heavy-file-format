import { state, getRefreshReaderPanels, getRenderApp } from './state';
import { findBlockByIds } from './block-ops';
import { findSectionByKey } from './section-ops';
import { recordHistory } from './history';
import { serializeDocument } from './serialization';
import { requestAiComponentEdit } from './ai-component-edit';

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

  const block = findBlockByIds(sectionKey, blockId);
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!block || !section) {
    state.aiEdit.error = 'The selected component could not be found.';
    getRenderApp()();
    return;
  }

  state.aiEdit.isSending = true;
  state.aiEdit.error = null;
  state.aiEdit.requestNonce += 1;
  const requestNonce = state.aiEdit.requestNonce;
  getRenderApp()();

  try {
    const result = await requestAiComponentEdit({
      settings: state.chat.settings,
      document: state.document,
      sectionTitle: section.title,
      block,
      request,
      onBeforeMutation: () => recordHistory('ai-edit:db-table'),
    });
    if (requestNonce !== state.aiEdit.requestNonce) {
      return;
    }

    recordHistory('ai-edit:block');
    const originalSchemaId = block.schema.id;
    block.text = result.block.text;
    block.schema = result.block.schema;
    block.schemaMode = result.block.schemaMode;
    if (originalSchemaId.trim().length > 0 && block.schema.id.trim().length === 0) {
      block.schema.id = originalSchemaId;
    }
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    closeAiEditPopover();
    getRefreshReaderPanels()();
    getRenderApp()();
  } catch (error) {
    if (requestNonce !== state.aiEdit.requestNonce) {
      return;
    }
    state.aiEdit.error = error instanceof Error ? error.message : 'AI component update failed.';
    getRenderApp()();
  } finally {
    if (requestNonce !== state.aiEdit.requestNonce) {
      return;
    }
    state.aiEdit.isSending = false;
    getRenderApp()();
  }
}
