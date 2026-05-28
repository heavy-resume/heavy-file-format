import { getRenderApp, state } from './state';

const NOTICE_DURATION_MS = 2400;

export function showTransientNotice(message: string): void {
  const id = Date.now();
  state.transientNotice = { id, message };
  getRenderApp()();
  window.setTimeout(() => {
    if (state.transientNotice?.id !== id) {
      return;
    }
    state.transientNotice = null;
    getRenderApp()();
  }, NOTICE_DURATION_MS);
}
