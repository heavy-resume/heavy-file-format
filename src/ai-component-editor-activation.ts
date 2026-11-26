import { findBlockByIds, setActiveEditorBlock, setAiEditorHostBlock } from './block-ops';
import { capturePaneScroll } from './scroll';
import { getRenderApp, state } from './state';

export function activateAiComponentEditor(
  app: HTMLElement,
  sectionKey: string,
  blockId: string,
  options: { hostSection?: boolean } = {}
): void {
  state.aiModeTipDismissed = true;
  state.activeEditorBlockReturnScroll = capturePaneScroll(state.paneScroll, app);
  const passiveBlock = app.querySelector<HTMLElement>(
    `.reader-block[data-section-key="${CSS.escape(sectionKey)}"][data-block-id="${CSS.escape(blockId)}"]`
  );
  setActiveEditorBlock(sectionKey, blockId, { targetOnly: true });
  setAiEditorHostBlock(sectionKey, blockId);
  if (options.hostSection) {
    state.aiEditorHostSectionKey = sectionKey;
  }
  if (state.pendingEditorActivation) {
    const block = findBlockByIds(sectionKey, blockId);
    const suppressFocus = block?.schema.kind === 'table' || block?.schema.component === 'table';
    state.pendingEditorActivation.suppressFocus = suppressFocus;
    state.pendingEditorActivation.immediateFocus = !suppressFocus;
    state.pendingEditorActivation.passiveHeight = passiveBlock?.getBoundingClientRect().height;
  }
  getRenderApp()();
}
