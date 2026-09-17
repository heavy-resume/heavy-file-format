import { captureReaderViewLocation, prepareEditorViewLocation, restoreEditorViewLocation } from './document-view-location';
import { state, getRenderApp } from './state';
import type { AppState } from './types';
import { recordHistory } from './history';
import { navigateToReaderTarget } from './navigation';
import { clearChatConversation } from './chat/chat';
import { closeAiEditPopover } from './ai-edit-popover';
import { restoreCliViewAfterRender } from './cli-ui/focus';
import { clearActiveEditorBlock, findBlockByIds } from './block-ops';
import { commitActiveTextFillIn } from './text-fill-in-commit';
import { runDocumentEditHooksAfterCommit } from './document-edit-hooks';
import { clearSelectedRadioAnswers } from './inline-answer-groups';
import { syncReusableTemplateForBlock } from './reusable';

export function changeDocumentView(requestedView: AppState['currentView'] | 'cli', app: HTMLElement): void {
  const view = requestedView === 'viewer' ? 'viewer' : requestedView === 'ai' ? 'ai' : 'editor';
  const nextEditorMode = requestedView === 'cli'
    ? 'cli'
    : requestedView === 'editor' && state.editorMode === 'cli'
    ? 'basic'
    : state.editorMode;
  if (state.currentView === view && state.editorMode === nextEditorMode) return;
  const readerLocation = view === 'editor' && state.currentView !== 'editor'
    ? captureReaderViewLocation(app) : null;
  commitActiveTextFillIn('switch-view');
  const activeEditorTarget = state.currentView === 'editor'
    ? state.activeEditorBlock
      ? { ...state.activeEditorBlock }
      : state.activeEditorSectionTitleKey
        ? { sectionKey: state.activeEditorSectionTitleKey }
        : null
    : null;
  const crossingChatModeBoundary = (state.currentView === 'viewer') !== (view === 'viewer');
  const crossingEditorBoundary = (state.currentView === 'editor') !== (view === 'editor');
  if (crossingChatModeBoundary) {
    clearChatConversation(state.chat);
  }
  if (crossingEditorBoundary) {
    commitActiveEditorSession();
    state.pendingEditorActivation = null;
    state.componentPlacement = null;
    if (state.currentView === 'editor') {
      runDocumentEditHooksAfterCommit();
    } else if (view === 'editor') {
      clearSelectedRadioAnswersInDocument();
    }
  }
  state.currentView = view;
  state.editorMode = view === 'ai' && nextEditorMode === 'advanced' ? 'basic' : nextEditorMode;
  state.showAdvancedEditor = state.editorMode === 'advanced';
  if (view !== 'ai') {
    closeAiEditPopover();
    state.aiEditorHostBlock = null;
    state.aiEditorHostSectionKey = null;
  }
  prepareEditorViewLocation(readerLocation);
  getRenderApp()();
  restoreEditorViewLocation(app, readerLocation);
  if (activeEditorTarget && view !== 'editor') {
    navigateToReaderTarget(activeEditorTarget, app);
  }
  if (state.editorMode === 'cli') {
    restoreCliViewAfterRender();
  }
}

function commitActiveEditorSession(): void {
  clearActiveEditorBlock();
  state.activeEditorSectionTitleKey = null;
  state.clearSectionTitleOnFocusKey = null;
  state.activeEditorBlockReturnScroll = null;
}

/**
 * Entering the editor drops radio selections made while reading. A radio cannot be
 * deselected by clicking it, so without this an author has no way back to an unanswered
 * document once any option has been picked.
 */
function clearSelectedRadioAnswersInDocument(): void {
  const changed = clearSelectedRadioAnswers(
    state.document.sections,
    (sectionKey, blockId) => {
      const block = findBlockByIds(sectionKey, blockId);
      return block && block.schema.kind === 'text' ? block.text : null;
    },
    (sectionKey, blockId, text) => {
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) return;
      block.text = text;
      syncReusableTemplateForBlock(sectionKey, blockId);
    }
  );
  if (changed.length > 0) {
    recordHistory('clear-radio-answers');
  }
}
