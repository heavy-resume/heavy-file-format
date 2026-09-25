import { getActiveStateRuntime, getRefreshEditorSection, getRefreshReaderPanels, getRenderApp, runWithStateRuntime, state } from './state';
import { runPluginDocumentHooks } from './plugins/hooks';
import type { PaneScrollState } from './types';

export function runDocumentEditHooksAfterCommit(
  scrollRestore: PaneScrollState | null = null,
  afterRender?: () => void,
  refreshEditorSectionKey?: string,
  options: { preserveActiveEditor?: boolean; callerRefreshedDocumentChange?: boolean } = {}
): void {
  const runtime = getActiveStateRuntime();
  void runPluginDocumentHooks('edit').then((hookResult) => {
    runWithStateRuntime(runtime, () => {
      if (options.callerRefreshedDocumentChange && !hookResult.documentChanged) {
        afterRender?.();
        return;
      }
      getRefreshReaderPanels()();
      if (options.preserveActiveEditor && !hookResult.documentChanged) {
        afterRender?.();
        return;
      }
      const refreshedEditorSection = !hookResult.documentChanged
        && Boolean(refreshEditorSectionKey)
        && getRefreshEditorSection()(refreshEditorSectionKey ?? '');
      if (!refreshedEditorSection) {
        state.pendingPaneScrollRestore = scrollRestore;
        getRenderApp()();
      }
      afterRender?.();
    });
  });
}
