import { getActiveStateRuntime, getRefreshReaderPanels, getRenderApp, runWithStateRuntime } from './state';
import { runPluginDocumentHooks } from './plugins/hooks';

export function runDocumentEditHooksAfterCommit(): void {
  const runtime = getActiveStateRuntime();
  void runPluginDocumentHooks('edit').then(() => {
    runWithStateRuntime(runtime, () => {
      getRefreshReaderPanels()();
      getRenderApp()();
    });
  });
}
