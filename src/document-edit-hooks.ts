import { getActiveStateRuntime, getRefreshReaderPanels, getRenderApp, runWithStateRuntime, state } from './state';
import { runPluginDocumentHooks } from './plugins/hooks';
import type { PaneScrollState } from './types';

export function runDocumentEditHooksAfterCommit(
  scrollRestore: PaneScrollState | null = null,
  afterRender?: () => void
): void {
  const runtime = getActiveStateRuntime();
  void runPluginDocumentHooks('edit').then(() => {
    runWithStateRuntime(runtime, () => {
      getRefreshReaderPanels()();
      state.pendingPaneScrollRestore = scrollRestore;
      getRenderApp()();
      afterRender?.();
    });
  });
}
