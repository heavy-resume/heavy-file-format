import { getRenderApp, handleDbTableFrameScroll } from './_imports';

export function bindScrollHandler(app: HTMLElement): void {
    app.addEventListener('scroll', (event) => {
      const target = event.target as HTMLElement | null;
      const frame = target?.closest<HTMLElement>('[data-db-table-frame="true"]');
      if (!frame) {
        return;
      }
      if (!handleDbTableFrameScroll(frame)) {
        return;
      }
      getRenderApp()();
    }, true);
}
