import { state, getRenderApp } from './state';
import type { AppState } from './types';
import { commitActiveTextFillIn } from './text-fill-in-commit';
import { serializeDocument } from './serialization';
import { recordHistory } from './history';
import { restoreCliViewAfterRender } from './cli-ui/focus';
import { moveAdvancedOnlySectionsAfterRegularSections, wouldMoveAdvancedOnlySectionsAfterRegularSections } from './section-ops';

/** Apply an editor submode within the active runtime, without changing the document view. */
export function changeEditorMode(editorMode: AppState['editorMode']): void {
  if (state.editorMode === editorMode && state.showAdvancedEditor === (editorMode === 'advanced')) {
    return;
  }
  commitActiveTextFillIn('set-editor-mode');
  const previousEditorMode = state.editorMode;
  state.editorMode = editorMode;
  state.showAdvancedEditor = state.editorMode === 'advanced';
  if (previousEditorMode !== 'advanced' && state.editorMode === 'advanced') {
    reorderAdvancedOnlySectionsForAdvancedMode();
  }
  if (state.editorMode === 'mobile-adjustment') {
    state.componentPlacement = null;
  }
  if (state.editorMode === 'raw') {
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
  }
  if (!state.showAdvancedEditor) {
    state.metaPanelOpen = false;
  }
  state.activeEditorSectionTitleKey = null;
  getRenderApp()();
  if (state.editorMode === 'cli') {
    restoreCliViewAfterRender();
  }
}

function reorderAdvancedOnlySectionsForAdvancedMode(): void {
  if (!wouldMoveAdvancedOnlySectionsAfterRegularSections(state.document.sections, state.document.meta)) {
    return;
  }
  recordHistory();
  moveAdvancedOnlySectionsAfterRegularSections(state.document.sections, state.document.meta);
}
